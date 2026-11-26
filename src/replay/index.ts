import { DEFAULT_VAULT_DIR, type SecretsConfig } from '../core/config.js'
import type { CapturedEvent, Provider, ReplayRecord } from '../core/events.js'
import { VaultStorage } from '../core/storage.js'
import { signWebhook } from '../signing/index.js'
import {
  calculateBackoffMs,
  DEFAULT_BACKOFF_MS,
  DEFAULT_MAX_ATTEMPTS,
  sleep,
  type ReplayMode,
} from './modes.js'

export interface ReplayOptions {
  resign?: boolean
  target?: string
  mode?: ReplayMode
  storage?: VaultStorage
  dir?: string
  secrets?: SecretsConfig
  fetchImpl?: typeof fetch
}

export interface ReplayResult {
  eventId: string
  mode: ReplayMode['type']
  attempts: ReplayRecord[]
  succeeded: boolean
  finalStatus: number
}

export interface DeliveryResponse {
  status: number
  headers: Record<string, string>
  body: string
  latencyMs: number
}

export type DeliverFn = (
  urlOrPath: string,
  method: string,
  headers: Record<string, string>,
  body: string
) => Promise<DeliveryResponse>

const HOP_BY_HOP_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
])

export function getSignatureHeaderName(provider: Provider): string {
  switch (provider) {
    case 'stripe':
      return 'stripe-signature'
    case 'github':
      return 'x-hub-signature-256'
    case 'razorpay':
      return 'x-razorpay-signature'
  }
}

function getSecretForProvider(provider: Provider, secrets?: SecretsConfig): string | undefined {
  if (secrets?.[provider]) return secrets[provider]
  switch (provider) {
    case 'stripe':
      return process.env.STRIPE_WEBHOOK_SECRET
    case 'github':
      return process.env.GITHUB_WEBHOOK_SECRET
    case 'razorpay':
      return process.env.RAZORPAY_WEBHOOK_SECRET
  }
}

export function buildReplayHeaders(
  event: CapturedEvent,
  resign: boolean,
  secrets?: SecretsConfig
): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(event.headers)) {
    const lk = k.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(lk)) continue
    if (v === '[REDACTED]') continue
    headers[lk] = v
  }

  if (resign && event.provider) {
    const secret = getSecretForProvider(event.provider, secrets)
    if (!secret) {
      throw new Error(
        `Cannot re-sign ${event.provider} event ${event.id}: missing signing secret`
      )
    }
    const payloadBuf = Buffer.from(event.raw_body ?? '', 'utf8')
    const signed = signWebhook(event.provider, payloadBuf, secret)
    headers[getSignatureHeaderName(event.provider)] = signed.header
  }

  return headers
}

export function resolveTargetUrl(target: string | undefined, event: CapturedEvent): string {
  if (!target) {
    const host = event.headers.host
    if (!host || host === '[REDACTED]') {
      throw new Error('No replay target URL provided. Pass { target } or --target <url>.')
    }
    return `http://${host}${event.path}`
  }

  const parsed = new URL(target)
  if ((parsed.pathname === '/' || parsed.pathname === '') && event.path && event.path !== '/') {
    return `${parsed.origin}${event.path.startsWith('/') ? event.path : `/${event.path}`}`
  }
  return target
}

export function createFetchDeliver(fetchImpl: typeof fetch = globalThis.fetch): DeliverFn {
  return async (url, method, headers, body) => {
    const start = performance.now()
    const hasBody = method !== 'GET' && method !== 'HEAD'
    const res = await fetchImpl(url, {
      method,
      headers,
      body: hasBody ? body : undefined,
    })
    const responseBody = await res.text()
    const latencyMs = Math.max(0, Math.round(performance.now() - start))
    const resHeaders: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      resHeaders[key.toLowerCase()] = value
    })
    return {
      status: res.status,
      headers: resHeaders,
      body: responseBody,
      latencyMs,
    }
  }
}

export async function executeReplayWithDeliver(
  eventId: string,
  storage: VaultStorage,
  deliver: DeliverFn,
  opts: {
    resign?: boolean
    target?: string
    mode?: ReplayMode
    secrets?: SecretsConfig
    useTargetAsPathOnly?: boolean
  } = {}
): Promise<ReplayResult> {
  const mode: ReplayMode = opts.mode ?? { type: 'once' }
  const resign = opts.resign ?? false

  const deliverSingle = async (
    targetEventId: string,
    attemptNum: number,
    modeLabel: string
  ): Promise<ReplayRecord> => {
    const event = storage.get(targetEventId)
    if (!event) {
      throw new Error(`Event not found: ${targetEventId}`)
    }
    const headers = buildReplayHeaders(event, resign, opts.secrets)
    const destination = opts.useTargetAsPathOnly
      ? opts.target ?? event.path
      : resolveTargetUrl(opts.target, event)
    const body = event.raw_body ?? ''
    const res = await deliver(destination, event.method || 'POST', headers, body)
    const record: ReplayRecord = {
      attempt: attemptNum,
      timestamp: Date.now(),
      mode: modeLabel,
      status: res.status,
      headers: res.headers,
      body: res.body,
      latency_ms: res.latencyMs,
    }
    storage.appendReplay(targetEventId, record)
    return record
  }

  const attempts: ReplayRecord[] = []

  switch (mode.type) {
    case 'once': {
      attempts.push(await deliverSingle(eventId, 1, 'once'))
      break
    }
    case 'duplicate': {
      attempts.push(await deliverSingle(eventId, 1, 'duplicate'))
      attempts.push(await deliverSingle(eventId, 2, 'duplicate'))
      break
    }
    case 'outOfOrder': {
      const sequence = mode.sequence.length > 0 ? mode.sequence : [eventId]
      for (let i = 0; i < sequence.length; i++) {
        attempts.push(await deliverSingle(sequence[i], i + 1, 'outOfOrder'))
      }
      break
    }
    case 'failThenSucceed': {
      const maxAttempts = mode.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
      const backoffMs = mode.backoffMs ?? DEFAULT_BACKOFF_MS
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const rec = await deliverSingle(eventId, attempt, 'failThenSucceed')
        attempts.push(rec)
        if (rec.status >= 200 && rec.status < 300) {
          break
        }
        if (attempt < maxAttempts) {
          const delay = calculateBackoffMs(attempt - 1, backoffMs)
          await sleep(delay)
        }
      }
      break
    }
  }

  const finalStatus = attempts.length > 0 ? attempts[attempts.length - 1].status : 0
  const succeeded = finalStatus >= 200 && finalStatus < 300

  return {
    eventId,
    mode: mode.type,
    attempts,
    succeeded,
    finalStatus,
  }
}

export async function replay(eventId: string, opts: ReplayOptions = {}): Promise<ReplayResult> {
  const ownStorage = !opts.storage
  const storage = opts.storage ?? new VaultStorage(opts.dir ?? DEFAULT_VAULT_DIR)

  try {
    const deliver = createFetchDeliver(opts.fetchImpl)
    return await executeReplayWithDeliver(eventId, storage, deliver, {
      resign: opts.resign,
      target: opts.target,
      mode: opts.mode,
      secrets: opts.secrets,
    })
  } finally {
    if (ownStorage) {
      storage.close()
    }
  }
}

export * from './modes.js'
export * from './simulator.js'
