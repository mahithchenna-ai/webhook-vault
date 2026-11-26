import { nanoid } from 'nanoid'
import type { Provider } from '../core/events.js'
import { signWebhook } from '../signing/index.js'

export interface GeneratedWebhook {
  headers: Record<string, string>
  body: Buffer
  provider: Provider
  eventType: string
}

export interface GenerateOptions {
  timestamp?: number
  overrides?: Record<string, unknown>
}

export interface EventGenerator {
  provider: Provider
  eventType: string
  generate: (secret: string, opts?: GenerateOptions) => GeneratedWebhook
}

export const SUPPORTED_EVENTS: Record<Provider, readonly string[]> = {
  stripe: [
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'invoice.payment_failed',
  ],
  github: ['push', 'pull_request'],
  razorpay: [
    'payment.authorized',
    'payment.captured',
    'payment.failed',
    'order.paid',
  ],
}

function buildSyntheticPayload(
  provider: Provider,
  eventType: string,
  timestamp: number,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const suffix = nanoid(10)

  if (provider === 'stripe') {
    switch (eventType) {
      case 'payment_intent.succeeded':
        return {
          synthetic: true,
          id: `evt_test_${suffix}`,
          object: 'event',
          api_version: '2024-06-20',
          created: timestamp,
          type: 'payment_intent.succeeded',
          data: {
            object: {
              id: `pi_test_${suffix}`,
              object: 'payment_intent',
              amount: 2000,
              currency: 'usd',
              status: 'succeeded',
            },
          },
          ...overrides,
        }
      case 'payment_intent.payment_failed':
        return {
          synthetic: true,
          id: `evt_test_${suffix}`,
          object: 'event',
          api_version: '2024-06-20',
          created: timestamp,
          type: 'payment_intent.payment_failed',
          data: {
            object: {
              id: `pi_test_${suffix}`,
              object: 'payment_intent',
              amount: 4500,
              currency: 'usd',
              status: 'requires_payment_method',
              last_payment_error: { code: 'card_declined', message: 'Your card was declined.' },
            },
          },
          ...overrides,
        }
      case 'invoice.payment_failed':
        return {
          synthetic: true,
          id: `evt_test_${suffix}`,
          object: 'event',
          api_version: '2024-06-20',
          created: timestamp,
          type: 'invoice.payment_failed',
          data: {
            object: {
              id: `in_test_${suffix}`,
              object: 'invoice',
              amount_due: 9900,
              currency: 'usd',
              status: 'open',
              attempted: true,
            },
          },
          ...overrides,
        }
    }
  }

  if (provider === 'github') {
    switch (eventType) {
      case 'push':
        return {
          synthetic: true,
          ref: 'refs/heads/main',
          before: '0000000000000000000000000000000000000000',
          after: `abc1234567890${suffix}`,
          repository: { id: 123456, full_name: 'webhook-vault/demo' },
          pusher: { name: 'dev', email: 'dev@example.com' },
          commits: [{ id: `commit_${suffix}`, message: 'feat: test webhook' }],
          ...overrides,
        }
      case 'pull_request':
        return {
          synthetic: true,
          action: 'opened',
          number: 42,
          pull_request: {
            id: 987654,
            number: 42,
            state: 'open',
            title: 'Test synthetic pull request',
          },
          repository: { id: 123456, full_name: 'webhook-vault/demo' },
          ...overrides,
        }
    }
  }

  if (provider === 'razorpay') {
    switch (eventType) {
      case 'payment.authorized':
      case 'payment.captured':
      case 'payment.failed':
        return {
          synthetic: true,
          entity: 'event',
          account_id: 'acc_test_001',
          event: eventType,
          created_at: timestamp,
          payload: {
            payment: {
              entity: {
                id: `pay_test_${suffix}`,
                amount: 50000,
                currency: 'INR',
                status: eventType.split('.')[1],
              },
            },
          },
          ...overrides,
        }
      case 'order.paid':
        return {
          synthetic: true,
          entity: 'event',
          account_id: 'acc_test_001',
          event: 'order.paid',
          created_at: timestamp,
          payload: {
            order: {
              entity: {
                id: `order_test_${suffix}`,
                amount: 50000,
                amount_paid: 50000,
                currency: 'INR',
                status: 'paid',
              },
            },
          },
          ...overrides,
        }
    }
  }

  throw new Error(`Unsupported synthetic event "${eventType}" for provider "${provider}"`)
}

export function generateSyntheticEvent(
  provider: Provider,
  eventType: string,
  secret: string,
  opts: GenerateOptions = {}
): GeneratedWebhook {
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000)
  const payload = buildSyntheticPayload(provider, eventType, timestamp, opts.overrides)
  payload.synthetic = true
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  const signed = signWebhook(provider, body, secret, { timestamp })

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }

  if (provider === 'stripe') {
    headers['stripe-signature'] = signed.header
  } else if (provider === 'github') {
    headers['x-hub-signature-256'] = signed.header
    headers['x-github-event'] = eventType
    headers['x-github-delivery'] = nanoid()
  } else if (provider === 'razorpay') {
    headers['x-razorpay-signature'] = signed.header
  }

  return { headers, body, provider, eventType }
}

function makeGenerator(provider: Provider, eventType: string): EventGenerator {
  return {
    provider,
    eventType,
    generate: (secret: string, opts?: GenerateOptions) =>
      generateSyntheticEvent(provider, eventType, secret, opts),
  }
}

export const simulators = {
  stripe: {
    'payment_intent.succeeded': makeGenerator('stripe', 'payment_intent.succeeded'),
    'payment_intent.payment_failed': makeGenerator('stripe', 'payment_intent.payment_failed'),
    'invoice.payment_failed': makeGenerator('stripe', 'invoice.payment_failed'),
  },
  github: {
    push: makeGenerator('github', 'push'),
    pull_request: makeGenerator('github', 'pull_request'),
  },
  razorpay: {
    'payment.authorized': makeGenerator('razorpay', 'payment.authorized'),
    'payment.captured': makeGenerator('razorpay', 'payment.captured'),
    'payment.failed': makeGenerator('razorpay', 'payment.failed'),
    'order.paid': makeGenerator('razorpay', 'order.paid'),
  },
} as const

export const ALL_SYNTHETIC_EVENTS: Array<{ provider: Provider; eventType: string }> = [
  ...SUPPORTED_EVENTS.stripe.map((eventType) => ({ provider: 'stripe' as const, eventType })),
  ...SUPPORTED_EVENTS.github.map((eventType) => ({ provider: 'github' as const, eventType })),
  ...SUPPORTED_EVENTS.razorpay.map((eventType) => ({ provider: 'razorpay' as const, eventType })),
]
