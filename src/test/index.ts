import type { Application } from 'express'
import type { SecretsConfig } from '../core/config.js'
import type { CapturedEvent, EventFilter, Provider } from '../core/events.js'
import { VaultStorage } from '../core/storage.js'
import {
  createFetchDeliver,
  executeReplayWithDeliver,
  type DeliverFn,
  type ReplayResult,
} from '../replay/index.js'
import type { ReplayMode } from '../replay/modes.js'
import { generateSyntheticEvent } from '../replay/simulator.js'

export interface TestVaultOptions {
  secrets?: SecretsConfig
  fetchImpl?: typeof fetch
}

export interface TestDeliveryOptions {
  target: string | Application
  path?: string
  mode?: ReplayMode
  secret?: string
  timestamp?: number
  overrides?: Record<string, unknown>
}

export interface TestVault {
  storage: VaultStorage
  stripe: (eventType: string, opts: TestDeliveryOptions) => Promise<ReplayResult>
  github: (eventType: string, opts: TestDeliveryOptions) => Promise<ReplayResult>
  razorpay: (eventType: string, opts: TestDeliveryOptions) => Promise<ReplayResult>
  send: (provider: Provider, eventType: string, opts: TestDeliveryOptions) => Promise<ReplayResult>
  replay: (
    eventId: string,
    opts: { target: string | Application; mode?: ReplayMode; resign?: boolean }
  ) => Promise<ReplayResult>
  events: (filter?: EventFilter) => CapturedEvent[]
  close: () => void
}

async function createSupertestDeliver(app: Application): Promise<DeliverFn> {
  const mod = await import('supertest')
  type SupertestAgent = {
    post: (path: string) => {
      set: (headers: Record<string, string>) => {
        send: (body: string) => Promise<{
          status: number
          headers: Record<string, string | string[] | undefined>
          text?: string
          body?: unknown
        }>
      }
    }
  }
  type SupertestModule = ((app: Application) => SupertestAgent) & {
    agent?: (app: Application) => SupertestAgent
  }
  const supertest = (mod.default ?? mod) as unknown as SupertestModule
  const client = supertest.agent ? supertest.agent(app) : supertest(app)

  return async (targetPath, _method, headers, body) => {
    const start = performance.now()
    const res = await client.post(targetPath).set(headers).send(body)
    const latencyMs = Math.max(0, Math.round(performance.now() - start))
    const normalizedHeaders: Record<string, string> = {}
    for (const [k, v] of Object.entries(res.headers ?? {})) {
      if (v === undefined) continue
      normalizedHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v)
    }
    const responseBody =
      res.text ?? (typeof res.body === 'string' ? res.body : JSON.stringify(res.body ?? ''))
    return {
      status: res.status,
      headers: normalizedHeaders,
      body: responseBody,
      latencyMs,
    }
  }
}

export function createTestVault(config: TestVaultOptions = {}): TestVault {
  const storage = new VaultStorage(':memory:')
  const secrets = config.secrets ?? {}
  const fetchDeliver = createFetchDeliver(config.fetchImpl)

  async function resolveDeliver(target: string | Application): Promise<{
    deliver: DeliverFn
    targetStr: string | undefined
    useTargetAsPathOnly: boolean
  }> {
    if (typeof target === 'string') {
      return {
        deliver: fetchDeliver,
        targetStr: target,
        useTargetAsPathOnly: false,
      }
    }
    const deliver = await createSupertestDeliver(target)
    return {
      deliver,
      targetStr: undefined,
      useTargetAsPathOnly: true,
    }
  }

  async function send(
    provider: Provider,
    eventType: string,
    opts: TestDeliveryOptions
  ): Promise<ReplayResult> {
    const secret = opts.secret ?? secrets[provider]
    if (!secret) {
      throw new Error(`No signing secret configured for provider "${provider}"`)
    }

    const generated = generateSyntheticEvent(provider, eventType, secret, {
      timestamp: opts.timestamp,
      overrides: opts.overrides,
    })

    const webhookPath = opts.path ?? `/webhooks/${provider}`
    const rawBody = generated.body.toString('utf8')

    const eventId = storage.insert({
      timestamp: Date.now(),
      method: 'POST',
      path: webhookPath,
      headers: generated.headers,
      raw_body: rawBody,
      body_size: generated.body.length,
      provider,
      event_type: eventType,
      sig_status: 'valid',
      sig_reason: null,
      handler_status: null,
      handler_latency_ms: null,
    })

    const { deliver, targetStr, useTargetAsPathOnly } = await resolveDeliver(opts.target)
    const result = await executeReplayWithDeliver(eventId, storage, deliver, {
      mode: opts.mode,
      target: useTargetAsPathOnly ? webhookPath : targetStr,
      useTargetAsPathOnly,
      secrets,
    })

    if (result.attempts.length > 0) {
      storage.updateHandler(eventId, result.attempts[0].status, result.attempts[0].latency_ms)
    }

    return result
  }

  async function replayEvent(
    eventId: string,
    opts: { target: string | Application; mode?: ReplayMode; resign?: boolean }
  ): Promise<ReplayResult> {
    const existing = storage.get(eventId)
    if (!existing) {
      throw new Error(`Event not found: ${eventId}`)
    }
    const { deliver, targetStr, useTargetAsPathOnly } = await resolveDeliver(opts.target)
    return executeReplayWithDeliver(eventId, storage, deliver, {
      mode: opts.mode,
      resign: opts.resign,
      target: useTargetAsPathOnly ? existing.path : targetStr,
      useTargetAsPathOnly,
      secrets,
    })
  }

  return {
    storage,
    stripe: (eventType, opts) => send('stripe', eventType, opts),
    github: (eventType, opts) => send('github', eventType, opts),
    razorpay: (eventType, opts) => send('razorpay', eventType, opts),
    send,
    replay: replayEvent,
    events: (filter) => storage.list(filter),
    close: () => storage.close(),
  }
}
