import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { VaultStorage } from '../../src/core/storage.js'
import type { NewCapturedEvent } from '../../src/core/events.js'

function makeEvent(overrides: Partial<NewCapturedEvent> = {}): NewCapturedEvent {
  return {
    timestamp: 1_700_000_000_000,
    method: 'POST',
    path: '/webhooks/stripe',
    headers: { 'content-type': 'application/json' },
    raw_body: '{"id":"evt_1","type":"payment_intent.succeeded"}',
    body_size: 46,
    provider: 'stripe',
    event_type: 'payment_intent.succeeded',
    sig_status: 'valid',
    sig_reason: null,
    handler_status: 200,
    handler_latency_ms: 12,
    ...overrides,
  }
}

describe('VaultStorage', () => {
  let tmpDir: string
  let storage: VaultStorage

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'wv-storage-test-'))
    storage = new VaultStorage(tmpDir)
  })

  afterEach(() => {
    storage.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('inserts and retrieves an event with nanoid id', () => {
    const id = storage.insert(makeEvent())
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(5)

    const fetched = storage.get(id)
    expect(fetched).not.toBeNull()
    expect(fetched!.id).toBe(id)
    expect(fetched!.provider).toBe('stripe')
    expect(fetched!.headers).toEqual({ 'content-type': 'application/json' })
    expect(fetched!.replays).toEqual([])
  })

  test('returns null for unknown event id', () => {
    expect(storage.get('non-existent-id')).toBeNull()
  })

  test('lists events ordered newest first with limit and offset', () => {
    const id1 = storage.insert(makeEvent({ timestamp: 1000 }))
    const id2 = storage.insert(makeEvent({ timestamp: 2000 }))
    const id3 = storage.insert(makeEvent({ timestamp: 3000 }))

    const all = storage.list()
    expect(all.map((e) => e.id)).toEqual([id3, id2, id1])

    const limited = storage.list({ limit: 2 })
    expect(limited.map((e) => e.id)).toEqual([id3, id2])

    const paged = storage.list({ limit: 1, offset: 1 })
    expect(paged.map((e) => e.id)).toEqual([id2])
  })

  test('filters by provider', () => {
    storage.insert(makeEvent({ provider: 'stripe' }))
    storage.insert(makeEvent({ provider: 'github', event_type: 'push' }))
    storage.insert(makeEvent({ provider: 'razorpay', event_type: 'order.paid' }))

    const githubEvents = storage.list({ provider: 'github' })
    expect(githubEvents).toHaveLength(1)
    expect(githubEvents[0].provider).toBe('github')
  })

  test('filters by sigStatus', () => {
    storage.insert(makeEvent({ sig_status: 'valid' }))
    storage.insert(makeEvent({ sig_status: 'invalid', sig_reason: 'wrong_secret' }))
    storage.insert(makeEvent({ sig_status: 'unsigned' }))

    const invalid = storage.list({ sigStatus: 'invalid' })
    expect(invalid).toHaveLength(1)
    expect(invalid[0].sig_reason).toBe('wrong_secret')
  })

  test('appends replay records and throws for missing id', () => {
    const id = storage.insert(makeEvent())
    storage.appendReplay(id, {
      attempt: 1,
      timestamp: 1_700_000_001_000,
      mode: 'once',
      status: 500,
      headers: { 'content-type': 'application/json' },
      body: '{"error":"boom"}',
      latency_ms: 15,
    })
    storage.appendReplay(id, {
      attempt: 2,
      timestamp: 1_700_000_002_000,
      mode: 'once',
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true}',
      latency_ms: 8,
    })

    const fetched = storage.get(id)
    expect(fetched!.replays).toHaveLength(2)
    expect(fetched!.replays[0].status).toBe(500)
    expect(fetched!.replays[1].status).toBe(200)

    expect(() =>
      storage.appendReplay('missing-id', {
        attempt: 1,
        timestamp: 1000,
        mode: 'once',
        status: 200,
        headers: {},
        body: '',
        latency_ms: 1,
      })
    ).toThrow(/Event not found/)
  })

  test('updates handler status and latency', () => {
    const id = storage.insert(makeEvent({ handler_status: null, handler_latency_ms: null }))
    storage.updateHandler(id, 202, 44)
    const fetched = storage.get(id)
    expect(fetched!.handler_status).toBe(202)
    expect(fetched!.handler_latency_ms).toBe(44)
  })

  test('drops raw_body when exceeding default 1 MiB cap while preserving body_size', () => {
    const oversized = 'x'.repeat(1_048_577)
    const id = storage.insert(
      makeEvent({
        raw_body: oversized,
        body_size: Buffer.byteLength(oversized, 'utf8'),
      })
    )

    const fetched = storage.get(id)
    expect(fetched!.raw_body).toBeNull()
    expect(fetched!.body_size).toBe(1_048_577)
  })

  test('respects custom bodySizeLimitBytes cap and preserves bodies within limit', () => {
    const cappedStorage = new VaultStorage(path.join(tmpDir, 'capped'), {
      bodySizeLimitBytes: 100,
    })
    try {
      const smallId = cappedStorage.insert(makeEvent({ raw_body: 'small', body_size: 5 }))
      const largeBody = 'a'.repeat(101)
      const largeId = cappedStorage.insert(makeEvent({ raw_body: largeBody, body_size: 101 }))

      expect(cappedStorage.get(smallId)!.raw_body).toBe('small')
      expect(cappedStorage.get(largeId)!.raw_body).toBeNull()
      expect(cappedStorage.get(largeId)!.body_size).toBe(101)
    } finally {
      cappedStorage.close()
    }
  })

  test('supports in-memory SQLite database', () => {
    const mem = new VaultStorage(':memory:')
    try {
      const id = mem.insert(makeEvent())
      expect(mem.get(id)?.id).toBe(id)
    } finally {
      mem.close()
    }
  })
})
