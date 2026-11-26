import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { sign, verify } from '../../src/signing/stripe.js'

const FIXED_T = 1_700_000_000
const FIXED_PAYLOAD = Buffer.from('hello')
const FIXED_SECRET = 'whsec_test'
const FIXED_V1 = '457c4d31b232d95fcd50f1d95021aaaffddd859d0ee8a206675e84ccc977431d'
const FIXED_HEADER = `t=${FIXED_T},v1=${FIXED_V1}`

describe('stripe signing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_T * 1000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('signs payload matching fixed vector', () => {
    const res = sign(FIXED_PAYLOAD, FIXED_SECRET, { timestamp: FIXED_T })
    expect(res.timestamp).toBe(FIXED_T)
    expect(res.header).toBe(FIXED_HEADER)
  })

  test('signs using current system time when timestamp omitted', () => {
    const res = sign(FIXED_PAYLOAD, FIXED_SECRET)
    expect(res.timestamp).toBe(FIXED_T)
    expect(res.header).toBe(FIXED_HEADER)
  })

  test('verifies fixed vector at matching time', () => {
    expect(verify(FIXED_PAYLOAD, FIXED_SECRET, FIXED_HEADER)).toEqual({ valid: true })
  })

  test('verifies within default 300s tolerance and rejects outside', () => {
    vi.setSystemTime((FIXED_T + 299) * 1000)
    expect(verify(FIXED_PAYLOAD, FIXED_SECRET, FIXED_HEADER)).toEqual({ valid: true })

    vi.setSystemTime((FIXED_T + 301) * 1000)
    expect(verify(FIXED_PAYLOAD, FIXED_SECRET, FIXED_HEADER)).toEqual({
      valid: false,
      reason: 'timestamp_too_old',
    })
  })

  test('respects custom toleranceSecs', () => {
    vi.setSystemTime((FIXED_T + 15) * 1000)
    expect(verify(FIXED_PAYLOAD, FIXED_SECRET, FIXED_HEADER, { toleranceSecs: 10 })).toEqual({
      valid: false,
      reason: 'timestamp_too_old',
    })
  })

  test('rejects wrong secret', () => {
    expect(verify(FIXED_PAYLOAD, 'whsec_wrong', FIXED_HEADER)).toEqual({
      valid: false,
      reason: 'wrong_secret',
    })
  })

  test('rejects modified body', () => {
    const res = verify(Buffer.from('hello!'), FIXED_SECRET, FIXED_HEADER)
    expect(res.valid).toBe(false)
    if (!res.valid) {
      expect(['wrong_secret', 'body_modified']).toContain(res.reason)
    }
  })

  test('rejects truncated signature as body_modified without throwing', () => {
    expect(verify(FIXED_PAYLOAD, FIXED_SECRET, `t=${FIXED_T},v1=deadbeef`)).toEqual({
      valid: false,
      reason: 'body_modified',
    })
  })

  test('rejects malformed headers', () => {
    expect(verify(FIXED_PAYLOAD, FIXED_SECRET, '')).toEqual({
      valid: false,
      reason: 'malformed_header',
    })
    expect(verify(FIXED_PAYLOAD, FIXED_SECRET, `v1=${FIXED_V1}`)).toEqual({
      valid: false,
      reason: 'malformed_header',
    })
    expect(verify(FIXED_PAYLOAD, FIXED_SECRET, `t=${FIXED_T}`)).toEqual({
      valid: false,
      reason: 'malformed_header',
    })
    expect(verify(FIXED_PAYLOAD, FIXED_SECRET, 't=abc,v1=deadbeef')).toEqual({
      valid: false,
      reason: 'malformed_header',
    })
    expect(verify(FIXED_PAYLOAD, FIXED_SECRET, `t=${FIXED_T},v1=not-hex!`)).toEqual({
      valid: false,
      reason: 'malformed_header',
    })
  })

  test('accepts key rotation header with multiple v1 signatures', () => {
    const header = `t=${FIXED_T},v1=0000000000000000000000000000000000000000000000000000000000000000,v1=${FIXED_V1}`
    expect(verify(FIXED_PAYLOAD, FIXED_SECRET, header)).toEqual({ valid: true })
  })
})
