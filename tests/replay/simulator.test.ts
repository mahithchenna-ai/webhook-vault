import { describe, expect, test } from 'vitest'
import {
  ALL_SYNTHETIC_EVENTS,
  generateSyntheticEvent,
  simulators,
} from '../../src/replay/simulator.js'
import { verify as verifyGithub } from '../../src/signing/github.js'
import { verify as verifyRazorpay } from '../../src/signing/razorpay.js'
import { verify as verifyStripe } from '../../src/signing/stripe.js'

describe('synthetic webhook simulator', () => {
  test('includes all 9 supported provider events', () => {
    expect(ALL_SYNTHETIC_EVENTS).toHaveLength(9)
  })

  test.each([
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'invoice.payment_failed',
  ] as const)('generates verifiable Stripe %s event with synthetic: true', (eventType) => {
    const secret = 'whsec_sim_stripe'
    const now = Math.floor(Date.now() / 1000)
    const { headers, body } = simulators.stripe[eventType].generate(secret, { timestamp: now })

    const parsed = JSON.parse(body.toString('utf8')) as Record<string, unknown>
    expect(parsed.synthetic).toBe(true)
    expect(parsed.type).toBe(eventType)
    expect(headers['stripe-signature']).toContain(`t=${now},v1=`)
    expect(verifyStripe(body, secret, headers['stripe-signature'])).toEqual({ valid: true })
  })

  test.each(['push', 'pull_request'] as const)(
    'generates verifiable GitHub %s event with synthetic: true',
    (eventType) => {
      const secret = 'ghsec_sim'
      const { headers, body } = simulators.github[eventType].generate(secret)

      const parsed = JSON.parse(body.toString('utf8')) as Record<string, unknown>
      expect(parsed.synthetic).toBe(true)
      expect(headers['x-github-event']).toBe(eventType)
      expect(headers['x-github-delivery']).toBeTruthy()
      expect(verifyGithub(body, secret, headers['x-hub-signature-256'])).toEqual({ valid: true })
    }
  )

  test.each([
    'payment.authorized',
    'payment.captured',
    'payment.failed',
    'order.paid',
  ] as const)('generates verifiable Razorpay %s event with synthetic: true', (eventType) => {
    const secret = 'rzsec_sim'
    const { headers, body } = simulators.razorpay[eventType].generate(secret)

    const parsed = JSON.parse(body.toString('utf8')) as Record<string, unknown>
    expect(parsed.synthetic).toBe(true)
    expect(parsed.event).toBe(eventType)
    expect(verifyRazorpay(body, secret, headers['x-razorpay-signature'])).toEqual({ valid: true })
  })

  test('applies overrides while keeping synthetic flag forced true', () => {
    const { body } = generateSyntheticEvent('stripe', 'payment_intent.succeeded', 'whsec_123', {
      overrides: { synthetic: false, customField: 'abc' },
    })
    const parsed = JSON.parse(body.toString('utf8')) as Record<string, unknown>
    expect(parsed.synthetic).toBe(true)
    expect(parsed.customField).toBe('abc')
  })

  test('throws on unsupported event type', () => {
    expect(() =>
      generateSyntheticEvent('stripe', 'unknown.event', 'whsec_123')
    ).toThrow(/Unsupported synthetic event/)
  })
})
