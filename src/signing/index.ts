import * as stripe from './stripe.js'
import * as github from './github.js'
import * as razorpay from './razorpay.js'
import type { Provider, SignResult, VerifyResult } from '../core/events.js'

export { stripe, github, razorpay }
export { sign as signStripe, verify as verifyStripe } from './stripe.js'
export { sign as signGithub, verify as verifyGithub } from './github.js'
export { sign as signRazorpay, verify as verifyRazorpay } from './razorpay.js'

export function signWebhook(
  provider: Provider,
  payload: Buffer,
  secret: string,
  opts?: { timestamp?: number }
): SignResult {
  switch (provider) {
    case 'stripe':
      return stripe.sign(payload, secret, opts)
    case 'github':
      return github.sign(payload, secret, opts)
    case 'razorpay':
      return razorpay.sign(payload, secret, opts)
  }
}

export function verifyWebhook(
  provider: Provider,
  payload: Buffer,
  secret: string,
  header: string,
  opts?: { toleranceSecs?: number }
): VerifyResult {
  switch (provider) {
    case 'stripe':
      return stripe.verify(payload, secret, header, opts)
    case 'github':
      return github.verify(payload, secret, header, opts)
    case 'razorpay':
      return razorpay.verify(payload, secret, header, opts)
  }
}
