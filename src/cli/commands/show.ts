import type { ParsedArgs } from 'minimist'
import { DEFAULT_VAULT_DIR } from '../../core/config.js'
import { VaultStorage } from '../../core/storage.js'
import { CliError, color, formatHttpStatus, formatSigStatus } from '../utils/print.js'

export async function runShow(args: ParsedArgs): Promise<void> {
  const rawId = args._[0]
  if (rawId === undefined || rawId === null || String(rawId).trim() === '') {
    throw new CliError('Missing event ID', 'Usage: webhook-vault show <id|last>')
  }

  const dir = typeof args.dir === 'string' ? args.dir : DEFAULT_VAULT_DIR
  const storage = new VaultStorage(dir)

  try {
    const idArg = String(rawId)
    const event =
      idArg === 'last' ? storage.list({ limit: 1 })[0] ?? null : storage.get(idArg)

    if (!event) {
      throw new CliError(
        `Event "${idArg}" not found`,
        'Run "webhook-vault list" to see captured event IDs.'
      )
    }

    console.log(color.bold(`Event ${event.id}`))
    console.log(`Timestamp:  ${new Date(event.timestamp).toISOString()}`)
    console.log(`Request:    ${event.method} ${event.path}`)
    console.log(`Provider:   ${event.provider ?? 'unknown'}`)
    console.log(`Event Type: ${event.event_type ?? '-'}`)
    console.log(
      `Signature:  ${formatSigStatus(event.sig_status)}${event.sig_reason ? ` (${event.sig_reason})` : ''}`
    )
    console.log(
      `Handler:    ${formatHttpStatus(event.handler_status)} (${event.handler_latency_ms ?? '-'}ms)`
    )
    console.log(`Body Size:  ${event.body_size} bytes`)

    console.log('\n' + color.bold('Headers:'))
    for (const [k, v] of Object.entries(event.headers)) {
      console.log(`  ${color.cyan(k)}: ${v}`)
    }

    console.log('\n' + color.bold('Body:'))
    if (event.raw_body === null) {
      console.log(color.dim('  [body omitted: exceeded bodySizeLimitBytes]'))
    } else {
      try {
        console.log(JSON.stringify(JSON.parse(event.raw_body), null, 2))
      } catch {
        console.log(event.raw_body)
      }
    }

    console.log('\n' + color.bold(`Replays (${event.replays.length}):`))
    if (event.replays.length === 0) {
      console.log(color.dim('  None yet'))
    } else {
      for (const r of event.replays) {
        console.log(
          `  #${r.attempt} [${r.mode}] -> ${formatHttpStatus(r.status)} (${r.latency_ms}ms) at ${new Date(r.timestamp).toISOString()}`
        )
      }
    }
  } finally {
    storage.close()
  }
}
