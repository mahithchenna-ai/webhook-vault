import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SignResult, VerifyResult } from '../core/events.js'

export function sign(
  payload: Buffer,
  secret: string,
  _opts: { timestamp?: number } = {}
): SignResult {
  const sig = createHmac('sha256', secret).update(payload).digest('hex')
  return { header: sig }
}

export function verify(
  payload: Buffer,
  secret: string,
  header: string,
  _opts: { toleranceSecs?: number } = {}
): VerifyResult {
  if (!header || typeof header !== 'string') {
    return { valid: false, reason: 'malformed_header' }
  }

  const providedHex = header.trim()
  if (!providedHex || !/^[0-9a-fA-F]+$/.test(providedHex) || providedHex.length % 2 !== 0) {
    return { valid: false, reason: 'malformed_header' }
  }

  const expectedHex = createHmac('sha256', secret).update(payload).digest('hex')
  const expectedBuf = Buffer.from(expectedHex, 'hex')
  const providedBuf = Buffer.from(providedHex, 'hex')

  if (providedBuf.length !== expectedBuf.length) {
    return { valid: false, reason: 'body_modified' }
  }

  if (!timingSafeEqual(providedBuf, expectedBuf)) {
    return { valid: false, reason: 'wrong_secret' }
  }

  return { valid: true }
}
