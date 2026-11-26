import { describe, expect, test } from 'vitest'
import { sign, verify } from '../../src/signing/razorpay.js'

const FIXED_PAYLOAD = Buffer.from('hello')
const FIXED_SECRET = 'rzsec'
const FIXED_HEADER = '157950b69bf2bced95c476d07a3da5c10427c21e19a95acef161969e43a11fbd'

describe('razorpay signing', () => {
  test('signs payload matching fixed vector', () => {
    expect(sign(FIXED_PAYLOAD, FIXED_SECRET)).toEqual({ header: FIXED_HEADER })
  })

  test('verifies fixed vector', () => {
    expect(verify(FIXED_PAYLOAD, FIXED_SECRET, FIXED_HEADER)).toEqual({ valid: true })
  })

  test('rejects wrong secret', () => {
    expect(verify(FIXED_PAYLOAD, 'wrong_secret', FIXED_HEADER)).toEqual({
      valid: false,
      reason: 'wrong_secret',
    })
  })

  test('rejects modified body', () => {
    const res = verify(Buffer.from('tampered'), FIXED_SECRET, FIXED_HEADER)
    expect(res.valid).toBe(false)
  })

  test('rejects truncated digest without throwing', () => {
    expect(verify(FIXED_PAYLOAD, FIXED_SECRET, 'deadbeef')).toEqual({
      valid: false,
      reason: 'body_modified',
    })
  })

  test('rejects malformed headers', () => {
    expect(verify(FIXED_PAYLOAD, FIXED_SECRET, '')).toEqual({
      valid: false,
      reason: 'malformed_header',
    })
    expect(verify(FIXED_PAYLOAD, FIXED_SECRET, 'sha256=' + FIXED_HEADER)).toEqual({
      valid: false,
      reason: 'malformed_header',
    })
    expect(verify(FIXED_PAYLOAD, FIXED_SECRET, 'not-hex!')).toEqual({
      valid: false,
      reason: 'malformed_header',
    })
  })
})
