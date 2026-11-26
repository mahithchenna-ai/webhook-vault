import type { ParsedArgs } from 'minimist'
import { DEFAULT_VAULT_DIR } from '../../core/config.js'
import { VaultStorage } from '../../core/storage.js'
import { redactHeaders } from '../../express/redact.js'
import { CliError, color } from '../utils/print.js'

function shellQuote(val: string): string {
  return `'${val.replace(/'/g, `'\\''`)}'`
}

export async function runShare(args: ParsedArgs): Promise<void> {
  const rawId = args._[0]
  if (rawId === undefined || rawId === null || String(rawId).trim() === '') {
    throw new CliError('Missing event ID', 'Usage: webhook-vault share <id|last>')
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
        'Run "webhook-vault list" to view captured event IDs.'
      )
    }

    const safeHeaders = redactHeaders(event.headers)
    const portable = {
      id: event.id,
      timestamp: event.timestamp,
      method: event.method,
      path: event.path,
      provider: event.provider,
      event_type: event.event_type,
      sig_status: event.sig_status,
      sig_reason: event.sig_reason,
      handler_status: event.handler_status,
      handler_latency_ms: event.handler_latency_ms,
      body_size: event.body_size,
      raw_body_omitted: true,
      headers: safeHeaders,
      replays_count: event.replays.length,
    }

    console.log(color.bold('Portable Redacted Event JSON:'))
    console.log(JSON.stringify(portable, null, 2))

    const headerFlags = Object.entries(safeHeaders)
      .filter(([k]) => k !== 'content-length' && k !== 'host')
      .map(([k, v]) => `  -H ${shellQuote(`${k}: ${v}`)}`)
      .join(' \\\n')

    const targetUrl = `http://localhost:3000${event.path.startsWith('/') ? event.path : `/${event.path}`}`
    const curlLines = [
      `curl -X ${event.method || 'POST'} ${shellQuote(targetUrl)} \\`,
      ...(headerFlags ? [`${headerFlags} \\`] : []),
      `  --data-raw ${shellQuote(`<payload omitted: ${event.body_size} bytes>`)}`,
    ]

    console.log('\n' + color.bold('Copy-paste curl command:'))
    console.log(curlLines.join('\n'))
  } finally {
    storage.close()
  }
}
