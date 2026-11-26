import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { DEFAULT_DASHBOARD_PORT, DEFAULT_VAULT_DIR } from './config.js'
import type { CapturedEvent } from './events.js'
import type { VaultStorage } from './storage.js'

export interface VaultServerOptions {
  storage: VaultStorage
  dir?: string
  port?: number
}

export class VaultServer {
  private storage: VaultStorage
  private dir: string
  private port: number
  private server: Server | null = null
  private clients = new Set<ServerResponse>()

  constructor(opts: VaultServerOptions) {
    this.storage = opts.storage
    this.dir = opts.dir ?? DEFAULT_VAULT_DIR
    this.port = opts.port ?? DEFAULT_DASHBOARD_PORT
  }

  broadcast(event: CapturedEvent): void {
    const payload = `data: ${JSON.stringify(event)}\n\n`
    for (const res of this.clients) {
      res.write(payload)
    }
  }

  async start(): Promise<number> {
    if (this.server) {
      return (this.server.address() as AddressInfo).port
    }
    this.server = createServer((req, res) => this.handleRequest(req, res))
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
      this.server!.close(() => resolve())
    })
    this.server = null
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/'
    if (url === '/_vault/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      res.write(': connected\n\n')
      this.clients.add(res)
      req.on('close', () => {
        this.clients.delete(res)
      })
      return
    }

    if (url === '/_vault/api/events') {
      const events = this.storage.list({ limit: 100 })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ events, dir: this.dir }))
      return
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('webhook-vault dashboard server')
  }
}
