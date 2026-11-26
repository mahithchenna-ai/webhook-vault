import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Application } from 'express'
import type { VaultConfig } from '../core/config.js'

export type DiagnosticSeverity = 'ok' | 'warn' | 'error'

export interface DiagnosticResult {
  code: string
  severity: DiagnosticSeverity
  message: string
  hint?: string
}

export interface DoctorOptions {
  app?: Application
  config?: VaultConfig
  env?: string
  cwd?: string
  checkGitignore?: boolean
}

interface ExpressLayer {
  name?: string
  route?: unknown
  handle?: {
    __isWebhookVault?: boolean
  }
}

function getRouterStack(app: Application): ExpressLayer[] {
  const anyApp = app as unknown as {
    _router?: { stack?: ExpressLayer[] }
    router?: { stack?: ExpressLayer[] }
  }
  return anyApp._router?.stack ?? anyApp.router?.stack ?? []
}

const BODY_PARSER_LAYERS = new Set(['jsonParser', 'urlencodedParser', 'textParser'])

export function runDoctor(opts: DoctorOptions = {}): DiagnosticResult[] {
  const results: DiagnosticResult[] = []
  const nodeEnv = opts.env ?? process.env.NODE_ENV
  const config = opts.config ?? {}

  if (nodeEnv === 'production' && !config.force) {
    results.push({
      code: 'PRODUCTION_ENV',
      severity: 'error',
      message: 'webhook-vault is running with NODE_ENV=production without force: true',
      hint: 'Disable webhook-vault in production or pass { force: true } only in isolated non-production environments.',
    })
  }

  const secrets = config.secrets ?? {}
  const hasConfigSecret = Boolean(secrets.stripe || secrets.github || secrets.razorpay)
  const hasEnvSecret = Boolean(
    process.env.STRIPE_WEBHOOK_SECRET ||
      process.env.GITHUB_WEBHOOK_SECRET ||
      process.env.RAZORPAY_WEBHOOK_SECRET
  )
  if (!hasConfigSecret && !hasEnvSecret) {
    results.push({
      code: 'MISSING_SECRET',
      severity: 'warn',
      message: 'No webhook signing secrets configured',
      hint: 'Configure secrets: { stripe, github, razorpay } in vault() or set STRIPE_WEBHOOK_SECRET / GITHUB_WEBHOOK_SECRET / RAZORPAY_WEBHOOK_SECRET.',
    })
  }

  if (opts.app) {
    const stack = getRouterStack(opts.app)
    const vaultIndex = stack.findIndex(
      (layer) => layer.handle?.__isWebhookVault === true || layer.name === 'webhookVaultMiddleware'
    )
    const firstBodyParserIndex = stack.findIndex((layer) =>
      BODY_PARSER_LAYERS.has(layer.name ?? '')
    )
    const firstRouteIndex = stack.findIndex((layer) => Boolean(layer.route))

    if (vaultIndex === -1) {
      results.push({
        code: 'VAULT_NOT_MOUNTED',
        severity: 'warn',
        message: 'webhook-vault middleware is not mounted on the Express app',
        hint: 'Mount app.use("/webhooks", vault({ secrets })) before your webhook route handlers.',
      })
    } else {
      if (firstBodyParserIndex !== -1 && firstBodyParserIndex < vaultIndex) {
        results.push({
          code: 'BODY_PRE_PARSED',
          severity: 'error',
          message: 'Body parser middleware runs before webhook-vault, which may alter raw request bytes',
          hint: 'Move app.use("/webhooks", vault(...)) BEFORE app.use(express.json()), or configure express.json({ verify: captureRawBody }).',
        })
      }

      if (firstRouteIndex !== -1 && firstRouteIndex < vaultIndex) {
        results.push({
          code: 'WRONG_MIDDLEWARE_ORDER',
          severity: 'error',
          message: 'Route handlers are registered before webhook-vault middleware',
          hint: 'Register app.use("/webhooks", vault(...)) before your app.post("/webhooks/...", ...) handlers.',
        })
      }
    }
  }

  if (opts.checkGitignore) {
    const cwd = opts.cwd ?? process.cwd()
    const gitignorePath = path.join(cwd, '.gitignore')
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, 'utf8')
      if (!content.includes('.webhook-vault')) {
        results.push({
          code: 'GITIGNORE_MISSING',
          severity: 'warn',
          message: '.webhook-vault/ is not listed in .gitignore',
          hint: 'Add ".webhook-vault/" to your .gitignore so captured payloads are never committed.',
        })
      }
    } else {
      results.push({
        code: 'GITIGNORE_MISSING',
        severity: 'warn',
        message: 'No .gitignore found in project directory',
        hint: 'Create a .gitignore containing ".webhook-vault/" so captured payloads are never committed.',
      })
    }
  }

  return results
}
