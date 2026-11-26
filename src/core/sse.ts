import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_DASHBOARD_PORT,
  DEFAULT_VAULT_DIR,
  type ChaosConfig,
  type SecretsConfig,
} from './config.js'
import type { CapturedEvent } from './events.js'
import type { VaultStorage } from './storage.js'
import { replay } from '../replay/index.js'
import { parseReplayMode } from '../replay/modes.js'

export interface VaultServerOptions {
  storage: VaultStorage
  dir?: string
  port?: number
  secrets?: SecretsConfig
  uiDir?: string
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

const DEFAULT_CHAOS: ChaosConfig = {
  preset: 'calm',
  duplicates: false,
  delayMs: 0,
  failRate: 0,
  outOfOrder: false,
}

export function resolveUiDir(customDir?: string): string {
  if (customDir) return path.resolve(customDir)

  const currentFile =
    typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url)
  const currentDir = path.dirname(currentFile)

  const candidates = [
    path.resolve(currentDir, '../ui'),
    path.resolve(currentDir, '../../dist/ui'),
    path.resolve(process.cwd(), 'dist/ui'),
  ]

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'index.html'))) {
      return candidate
    }
  }
  return candidates[0]
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  return JSON.parse(raw) as Record<string, unknown>
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

export class VaultServer {
  private storage: VaultStorage
  private dir: string
  private port: number
  private secrets: SecretsConfig
  private uiDir: string
  private server: Server | null = null
  private clients = new Set<ServerResponse>()

  constructor(opts: VaultServerOptions) {
    this.storage = opts.storage
    this.dir = opts.dir ?? DEFAULT_VAULT_DIR
    this.port = opts.port ?? DEFAULT_DASHBOARD_PORT
    this.secrets = opts.secrets ?? {}
    this.uiDir = resolveUiDir(opts.uiDir)
  }

  broadcast(event: CapturedEvent): void {
    const payload = `data: ${JSON.stringify(event)}\n\n`
    for (const res of this.clients) {
      try {
        res.write(payload)
      } catch {
        this.clients.delete(res)
      }
    }
  }

  async start(): Promise<number> {
    if (this.server) {
      return (this.server.address() as AddressInfo).port
    }
    this.server = createServer((req, res) => {
      void this.handleRequest(req, res)
    })
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(this.port, '127.0.0.1', () => resolve())
    })
    return (this.server.address() as AddressInfo).port
  }

  async stop(): Promise<void> {
    for (const client of this.clients) {
      client.end()
    }
    this.clients.clear()
    if (!this.server) return
    await new Promise<void>((resolve) => {
      this.server!.closeAllConnections?.()
      this.server!.close(() => resolve())
    })
    this.server = null
  }

  private readChaos(): ChaosConfig {
    const chaosPath = path.join(this.dir, 'chaos.json')
    if (!existsSync(chaosPath)) return { ...DEFAULT_CHAOS }
    try {
      return { ...DEFAULT_CHAOS, ...(JSON.parse(readFileSync(chaosPath, 'utf8')) as ChaosConfig) }
    } catch {
      return { ...DEFAULT_CHAOS }
    }
  }

  private writeChaos(next: ChaosConfig): ChaosConfig {
    mkdirSync(this.dir, { recursive: true })
    const chaosPath = path.join(this.dir, 'chaos.json')
    const merged: ChaosConfig = { ...DEFAULT_CHAOS, ...next }
    writeFileSync(chaosPath, JSON.stringify(merged, null, 2) + '\n', 'utf8')
    return merged
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsedUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
    const pathname = parsedUrl.pathname
    const method = (req.method ?? 'GET').toUpperCase()

    if (pathname === '/' || pathname === '/_vault') {
      res.writeHead(302, { Location: '/_vault/' })
      res.end()
      return
    }

    if (pathname === '/_vault/events' && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      res.write('retry: 2000\n: connected\n\n')
      this.clients.add(res)
      req.on('close', () => {
        this.clients.delete(res)
      })
      return
    }

    if (pathname === '/_vault/api/events' && method === 'GET') {
      const provider = parsedUrl.searchParams.get('provider') ?? undefined
      const sigStatus = parsedUrl.searchParams.get('status') ?? undefined
      const limitParam = parsedUrl.searchParams.get('limit')
      const limit = limitParam ? Number(limitParam) : 100
      const events = this.storage.list({
        provider: provider || undefined,
        sigStatus: sigStatus || undefined,
        limit: Number.isFinite(limit) && limit > 0 ? limit : 100,
      })
      sendJson(res, 200, { events })
      return
    }

    const replayMatch = pathname.match(/^\/_vault\/api\/events\/([^/]+)\/replay$/)
    if (replayMatch && method === 'POST') {
      const id = decodeURIComponent(replayMatch[1])
      try {
        const body = await readJsonBody(req)
        const modeStr = typeof body.mode === 'string' ? body.mode : 'once'
        const sequence = Array.isArray(body.sequence) ? body.sequence.map(String) : []
        const mode = parseReplayMode(modeStr, sequence)
        const resign = Boolean(body.resign)
        const target = typeof body.target === 'string' && body.target.trim() ? body.target.trim() : undefined

        const result = await replay(id, {
          storage: this.storage,
          resign,
          target,
          mode,
          secrets: this.secrets,
        })
        const updatedEvent = this.storage.get(id)
        if (updatedEvent) {
          this.broadcast(updatedEvent)
        }
        sendJson(res, 200, { result, event: updatedEvent })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const status = msg.startsWith('Event not found') ? 404 : 400
        sendJson(res, status, { error: msg })
      }
      return
    }

    const detailMatch = pathname.match(/^\/_vault\/api\/events\/([^/]+)$/)
    if (detailMatch && method === 'GET') {
      const id = decodeURIComponent(detailMatch[1])
      const event = this.storage.get(id)
      if (!event) {
        sendJson(res, 404, { error: `Event not found: ${id}` })
        return
      }
      sendJson(res, 200, { event })
      return
    }

    if (pathname === '/_vault/api/chaos' && method === 'GET') {
      sendJson(res, 200, { chaos: this.readChaos() })
      return
    }

    if (pathname === '/_vault/api/chaos' && method === 'POST') {
      try {
        const body = await readJsonBody(req)
        const saved = this.writeChaos(body as ChaosConfig)
        sendJson(res, 200, { chaos: saved })
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    if (pathname.startsWith('/_vault/')) {
      this.serveStatic(pathname, res)
      return
    }

    sendJson(res, 404, { error: 'Not found' })
  }

  private serveStatic(pathname: string, res: ServerResponse): void {
    const rel = pathname.slice('/_vault/'.length) || 'index.html'
    const normalizedRel = path.normalize(rel).replace(/^(\.\.[/\\])+/, '')
    const fullPath = path.resolve(this.uiDir, normalizedRel)

    if (fullPath !== this.uiDir && !fullPath.startsWith(this.uiDir + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' })
      res.end('Forbidden')
      return
    }

    if (!existsSync(fullPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not found')
      return
    }

    const ext = path.extname(fullPath).toLowerCase()
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(readFileSync(fullPath))
  }
}
