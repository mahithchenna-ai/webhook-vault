import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Provider } from '../core/events.js'

export interface RequestWithRawBody extends IncomingMessage {
  __rawBody?: Buffer
  _body?: boolean
  body?: unknown
}

export function captureRawBody(
  req: IncomingMessage,
  _res: ServerResponse,
  buf: Buffer
): void {
  ;(req as RequestWithRawBody).__rawBody = buf
}

export function detectProvider(headers: Record<string, string>): Provider | null {
  if ('stripe-signature' in headers) return 'stripe'
  if ('x-hub-signature-256' in headers || 'x-github-event' in headers) return 'github'
  if ('x-razorpay-signature' in headers) return 'razorpay'
  return null
}

export function getSignatureHeader(
  provider: Provider | null,
  headers: Record<string, string>
): string | undefined {
  switch (provider) {
    case 'stripe':
      return headers['stripe-signature']
    case 'github':
      return headers['x-hub-signature-256']
    case 'razorpay':
      return headers['x-razorpay-signature']
    default:
      return undefined
  }
}

export function extractEventType(
  provider: Provider | null,
  headers: Record<string, string>,
  rawBody: string | null
): string | null {
  if (provider === 'github' && headers['x-github-event']) {
    return headers['x-github-event']
  }
  if (!rawBody) return null

  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>
    if (provider === 'stripe' && typeof parsed.type === 'string') {
      return parsed.type
    }
    if (provider === 'razorpay' && typeof parsed.event === 'string') {
      return parsed.event
    }
    if (typeof parsed.type === 'string') return parsed.type
    if (typeof parsed.event === 'string') return parsed.event
  } catch {
    return null
  }
  return null
}
