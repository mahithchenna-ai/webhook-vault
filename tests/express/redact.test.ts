import { describe, expect, test } from 'vitest'
import { normalizeHeaders, redactHeaders } from '../../src/express/redact.js'

describe('redactHeaders', () => {
  test('redacts all built-in sensitive headers case-insensitively', () => {
    const input = {
      Authorization: 'Bearer super-secret-token',
      Cookie: 'session=abc123',
      'X-API-Key': 'key_live_123',
      'x-secret': 'my-secret',
      'X-Webhook-Secret': 'whsec_hidden',
      'Content-Type': 'application/json',
    }

    const result = redactHeaders(input)
    expect(result).toEqual({
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      'x-api-key': '[REDACTED]',
      'x-secret': '[REDACTED]',
      'x-webhook-secret': '[REDACTED]',
      'content-type': 'application/json',
    })
  })

  test('preserves webhook signature and provider metadata headers', () => {
    const result = redactHeaders({
      'stripe-signature': 't=123,v1=abc',
      'x-hub-signature-256': 'sha256=def',
      'x-razorpay-signature': 'ghi',
      'x-github-event': 'push',
    })

    expect(result['stripe-signature']).toBe('t=123,v1=abc')
    expect(result['x-hub-signature-256']).toBe('sha256=def')
    expect(result['x-razorpay-signature']).toBe('ghi')
    expect(result['x-github-event']).toBe('push')
  })

  test('redacts extra custom headers case-insensitively', () => {
    const result = redactHeaders(
      {
        'X-Custom-Token': 'secret-val',
        'X-Internal-Auth': 'internal-val',
        'X-Safe': 'ok',
      },
      ['x-custom-token', 'X-INTERNAL-AUTH']
    )

    expect(result['x-custom-token']).toBe('[REDACTED]')
    expect(result['x-internal-auth']).toBe('[REDACTED]')
    expect(result['x-safe']).toBe('ok')
  })

  test('normalizes string arrays and omits undefined values', () => {
    const normalized = normalizeHeaders({
      'x-multi': ['one', 'two'],
      'x-missing': undefined,
    })

    expect(normalized).toEqual({ 'x-multi': 'one, two' })
  })

  test('does not mutate the original headers object', () => {
    const original = { Authorization: 'Bearer abc', 'x-ok': '1' }
    const copy = { ...original }
    redactHeaders(original)
    expect(original).toEqual(copy)
  })
})
