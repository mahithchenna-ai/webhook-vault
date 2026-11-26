import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ParsedArgs } from 'minimist'
import { DEFAULT_VAULT_DIR, type ChaosConfig } from '../../core/config.js'
import { CliError, color, printSuccess } from '../utils/print.js'

const PRESETS: Record<'calm' | 'flaky' | 'storm', ChaosConfig> = {
  calm: {
    preset: 'calm',
    duplicates: false,
    delayMs: 0,
    failRate: 0,
    outOfOrder: false,
  },
  flaky: {
    preset: 'flaky',
    duplicates: true,
    delayMs: 400,
    failRate: 0.25,
    outOfOrder: false,
  },
  storm: {
    preset: 'storm',
    duplicates: true,
    delayMs: 1200,
    failRate: 0.5,
    outOfOrder: true,
  },
}

function hasExplicitFlag(flag: string): boolean {
  return process.argv.some(
    (arg) => arg === `--${flag}` || arg.startsWith(`--${flag}=`) || arg === `--no-${flag}`
  )
}

export async function runChaos(args: ParsedArgs): Promise<void> {
  const dir = typeof args.dir === 'string' ? args.dir : DEFAULT_VAULT_DIR
  const chaosPath = path.join(dir, 'chaos.json')

  const hasDuplicatesFlag = hasExplicitFlag('duplicates')
  const hasOutOfOrderFlag = hasExplicitFlag('out-of-order')

  const hasUpdates =
    args.preset !== undefined ||
    hasDuplicatesFlag ||
    args['delay-ms'] !== undefined ||
    args['fail-rate'] !== undefined ||
    hasOutOfOrderFlag

  if (!hasUpdates) {
    if (existsSync(chaosPath)) {
      const current = JSON.parse(readFileSync(chaosPath, 'utf8')) as ChaosConfig
      console.log(color.bold('Current chaos config:'))
      console.log(JSON.stringify(current, null, 2))
    } else {
      console.log(color.bold('Current chaos config (default):'))
      console.log(JSON.stringify(PRESETS.calm, null, 2))
    }
    return
  }

  let base: ChaosConfig = { ...PRESETS.calm }
  if (existsSync(chaosPath)) {
    try {
      base = JSON.parse(readFileSync(chaosPath, 'utf8')) as ChaosConfig
    } catch {
      base = { ...PRESETS.calm }
    }
  }

  if (args.preset !== undefined) {
    const presetName = String(args.preset)
    if (presetName !== 'calm' && presetName !== 'flaky' && presetName !== 'storm') {
      throw new CliError(
        `Invalid chaos preset "${presetName}"`,
        'Use --preset calm, --preset flaky, or --preset storm.'
      )
    }
    base = { ...PRESETS[presetName] }
  }

  if (hasDuplicatesFlag) {
    base.duplicates = Boolean(args.duplicates)
  }
  if (args['delay-ms'] !== undefined) {
    const delay = Number(args['delay-ms'])
    if (!Number.isFinite(delay) || delay < 0) {
      throw new CliError(
        'Invalid --delay-ms value',
        'Pass a non-negative number in milliseconds, e.g. --delay-ms 500.'
      )
    }
    base.delayMs = delay
  }
  if (args['fail-rate'] !== undefined) {
    const rate = Number(args['fail-rate'])
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
      throw new CliError(
        'Invalid --fail-rate value',
        'Pass a probability between 0 and 1, e.g. --fail-rate 0.3.'
      )
    }
    base.failRate = rate
  }
  if (hasOutOfOrderFlag) {
    base.outOfOrder = Boolean(args['out-of-order'])
  }

  mkdirSync(dir, { recursive: true })
  writeFileSync(chaosPath, JSON.stringify(base, null, 2) + '\n', 'utf8')
  printSuccess(`Chaos configuration saved to ${chaosPath}`)
  console.log(JSON.stringify(base, null, 2))
}
