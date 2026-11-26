import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { captureRawBody, vault, type VaultMiddleware } from '../../src/express/index.js'
import { sign as signGithub } from '../../src/signing/github.js'
import { sign as signRazorpay } from '../../src/signing/razorpay.js'
import { sign as signStripe } from '../../src/signing/stripe.js'

describe('express vault capture middleware', () => {
  let tmpDir: string
  let activeMiddleware: VaultMiddleware | null = null
  const origEnv = process.env.NODE_ENV

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'wv-express-test-'))
    process.env.NODE_ENV = 'test'
  })

  afterEach(() => {
    if (activeMiddleware) {
      activeMiddleware.close()
      activeMiddleware = null
    }
    process.env.NODE_ENV = origEnv
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('captures valid Stripe webhook, verifies signature, and stores handler status', async () => {
    const secret = 'whsec_test_secret_never_log'
    const payload = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' })
    const { header } = signStripe(Buffer.from(payload), secret)

    const onEvent = vi.fn()
    const mw = vault({
      secrets: { stripe: secret },
      dir: tmpDir,
      redactHeaders: ['x-tenant-token'],
      onEvent,
    })
    activeMiddleware = mw

    const app = express()
    app.use('/webhooks', mw)
    app.post('/webhooks/stripe', (_req, res) => {
      res.status(200).json({ received: true })
    })

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('content-type', 'application/json')
      .set('stripe-signature', header)
      .set('authorization', 'Bearer super-secret-auth')
      .set('x-tenant-token', 'tenant-secret')
      .send(payload)

    expect(res.status).toBe(200)

    const events = mw.storage.list()
    expect(events).toHaveLength(1)
    const ev = events[0]
    expect(ev.provider).toBe('stripe')
    expect(ev.event_type).toBe('payment_intent.succeeded')
    expect(ev.sig_status).toBe('valid')
    expect(ev.sig_reason).toBeNull()
    expect(ev.handler_status).toBe(200)
    expect(ev.raw_body).toBe(payload)
    expect(ev.body_size).toBe(Buffer.byteLength(payload))
    expect(ev.headers.authorization).toBe('[REDACTED]')
    expect(ev.headers['x-tenant-token']).toBe('[REDACTED]')
    expect(onEvent).toHaveBeenCalledTimes(1)

    // Ensure secret values are never persisted in the SQLite file on disk
    const dbBytes = readFileSync(path.join(tmpDir, 'vault.db')).toString('utf8')
    expect(dbBytes).not.toContain(secret)
    expect(dbBytes).not.toContain('super-secret-auth')
    expect(dbBytes).not.toContain('tenant-secret')
  })

  test('captures invalid Stripe signature with reason', async () => {
    const payload = JSON.stringify({ type: 'invoice.payment_failed' })
    const { header } = signStripe(Buffer.from(payload), 'whsec_other')

    const mw = vault({ secrets: { stripe: 'whsec_expected' }, dir: tmpDir })
    activeMiddleware = mw

    const app = express()
    app.use('/webhooks', mw)
    app.post('/webhooks/stripe', (_req, res) => res.status(400).send('bad sig'))

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('content-type', 'application/json')
      .set('stripe-signature', header)
      .send(payload)

    expect(res.status).toBe(400)
    const events = mw.storage.list()
    expect(events).toHaveLength(1)
    expect(events[0].sig_status).toBe('invalid')
    expect(events[0].sig_reason).toBe('wrong_secret')
    expect(events[0].handler_status).toBe(400)
  })

  test('captures GitHub webhook with x-hub-signature-256 and x-github-event', async () => {
    const payload = JSON.stringify({ ref: 'refs/heads/main' })
    const { header } = signGithub(Buffer.from(payload), 'gh_secret')

    const mw = vault({ secrets: { github: 'gh_secret' }, dir: tmpDir })
    activeMiddleware = mw

    const app = express()
    app.use('/webhooks', mw)
    app.post('/webhooks/github', (_req, res) => res.status(204).end())

    await request(app)
      .post('/webhooks/github')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', header)
      .set('x-github-event', 'push')
      .send(payload)
      .expect(204)

    const [ev] = mw.storage.list()
    expect(ev.provider).toBe('github')
    expect(ev.event_type).toBe('push')
    expect(ev.sig_status).toBe('valid')
    expect(ev.handler_status).toBe(204)
  })

  test('captures Razorpay webhook with x-razorpay-signature', async () => {
    const payload = JSON.stringify({ event: 'order.paid' })
    const { header } = signRazorpay(Buffer.from(payload), 'rz_secret')

    const mw = vault({ secrets: { razorpay: 'rz_secret' }, dir: tmpDir })
    activeMiddleware = mw

    const app = express()
    app.use('/webhooks', mw)
    app.post('/webhooks/razorpay', (_req, res) => res.status(200).json({ ok: true }))

    await request(app)
      .post('/webhooks/razorpay')
      .set('content-type', 'application/json')
      .set('x-razorpay-signature', header)
      .send(payload)
      .expect(200)

    const [ev] = mw.storage.list()
    expect(ev.provider).toBe('razorpay')
    expect(ev.event_type).toBe('order.paid')
    expect(ev.sig_status).toBe('valid')
  })

  test('marks unsigned when no signature header or no matching secret', async () => {
    const mw = vault({ dir: tmpDir })
    activeMiddleware = mw

    const app = express()
    app.use('/webhooks', mw)
    app.post('/webhooks/custom', (_req, res) => res.status(200).send('ok'))

    await request(app)
      .post('/webhooks/custom')
      .set('content-type', 'application/json')
      .send('{"hello":"world"}')
      .expect(200)

    const [ev] = mw.storage.list()
    expect(ev.provider).toBeNull()
    expect(ev.sig_status).toBe('unsigned')
  })

  test('works with upstream express.json({ verify: captureRawBody }) preserving whitespace', async () => {
    const secret = 'whsec_upstream'
    // Deliberately non-compact formatting to prove raw buffer (not JSON.stringify) is verified
    const rawPayload = '{  "type" :  "payment_intent.succeeded" }'
    const { header } = signStripe(Buffer.from(rawPayload), secret)

    const mw = vault({ secrets: { stripe: secret }, dir: tmpDir })
    activeMiddleware = mw

    const app = express()
    app.use(express.json({ verify: captureRawBody }))
    app.use('/webhooks', mw)
    app.post('/webhooks/stripe', (req, res) => {
      expect(req.body).toEqual({ type: 'payment_intent.succeeded' })
      res.status(200).json({ ok: true })
    })

    await request(app)
      .post('/webhooks/stripe')
      .set('content-type', 'application/json')
      .set('stripe-signature', header)
      .send(rawPayload)
      .expect(200)

    const [ev] = mw.storage.list()
    expect(ev.sig_status).toBe('valid')
    expect(ev.raw_body).toBe(rawPayload)
  })

  test('captures 500 status from failing downstream handler', async () => {
    const mw = vault({ dir: tmpDir })
    activeMiddleware = mw

    const app = express()
    app.use('/webhooks', mw)
    app.post('/webhooks/fail', (_req, res) => res.status(500).json({ error: 'db down' }))

    await request(app)
      .post('/webhooks/fail')
      .set('content-type', 'application/json')
      .send('{"type":"test"}')
      .expect(500)

    const [ev] = mw.storage.list()
    expect(ev.handler_status).toBe(500)
    expect(typeof ev.handler_latency_ms).toBe('number')
  })

  test('drops raw_body when upstream parser exceeds vault bodySizeLimitBytes', async () => {
    const mw = vault({ dir: tmpDir, bodySizeLimitBytes: 50 })
    activeMiddleware = mw

    const largeObj = { data: 'a'.repeat(100) }
    const rawPayload = JSON.stringify(largeObj)

    const app = express()
    app.use(express.json({ limit: '1mb', verify: captureRawBody }))
    app.use('/webhooks', mw)
    app.post('/webhooks/large', (_req, res) => res.status(200).send('ok'))

    await request(app)
      .post('/webhooks/large')
      .set('content-type', 'application/json')
      .send(rawPayload)
      .expect(200)

    const [ev] = mw.storage.list()
    expect(ev.raw_body).toBeNull()
    expect(ev.body_size).toBe(Buffer.byteLength(rawPayload))
  })

  test('throws in production unless force is true', () => {
    process.env.NODE_ENV = 'production'
    expect(() => vault({ dir: tmpDir })).toThrow(/production/i)

    const forced = vault({ dir: tmpDir, force: true })
    activeMiddleware = forced
    expect(forced).toBeTypeOf('function')
  })
})
