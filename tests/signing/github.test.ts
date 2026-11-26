import { describe, expect, test } from 'vitest'
import { sign, verify } from '../../src/signing/github.js'

const FIXED_PAYLOAD = Buffer.from('hello')
const FIXED_SECRET = 'ghsec'
const FIXED_HEADER =
  'sha256=a8d7e844a3217c5453501820205c6826aa1665b2c334e20c336e1b2ce8b83dd8'

describe('github signing', () => {
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
    expect(verify(FIXED_PAYLOAD, FIXED_SECRET, 'sha256=deadbeef')).toEqual({
      valid: false,
      reason: 'body_modified',
    })
  })

  test('rejects malformed headers', () => {
    expect(verify(FIXED_PAYLOAD, FIXED_SECRET, '')).toEqual({
      valid: false,
      reason: 'malformed_header',
    })
    expect(verify(FIXED_PAYLOAD, FIXED_SECRET, 'a8d7e844')).toEqual({
      valid: false,
      reason: 'malformed_header',
    })
    expect(verify(FIXED_PAYLOAD, FIXED_SECRET, 'sha256=zzzz')).toEqual({
      valid: false,
      reason: 'malformed_header',
    })
  })
})
