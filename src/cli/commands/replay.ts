import type { ParsedArgs } from 'minimist'
import { DEFAULT_VAULT_DIR, type SecretsConfig } from '../../core/config.js'
import { VaultStorage } from '../../core/storage.js'
import { replay } from '../../replay/index.js'
import { parseReplayMode } from '../../replay/modes.js'
import {
  CliError,
  color,
  formatHttpStatus,
  printSuccess,
  printWarn,
} from '../utils/print.js'

export async function runReplay(args: ParsedArgs): Promise<void> {
  const rawId = args._[0]
  if (rawId === undefined || rawId === null || String(rawId).trim() === '') {
    throw new CliError(
      'Missing event ID',
      'Usage: webhook-vault replay <id|last> [--resign] [--mode once|duplicate|fail-then-succeed] [--target <url>]'
    )
  }

  const dir = typeof args.dir === 'string' ? args.dir : DEFAULT_VAULT_DIR
  const target = typeof args.target === 'string' ? args.target : undefined
  const resign = Boolean(args.resign)
  const modeStr = typeof args.mode === 'string' ? args.mode : 'once'
  const secretOverride = typeof args.secret === 'string' ? args.secret : undefined

  const storage = new VaultStorage(dir)
  try {
    const idArg = String(rawId)
    const event =
      idArg === 'last' ? storage.list({ limit: 1 })[0] ?? null : storage.get(idArg)

    if (!event) {
      throw new CliError(
        idArg === 'last' ? 'No captured events found to replay' : `Event "${idArg}" not found`,
        'Capture an incoming webhook first or run "webhook-vault list".'
      )
    }

    const extraIds = args._.slice(1).map(String)
    const mode = parseReplayMode(modeStr, [event.id, ...extraIds])

    const secrets: SecretsConfig = {
      stripe: process.env.STRIPE_WEBHOOK_SECRET,
      github: process.env.GITHUB_WEBHOOK_SECRET,
      razorpay: process.env.RAZORPAY_WEBHOOK_SECRET,
    }
    if (secretOverride && event.provider) {
      secrets[event.provider] = secretOverride
    }

    const result = await replay(event.id, {
      storage,
      target,
      resign,
      mode,
      secrets,
    })

    console.log(color.bold(`Replay ${event.id} (${result.mode})`))
    for (const attempt of result.attempts) {
      console.log(
        `  Attempt #${attempt.attempt}: ${formatHttpStatus(attempt.status)} (${attempt.latency_ms}ms)`
      )
    }

    if (result.succeeded) {
      printSuccess(`Replay succeeded with status ${result.finalStatus}`)
    } else {
      printWarn(`Replay finished with non-2xx status ${result.finalStatus}`)
    }
  } finally {
    storage.close()
  }
}
