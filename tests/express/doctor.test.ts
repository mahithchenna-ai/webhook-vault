import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { runDoctor, vault, type VaultMiddleware } from '../../src/express/index.js'

describe('runDoctor', () => {
  let tmpDir: string
  let activeMw: VaultMiddleware | null = null

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'wv-doctor-test-'))
  })

  afterEach(() => {
    if (activeMw) {
      activeMw.close()
      activeMw = null
    }
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('returns empty diagnostics when Express order, secrets, and env are healthy', () => {
    const mw = vault({ secrets: { stripe: 'whsec_ok' }, dir: tmpDir })
    activeMw = mw
    const app = express()
    app.use('/webhooks', mw)
    app.post('/webhooks/stripe', (_req, res) => res.sendStatus(200))

    const results = runDoctor({
      app,
      config: { secrets: { stripe: 'whsec_ok' } },
      env: 'development',
    })
    expect(results).toEqual([])
  })

  test('detects running in production without force', () => {
    const results = runDoctor({
      config: { secrets: { stripe: 'whsec_ok' }, force: false },
      env: 'production',
    })
    expect(results.some((r) => r.code === 'PRODUCTION_ENV' && r.severity === 'error')).toBe(true)

    const forced = runDoctor({
      config: { secrets: { stripe: 'whsec_ok' }, force: true },
      env: 'production',
    })
    expect(forced.some((r) => r.code === 'PRODUCTION_ENV')).toBe(false)
  })

  test('detects missing signing secrets', () => {
    const prevStripe = process.env.STRIPE_WEBHOOK_SECRET
    const prevGithub = process.env.GITHUB_WEBHOOK_SECRET
    const prevRazor = process.env.RAZORPAY_WEBHOOK_SECRET
    delete process.env.STRIPE_WEBHOOK_SECRET
    delete process.env.GITHUB_WEBHOOK_SECRET
    delete process.env.RAZORPAY_WEBHOOK_SECRET

    try {
      const results = runDoctor({ config: {}, env: 'development' })
      expect(results.some((r) => r.code === 'MISSING_SECRET' && r.severity === 'warn')).toBe(true)
    } finally {
      if (prevStripe !== undefined) process.env.STRIPE_WEBHOOK_SECRET = prevStripe
      if (prevGithub !== undefined) process.env.GITHUB_WEBHOOK_SECRET = prevGithub
      if (prevRazor !== undefined) process.env.RAZORPAY_WEBHOOK_SECRET = prevRazor
    }
  })

  test('detects body pre-parsed when express.json() precedes vault()', () => {
    const mw = vault({ secrets: { stripe: 'whsec_ok' }, dir: tmpDir })
    activeMw = mw
    const app = express()
    app.use(express.json())
    app.use('/webhooks', mw)
    app.post('/webhooks/stripe', (_req, res) => res.sendStatus(200))

    const results = runDoctor({
      app,
      config: { secrets: { stripe: 'whsec_ok' } },
      env: 'development',
    })
    expect(results.some((r) => r.code === 'BODY_PRE_PARSED' && r.severity === 'error')).toBe(true)
  })

  test('detects wrong middleware order when routes are registered before vault()', () => {
    const mw = vault({ secrets: { stripe: 'whsec_ok' }, dir: tmpDir })
    activeMw = mw
    const app = express()
    app.post('/webhooks/stripe', (_req, res) => res.sendStatus(200))
    app.use('/webhooks', mw)

    const results = runDoctor({
      app,
      config: { secrets: { stripe: 'whsec_ok' } },
      env: 'development',
    })
    expect(
      results.some((r) => r.code === 'WRONG_MIDDLEWARE_ORDER' && r.severity === 'error')
    ).toBe(true)
  })

  test('detects when vault middleware is not mounted on app', () => {
    const app = express()
    app.post('/webhooks/stripe', (_req, res) => res.sendStatus(200))

    const results = runDoctor({
      app,
      config: { secrets: { stripe: 'whsec_ok' } },
      env: 'development',
    })
    expect(results.some((r) => r.code === 'VAULT_NOT_MOUNTED')).toBe(true)
  })

  test('checks .gitignore when checkGitignore is enabled', () => {
    writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules/\n', 'utf8')
    const missing = runDoctor({
      config: { secrets: { stripe: 'whsec_ok' } },
      env: 'development',
      cwd: tmpDir,
      checkGitignore: true,
    })
    expect(missing.some((r) => r.code === 'GITIGNORE_MISSING')).toBe(true)

    writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules/\n.webhook-vault/\n', 'utf8')
    const present = runDoctor({
      config: { secrets: { stripe: 'whsec_ok' } },
      env: 'development',
      cwd: tmpDir,
      checkGitignore: true,
    })
    expect(present.some((r) => r.code === 'GITIGNORE_MISSING')).toBe(false)
  })
})
