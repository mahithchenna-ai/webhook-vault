import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { VaultServer } from '../../src/core/sse.js'
import { VaultStorage } from '../../src/core/storage.js'

describe('VaultServer dashboard & SSE API', () => {
  const cleanups: Array<() => Promise<void> | void> = []

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()!()
    }
  })

  test('serves built static assets, REST APIs, chaos config, and SSE stream', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'wv-server-test-'))
    const storage = new VaultStorage(tmpDir)
    const server = new VaultServer({ storage, dir: tmpDir, port: 0 })

    cleanups.push(async () => {
      await server.stop()
      storage.close()
      rmSync(tmpDir, { recursive: true, force: true })
    })

    const port = await server.start()
    const base = `http://127.0.0.1:${port}`

    // Static UI index
    const htmlRes = await fetch(`${base}/_vault/`)
    expect(htmlRes.status).toBe(200)
    const html = await htmlRes.text()
    expect(html).toContain('<div id="app"></div>')

    // Insert and list via REST API
    const id = storage.insert({
      timestamp: Date.now(),
      method: 'POST',
      path: '/webhooks/stripe',
      headers: { 'content-type': 'application/json' },
      raw_body: '{"type":"payment_intent.succeeded"}',
      body_size: 35,
      provider: 'stripe',
      event_type: 'payment_intent.succeeded',
      sig_status: 'valid',
      sig_reason: null,
      handler_status: 200,
      handler_latency_ms: 5,
    })

    const listRes = await fetch(`${base}/_vault/api/events`)
    expect(listRes.status).toBe(200)
    const listData = (await listRes.json()) as { events: Array<{ id: string }> }
    expect(listData.events.map((e) => e.id)).toContain(id)

    // Chaos GET & POST
    const chaosPost = await fetch(`${base}/_vault/api/chaos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: 'flaky', delayMs: 250, failRate: 0.25 }),
    })
    expect(chaosPost.status).toBe(200)
    const chaosGet = await fetch(`${base}/_vault/api/chaos`)
    const chaosJson = (await chaosGet.json()) as { chaos: { preset: string; delayMs: number } }
    expect(chaosJson.chaos.preset).toBe('flaky')
    expect(chaosJson.chaos.delayMs).toBe(250)

    // Replay endpoint against a live target server
    const targetServer = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"replayed":true}')
    })
    await new Promise<void>((resolve) => targetServer.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => new Promise<void>((resolve) => targetServer.close(() => resolve())))
    const targetPort = (targetServer.address() as AddressInfo).port

    const replayRes = await fetch(`${base}/_vault/api/events/${id}/replay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'once', target: `http://127.0.0.1:${targetPort}` }),
    })
    expect(replayRes.status).toBe(200)
    const replayJson = (await replayRes.json()) as { result: { succeeded: boolean; finalStatus: number } }
    expect(replayJson.result.succeeded).toBe(true)
    expect(replayJson.result.finalStatus).toBe(200)

    // SSE stream receives broadcast events
    const abort = new AbortController()
    const sseRes = await fetch(`${base}/_vault/events`, { signal: abort.signal })
    expect(sseRes.status).toBe(200)
    expect(sseRes.headers.get('content-type')).toContain('text/event-stream')

    const reader = sseRes.body!.getReader()
    const decoder = new TextDecoder()
    const firstChunk = await reader.read()
    expect(decoder.decode(firstChunk.value)).toContain(': connected')

    const ev = storage.get(id)!
    server.broadcast(ev)

    const secondChunk = await reader.read()
    const frame = decoder.decode(secondChunk.value)
    expect(frame).toContain(`"id":"${id}"`)
    abort.abort()
  })
})
