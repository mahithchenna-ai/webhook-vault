import type { ParsedArgs } from 'minimist'
import { DEFAULT_VAULT_DIR, type SecretsConfig } from '../../core/config.js'
import { VaultStorage } from '../../core/storage.js'
import { createFetchDeliver, resolveTargetUrl } from '../../replay/index.js'
import { ALL_SYNTHETIC_EVENTS, generateSyntheticEvent } from '../../replay/simulator.js'
import {
  CliError,
  formatHttpStatus,
  printSuccess,
  printTable,
  printWarn,
} from '../utils/print.js'

export async function runDemo(args: ParsedArgs): Promise<void> {
  const target = typeof args.target === 'string' ? args.target : undefined
  if (!target) {
    throw new CliError(
      'Missing required --target <url> flag',
      'Example: webhook-vault demo --target http://localhost:3000'
    )
  }

  try {
    new URL(target)
  } catch {
    throw new CliError(
      `Invalid target URL "${target}"`,
      'Pass a valid HTTP(S) URL, e.g. --target http://localhost:3000'
    )
  }

  const dir = typeof args.dir === 'string' ? args.dir : DEFAULT_VAULT_DIR
  const secrets: Required<SecretsConfig> = {
    stripe:
      typeof args['stripe-secret'] === 'string'
        ? args['stripe-secret']
        : process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_demo',
    github:
      typeof args['github-secret'] === 'string'
        ? args['github-secret']
        : process.env.GITHUB_WEBHOOK_SECRET ?? 'ghsec_demo',
    razorpay:
      typeof args['razorpay-secret'] === 'string'
        ? args['razorpay-secret']
        : process.env.RAZORPAY_WEBHOOK_SECRET ?? 'rzsec_demo',
  }

  const storage = new VaultStorage(dir)
  const deliver = createFetchDeliver()
  const rows: string[][] = []
  let failures = 0

  try {
    for (const item of ALL_SYNTHETIC_EVENTS) {
      const secret = secrets[item.provider]
      const generated = generateSyntheticEvent(item.provider, item.eventType, secret)
      const webhookPath = `/webhooks/${item.provider}`
      const rawBody = generated.body.toString('utf8')

      const id = storage.insert({
        timestamp: Date.now(),
        method: 'POST',
        path: webhookPath,
        headers: generated.headers,
        raw_body: rawBody,
        body_size: generated.body.length,
        provider: item.provider,
        event_type: item.eventType,
        sig_status: 'valid',
        sig_reason: null,
        handler_status: null,
        handler_latency_ms: null,
      })

      const event = storage.get(id)!
      const url = resolveTargetUrl(target, event)
      try {
        const res = await deliver(url, 'POST', generated.headers, rawBody)
        storage.updateHandler(id, res.status, res.latencyMs)
        storage.appendReplay(id, {
          attempt: 1,
          timestamp: Date.now(),
          mode: 'demo',
          status: res.status,
          headers: res.headers,
          body: res.body,
          latency_ms: res.latencyMs,
        })
        if (res.status >= 400) failures++
        rows.push([
          id,
          item.provider,
          item.eventType,
          formatHttpStatus(res.status),
          `${res.latencyMs}ms`,
        ])
      } catch (err) {
        failures++
        rows.push([id, item.provider, item.eventType, 'ERR', (err as Error).message])
      }
    }
  } finally {
    storage.close()
  }

  printTable(['ID', 'PROVIDER', 'EVENT', 'STATUS', 'LATENCY'], rows)
  if (failures === 0) {
    printSuccess(`Fired all ${ALL_SYNTHETIC_EVENTS.length} synthetic webhooks successfully.`)
  } else {
    printWarn(`Fired ${ALL_SYNTHETIC_EVENTS.length} synthetic webhooks with ${failures} error(s).`)
  }
}
