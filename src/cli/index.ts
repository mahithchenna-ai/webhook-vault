#!/usr/bin/env node
import minimist from 'minimist'
import { VERSION } from '../core/index.js'
import { runChaos } from './commands/chaos.js'
import { runDemo } from './commands/demo.js'
import { runDoctorCommand } from './commands/doctor.js'
import { runList } from './commands/list.js'
import { runReplay } from './commands/replay.js'
import { runShare } from './commands/share.js'
import { runShow } from './commands/show.js'
import { runUi } from './commands/ui.js'
import { CliError, color, printError } from './utils/print.js'

function printHelp(): void {
  console.log(`${color.bold('webhook-vault')} v${VERSION}
Local-first webhook capture, signed-replay and failure-simulation toolkit

${color.bold('USAGE')}
  webhook-vault <command> [options]

${color.bold('COMMANDS')}
  ui                            Start the local dev dashboard (port 4400)
  demo --target <url>           Seed and fire all 9 synthetic events at target
  list [options]                List captured events (--provider, --status, --limit)
  show <id|last>                Show full details of a captured event
  replay <id|last> [options]    Replay an event (--resign, --mode, --target)
  chaos [options]               Configure chaos simulation (--preset, --delay-ms, --fail-rate)
  doctor                        Inspect local setup and middleware diagnostics
  share <id|last>               Export redacted JSON + copy-paste curl command

${color.bold('GLOBAL OPTIONS')}
  --dir <path>                  Vault storage directory (default: .webhook-vault)
  --debug                       Show stack traces on error
  -h, --help                    Show this help message
  -v, --version                 Show version
`)
}

async function main(): Promise<void> {
  const command = process.argv[2]
  const rawArgs = process.argv.slice(3)
  const parsed = minimist(rawArgs, {
    boolean: ['help', 'version', 'debug', 'resign', 'duplicates', 'out-of-order', 'open'],
    alias: { h: 'help', v: 'version' },
    default: { open: true },
  })

  if (!command || command === '-h' || command === '--help' || command === 'help') {
    printHelp()
    return
  }

  if (command === '-v' || command === '--version' || parsed.version) {
    console.log(VERSION)
    return
  }

  if (parsed.help) {
    printHelp()
    return
  }

  try {
    switch (command) {
      case 'ui':
        await runUi(parsed)
        break
      case 'demo':
        await runDemo(parsed)
        break
      case 'list':
        await runList(parsed)
        break
      case 'show':
        await runShow(parsed)
        break
      case 'replay':
        await runReplay(parsed)
        break
      case 'chaos':
        await runChaos(parsed)
        break
      case 'doctor':
        await runDoctorCommand(parsed)
        break
      case 'share':
        await runShare(parsed)
        break
      default:
        throw new CliError(
          `Unknown command "${command}"`,
          'Run "webhook-vault --help" to see all available commands.'
        )
    }
  } catch (err) {
    if (err instanceof CliError) {
      printError(err.message, err.hint)
    } else if (err instanceof Error) {
      printError(err.message, 'Run with --debug to inspect the full stack trace.')
    } else {
      printError(String(err))
    }

    if (parsed.debug && err instanceof Error && err.stack) {
      console.error('\n' + err.stack)
    }
    process.exitCode = 1
  }
}

void main()
