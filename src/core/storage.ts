import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { DEFAULT_BODY_SIZE_LIMIT_BYTES } from './config.js'
import type {
  CapturedEvent,
  EventFilter,
  NewCapturedEvent,
  Provider,
  ReplayRecord,
  SignatureStatus,
} from './events.js'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof import('better-sqlite3')
type DatabaseInstance = InstanceType<typeof Database>

export interface VaultStorageOptions {
  bodySizeLimitBytes?: number
}

interface EventRow {
  id: string
  timestamp: number
  method: string
  path: string
  headers: string
  raw_body: string | null
  body_size: number
  provider: string | null
  event_type: string | null
  sig_status: string
  sig_reason: string | null
  handler_status: number | null
  handler_latency_ms: number | null
  replays: string
}

export class VaultStorage {
  private db: DatabaseInstance
  private bodySizeLimitBytes: number

  constructor(dir: string, opts: VaultStorageOptions = {}) {
    this.bodySizeLimitBytes = opts.bodySizeLimitBytes ?? DEFAULT_BODY_SIZE_LIMIT_BYTES
    if (dir === ':memory:') {
      this.db = new Database(':memory:')
    } else {
      mkdirSync(dir, { recursive: true })
      this.db = new Database(path.join(dir, 'vault.db'))
    }
    this.db.pragma('journal_mode = WAL')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      headers TEXT NOT NULL,
      raw_body TEXT,
      body_size INTEGER NOT NULL,
      provider TEXT,
      event_type TEXT,
      sig_status TEXT NOT NULL,
      sig_reason TEXT,
      handler_status INTEGER,
      handler_latency_ms INTEGER,
      replays TEXT NOT NULL DEFAULT '[]'
    )`)
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_ts ON events(timestamp)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_provider ON events(provider)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_sig ON events(sig_status)')
  }

  insert(event: NewCapturedEvent): string {
    const id = nanoid()
    let rawBody = event.raw_body
    if (rawBody !== null && Buffer.byteLength(rawBody, 'utf8') > this.bodySizeLimitBytes) {
      rawBody = null
    }

    const stmt = this.db.prepare(`
      INSERT INTO events (
        id, timestamp, method, path, headers, raw_body, body_size,
        provider, event_type, sig_status, sig_reason,
        handler_status, handler_latency_ms, replays
      ) VALUES (
        @id, @timestamp, @method, @path, @headers, @raw_body, @body_size,
        @provider, @event_type, @sig_status, @sig_reason,
        @handler_status, @handler_latency_ms, @replays
      )
    `)

    stmt.run({
      id,
      timestamp: event.timestamp,
      method: event.method,
      path: event.path,
      headers: JSON.stringify(event.headers),
      raw_body: rawBody,
      body_size: event.body_size,
      provider: event.provider,
      event_type: event.event_type,
      sig_status: event.sig_status,
      sig_reason: event.sig_reason,
      handler_status: event.handler_status,
      handler_latency_ms: event.handler_latency_ms,
      replays: '[]',
    })

    return id
  }

  get(id: string): CapturedEvent | null {
    const stmt = this.db.prepare('SELECT * FROM events WHERE id = ?')
    const row = stmt.get(id) as EventRow | undefined
    return row ? this.deserialize(row) : null
  }

  list(filter: EventFilter = {}): CapturedEvent[] {
    let sql = 'SELECT * FROM events WHERE 1=1'
    const params: unknown[] = []

    if (filter.provider) {
      sql += ' AND provider = ?'
      params.push(filter.provider)
    }
    if (filter.sigStatus) {
      sql += ' AND sig_status = ?'
      params.push(filter.sigStatus)
    }

    sql += ' ORDER BY timestamp DESC, rowid DESC'

    if (typeof filter.limit === 'number') {
      sql += ' LIMIT ?'
      params.push(filter.limit)
    }
    if (typeof filter.offset === 'number') {
      sql += ' OFFSET ?'
      params.push(filter.offset)
    }

    const stmt = this.db.prepare(sql)
    const rows = stmt.all(...params) as EventRow[]
    return rows.map((row) => this.deserialize(row))
  }

  appendReplay(id: string, record: ReplayRecord): void {
    const existing = this.get(id)
    if (!existing) {
      throw new Error(`Event not found: ${id}`)
    }
    const updated = [...existing.replays, record]
    const stmt = this.db.prepare('UPDATE events SET replays = ? WHERE id = ?')
    stmt.run(JSON.stringify(updated), id)
  }

  updateHandler(id: string, status: number, latencyMs: number): void {
    const stmt = this.db.prepare(
      'UPDATE events SET handler_status = ?, handler_latency_ms = ? WHERE id = ?'
    )
    stmt.run(status, latencyMs, id)
  }

  close(): void {
    this.db.close()
  }

  private deserialize(row: EventRow): CapturedEvent {
    return {
      id: row.id,
      timestamp: row.timestamp,
      method: row.method,
      path: row.path,
      headers: JSON.parse(row.headers) as Record<string, string>,
      raw_body: row.raw_body,
      body_size: row.body_size,
      provider: (row.provider as Provider | null) ?? null,
      event_type: row.event_type ?? null,
      sig_status: row.sig_status as SignatureStatus,
      sig_reason: row.sig_reason ?? null,
      handler_status: row.handler_status ?? null,
      handler_latency_ms: row.handler_latency_ms ?? null,
      replays: JSON.parse(row.replays) as ReplayRecord[],
    }
  }
}
