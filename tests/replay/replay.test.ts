import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { NewCapturedEvent } from '../../src/core/events.js'
import { VaultStorage } from '../../src/core/storage.js'
import { replay } from '../../src/replay/index.js'
import { sign as signStripe, verify as verifyStripe } from '../../src/signing/stripe.js'

function insertSampleEvent(
  storage: VaultStorage,
  overrides: Partial<NewCapturedEvent> = {}
): string {
  const payload = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' })
  return storage.insert({
    timestamp: 1_700_000_000_000,
    method: 'POST',
    path: '/webhooks/stripe',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': 't=1700000000,v1=stale',
      authorization: '[REDACTED]',
      host: 'localhost:3000',
    },
    raw_body: payload,
    body_size: Buffer.byteLength(payload),
    provider: 'stripe',
    event_type: 'payment_intent.succeeded',
    sig_status: 'valid',
    sig_reason: null,
    handler_status: 500,
    handler_latency_ms: 10,
    ...overrides,
  })
}

describe('replay engine', () => {
  let storage: VaultStorage

  beforeEach(() => {
    storage = new VaultStorage(':memory:')
  })

  afterEach(() => {
    storage.close()
  })

  test('replays once and records attempt in storage', async () => {
    const id = insertSampleEvent(storage)
    const mockFetch = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))

    const result = await replay(id, {
      storage,
      target: 'http://localhost:4000',
      mode: { type: 'once' },
      fetchImpl: mockFetch as typeof fetch,
    })

    expect(result.succeeded).toBe(true)
    expect(result.finalStatus).toBe(200)
    expect(result.attempts).toHaveLength(1)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:4000/webhooks/stripe')

    const updated = storage.get(id)!
    expect(updated.replays).toHaveLength(1)
    expect(updated.replays[0].status).toBe(200)
    expect(updated.replays[0].body).toBe('{"ok":true}')
  })

  test('replays in duplicate mode with 2 identical deliveries', async () => {
    const id = insertSampleEvent(storage)
    const mockFetch = vi.fn(async () => new Response('ok', { status: 200 }))

    const result = await replay(id, {
      storage,
      target: 'http://localhost:4000/custom',
      mode: { type: 'duplicate' },
      fetchImpl: mockFetch as typeof fetch,
    })

    expect(result.attempts).toHaveLength(2)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:4000/custom')
    expect(storage.get(id)!.replays).toHaveLength(2)
  })

  test('retries on failure in failThenSucceed mode until 2xx', async () => {
    const id = insertSampleEvent(storage)
    let callCount = 0
    const mockFetch = vi.fn(async () => {
      callCount++
      if (callCount < 3) {
        return new Response('temporary outage', { status: 503 })
      }
      return new Response('recovered', { status: 200 })
    })

    const start = Date.now()
    const result = await replay(id, {
      storage,
      target: 'http://localhost:4000',
      mode: { type: 'failThenSucceed', maxAttempts: 4, backoffMs: 15 },
      fetchImpl: mockFetch as typeof fetch,
    })
    const elapsed = Date.now() - start

    expect(result.succeeded).toBe(true)
    expect(result.finalStatus).toBe(200)
    expect(result.attempts.map((a) => a.status)).toEqual([503, 503, 200])
    // 15ms + 30ms backoff waits
    expect(elapsed).toBeGreaterThanOrEqual(35)
    expect(storage.get(id)!.replays).toHaveLength(3)
  })

  test('stops after maxAttempts when server keeps failing', async () => {
    const id = insertSampleEvent(storage)
    const mockFetch = vi.fn(async () => new Response('down', { status: 500 }))

    const result = await replay(id, {
      storage,
      target: 'http://localhost:4000',
      mode: { type: 'failThenSucceed', maxAttempts: 3, backoffMs: 5 },
      fetchImpl: mockFetch as typeof fetch,
    })

    expect(result.succeeded).toBe(false)
    expect(result.finalStatus).toBe(500)
    expect(result.attempts).toHaveLength(3)
  })

  test('replays multiple events in outOfOrder sequence', async () => {
    const id1 = insertSampleEvent(storage, { event_type: 'first' })
    const id2 = insertSampleEvent(storage, { event_type: 'second' })
    const id3 = insertSampleEvent(storage, { event_type: 'third' })

    const seenTypes: string[] = []
    const mockFetch = vi.fn(async (_url, init) => {
      const parsed = JSON.parse(String(init?.body ?? '{}'))
      seenTypes.push(parsed.type ?? 'unknown')
      return new Response('ok', { status: 200 })
    })

    // Rewrite distinct raw bodies so we can trace exact order
    const idA = insertSampleEvent(storage, { raw_body: '{"seq":1}' })
    const idB = insertSampleEvent(storage, { raw_body: '{"seq":2}' })
    const idC = insertSampleEvent(storage, { raw_body: '{"seq":3}' })
    expect(id1 && id2 && id3).toBeTruthy()

    const seqMock = vi.fn(async (_url, init) => {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as { seq: number }
      seenTypes.push(String(parsed.seq))
      return new Response('ok', { status: 200 })
    })

    const result = await replay(idA, {
      storage,
      target: 'http://localhost:4000',
      mode: { type: 'outOfOrder', sequence: [idC, idA, idB] },
      fetchImpl: seqMock as typeof fetch,
    })

    expect(mockFetch).not.toHaveBeenCalled()
    expect(seenTypes).toEqual(['3', '1', '2'])
    expect(result.attempts).toHaveLength(3)
  })

  test('re-signs payload with fresh timestamp when resign is true and strips redacted headers', async () => {
    const secret = 'whsec_resign_secret'
    const payload = '{"id":"evt_old","type":"payment_intent.succeeded"}'
    const oldSig = signStripe(Buffer.from(payload), secret, { timestamp: 1_500_000_000 }).header
    const id = insertSampleEvent(storage, {
      raw_body: payload,
      headers: {
        'content-type': 'application/json',
        'stripe-signature': oldSig,
        authorization: '[REDACTED]',
        host: 'oldhost:3000',
      },
    })

    let capturedHeaders: Record<string, string> = {}
    const mockFetch = vi.fn(async (_url, init) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>
      return new Response('ok', { status: 200 })
    })

    await replay(id, {
      storage,
      target: 'http://localhost:4000',
      resign: true,
      secrets: { stripe: secret },
      fetchImpl: mockFetch as typeof fetch,
    })

    expect(capturedHeaders.authorization).toBeUndefined()
    expect(capturedHeaders.host).toBeUndefined()
    expect(capturedHeaders['stripe-signature']).not.toBe(oldSig)
    expect(verifyStripe(Buffer.from(payload), secret, capturedHeaders['stripe-signature'])).toEqual({
      valid: true,
    })
  })

  test('throws clear error when resign requested without secret or event missing', async () => {
    const id = insertSampleEvent(storage)
    const mockFetch = vi.fn(async () => new Response('ok', { status: 200 }))

    await expect(
      replay(id, {
        storage,
        target: 'http://localhost:4000',
        resign: true,
        fetchImpl: mockFetch as typeof fetch,
      })
    ).rejects.toThrow(/missing signing secret/i)

    await expect(
      replay('does-not-exist', {
        storage,
        target: 'http://localhost:4000',
        fetchImpl: mockFetch as typeof fetch,
      })
    ).rejects.toThrow(/Event not found/)
  })
})
