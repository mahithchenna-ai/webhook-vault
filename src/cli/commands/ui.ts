import type { ParsedArgs } from 'minimist'
import { DEFAULT_DASHBOARD_PORT, DEFAULT_VAULT_DIR } from '../../core/config.js'
import { VaultServer } from '../../core/sse.js'
import { VaultStorage } from '../../core/storage.js'
import { openBrowser } from '../utils/open-browser.js'
import { CliError, printInfo, printSuccess } from '../utils/print.js'

export async function runUi(args: ParsedArgs): Promise<void> {
  const dir = typeof args.dir === 'string' ? args.dir : DEFAULT_VAULT_DIR
  const port = typeof args.port === 'number' ? args.port : DEFAULT_DASHBOARD_PORT
  const shouldOpen = args.open !== false

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CliError('Invalid --port value', 'Use a TCP port between 1 and 65535, e.g. --port 4400.')
  }

  const storage = new VaultStorage(dir)
  const server = new VaultServer({ storage, dir, port })

  const actualPort = await server.start()
  const url = `http://127.0.0.1:${actualPort}/_vault/`

  printSuccess(`webhook-vault dashboard running at ${url}`)
  printInfo('Press Ctrl+C to stop.')

  if (shouldOpen) {
    openBrowser(url)
  }

  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      await server.stop()
      storage.close()
      resolve()
    }
    process.once('SIGINT', () => void shutdown())
    process.once('SIGTERM', () => void shutdown())
  })
}
