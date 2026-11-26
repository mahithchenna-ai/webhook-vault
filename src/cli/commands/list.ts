import type { ParsedArgs } from 'minimist'
import { DEFAULT_VAULT_DIR } from '../../core/config.js'
import { VaultStorage } from '../../core/storage.js'
import {
  color,
  formatHttpStatus,
  formatSigStatus,
  printInfo,
  printTable,
} from '../utils/print.js'

export async function runList(args: ParsedArgs): Promise<void> {
  const dir = typeof args.dir === 'string' ? args.dir : DEFAULT_VAULT_DIR
  const provider = typeof args.provider === 'string' ? args.provider : undefined
  const sigStatus = typeof args.status === 'string' ? args.status : undefined
  const limit = typeof args.limit === 'number' ? args.limit : 25

  const storage = new VaultStorage(dir)
  try {
    const events = storage.list({ provider, sigStatus, limit })
    if (events.length === 0) {
      printInfo('No captured webhook events found.')
      console.log(
        color.dim(
          'Hint: Start your server with vault() middleware or run "webhook-vault demo --target <url>".'
        )
      )
      return
    }

    const rows = events.map((ev) => [
      ev.id,
      new Date(ev.timestamp).toISOString().replace('T', ' ').slice(0, 19),
      ev.provider ?? '-',
      ev.event_type ?? '-',
      formatSigStatus(ev.sig_status),
      formatHttpStatus(ev.handler_status),
      String(ev.replays.length),
    ])

    printTable(['ID', 'TIMESTAMP (UTC)', 'PROVIDER', 'EVENT', 'SIGNATURE', 'STATUS', 'REPLAYS'], rows)
  } finally {
    storage.close()
  }
}
