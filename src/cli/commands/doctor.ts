import type { ParsedArgs } from 'minimist'
import { DEFAULT_VAULT_DIR } from '../../core/config.js'
import { VaultStorage } from '../../core/storage.js'
import { runDoctor as inspectSetup } from '../../express/doctor.js'
import { color, printError, printSuccess, printWarn } from '../utils/print.js'

export async function runDoctorCommand(args: ParsedArgs): Promise<void> {
  const dir = typeof args.dir === 'string' ? args.dir : DEFAULT_VAULT_DIR
  const diagnostics = inspectSetup({
    cwd: process.cwd(),
    checkGitignore: true,
    env: process.env.NODE_ENV,
  })

  try {
    const storage = new VaultStorage(dir)
    const count = storage.list({ limit: 1 }).length
    storage.close()
    printSuccess(`SQLite vault storage reachable at ${dir}/vault.db (${count > 0 ? 'events present' : 'empty'})`)
  } catch (err) {
    diagnostics.push({
      code: 'STORAGE_UNREACHABLE',
      severity: 'error',
      message: `Cannot open SQLite storage at ${dir}/vault.db: ${(err as Error).message}`,
      hint: 'Check directory permissions and ensure better-sqlite3 native bindings are built.',
    })
  }

  if (diagnostics.length === 0) {
    printSuccess('All diagnostics passed. Your webhook-vault setup looks healthy.')
    return
  }

  let hasErrors = false
  console.log('')
  for (const item of diagnostics) {
    if (item.severity === 'error') {
      hasErrors = true
      printError(`[${item.code}] ${item.message}`, item.hint)
    } else if (item.severity === 'warn') {
      printWarn(`[${item.code}] ${item.message}`)
      if (item.hint) {
        console.log(color.dim(`  Hint: ${item.hint}`))
      }
    } else {
      printSuccess(`[${item.code}] ${item.message}`)
    }
  }

  if (hasErrors) {
    process.exitCode = 1
  }
}
