import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import request from 'supertest'
import { afterEach, describe, expect, test } from 'vitest'
import { vault, type VaultMiddleware } from '../../src/express/index.js'
import { replay } from '../../src/replay/index.js'
import { sign as signStripe, verify as verifyStripe } from '../../src/signing/stripe.js'
import { createTestVault } from '../../src/test/index.js'

describe('end-to-end webhook-vault integration', () => {
  const cleanups: Array<() => void | Promise<void>> = []

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop()!
      await fn()
    }
  })

  test('createTestVault delivers signed Stripe webhooks to an Express app via supertest', async () => {
    const secret = 'whsec_e2e_stripe'
    const app = express()
    const seenIds: string[] = []

    app.post('/webhooks/stripe', express.raw({ type: '*/*' }), (req, res) => {
      const sig = String(req.headers['stripe-signature'] ?? '')
      const check = verifyStripe(req.body as Buffer, secret, sig)
      if (!check.valid) {
        res.status(400).json({ error: check.reason })
        return
      }
      const event = JSON.parse((req.body as Buffer).toString('utf8')) as {
        id: string
        synthetic: boolean
      }
      seenIds.push(event.id)
      res.status(200).json({ ok: true, synthetic: event.synthetic })
    })

    const tv = createTestVault({ secrets: { stripe: secret } })
    cleanups.push(() => tv.close())

    const res = await tv.stripe('payment_intent.succeeded', {
      target: app,
      mode: { type: 'duplicate' },
    })

    expect(res.succeeded).toBe(true)
    expect(res.attempts).toHaveLength(2)
    expect(seenIds).toHaveLength(2)
    expect(seenIds[0]).toBe(seenIds[1])
    expect(tv.events()).toHaveLength(1)
    expect(tv.events()[0].replays).toHaveLength(2)
  })

  test('createTestVault delivers GitHub and Razorpay webhooks to Express routes', async () => {
    const app = express()
    app.post('/webhooks/github', express.raw({ type: '*/*' }), (req, res) => {
      res.status(200).json({ event: req.headers['x-github-event'] })
    })
    app.post('/webhooks/razorpay', express.raw({ type: '*/*' }), (_req, res) => {
      res.status(201).json({ captured: true })
    })

    const tv = createTestVault({
      secrets: { github: 'gh_test', razorpay: 'rz_test' },
    })
    cleanups.push(() => tv.close())

    const gh = await tv.github('push', { target: app })
    const rz = await tv.razorpay('order.paid', { target: app })

    expect(gh.finalStatus).toBe(200)
    expect(JSON.parse(gh.attempts[0].body)).toEqual({ event: 'push' })
    expect(rz.finalStatus).toBe(201)
  })

  test('createTestVault delivers to an HTTP URL target via fetch', async () => {
    let attempts = 0
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        attempts++
        if (attempts === 1) {
          res.writeHead(502, { 'content-type': 'text/plain' })
          res.end('bad gateway')
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, size: Buffer.concat(chunks).length }))
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())))

    const port = (server.address() as AddressInfo).port
    const tv = createTestVault({ secrets: { stripe: 'whsec_url' } })
    cleanups.push(() => tv.close())

    const res = await tv.stripe('invoice.payment_failed', {
      target: `http://127.0.0.1:${port}`,
      mode: { type: 'failThenSucceed', maxAttempts: 3, backoffMs: 5 },
    })

    expect(res.succeeded).toBe(true)
    expect(res.attempts).toHaveLength(2)
    expect(res.attempts.map((a) => a.status)).toEqual([502, 200])
  })

  test('captures incoming webhook via vault() and replays with fresh signature against live server', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'wv-e2e-'))
    const secret = 'whsec_live_flow'
    let failFirst = true

    const mw: VaultMiddleware = vault({ secrets: { stripe: secret }, dir: tmpDir })
    cleanups.push(() => {
      mw.close()
      rmSync(tmpDir, { recursive: true, force: true })
    })

    const app = express()
    app.use('/webhooks', mw)
    app.post('/webhooks/stripe', (req, res) => {
      const sig = String(req.headers['stripe-signature'] ?? '')
      const verified = verifyStripe(req.body as Buffer, secret, sig)
      if (!verified.valid) {
        res.status(401).json({ error: verified.reason })
        return
      }
      if (failFirst) {
        failFirst = false
        res.status(500).json({ error: 'initial failure' })
        return
      }
      res.status(200).json({ processed: true })
    })

    const staleTime = Math.floor(Date.now() / 1000) - 600
    const body = JSON.stringify({ id: 'evt_e2e_1', type: 'payment_intent.succeeded' })
    const oldHeader = signStripe(Buffer.from(body), secret, { timestamp: staleTime }).header

    await request(app)
      .post('/webhooks/stripe')
      .set('content-type', 'application/json')
      .set('stripe-signature', oldHeader)
      .send(body)
      .expect(401)

    const [captured] = mw.storage.list()
    expect(captured.sig_status).toBe('invalid')
    expect(captured.sig_reason).toBe('timestamp_too_old')

    const server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
    const port = (server.address() as AddressInfo).port

    // Re-sign and replay to live server (first attempt returns 500, retry succeeds 200!)
    const replayRes = await replay(captured.id, {
      storage: mw.storage,
      target: `http://127.0.0.1:${port}`,
      resign: true,
      secrets: { stripe: secret },
      mode: { type: 'failThenSucceed', maxAttempts: 3, backoffMs: 5 },
    })

    expect(replayRes.succeeded).toBe(true)
    expect(replayRes.attempts.map((a) => a.status)).toEqual([500, 200])
  })
})
