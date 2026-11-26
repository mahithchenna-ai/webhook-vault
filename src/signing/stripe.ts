import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SignResult, VerifyResult } from '../core/events.js'

const DEFAULT_TOLERANCE_SECS = 300

export function sign(
  payload: Buffer,
  secret: string,
  opts: { timestamp?: number } = {}
): SignResult {
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000)
  const v1 = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(payload)
    .digest('hex')
  return {
    header: `t=${timestamp},v1=${v1}`,
    timestamp,
  }
}

export function verify(
  payload: Buffer,
  secret: string,
  header: string,
  opts: { toleranceSecs?: number } = {}
): VerifyResult {
  if (!header || typeof header !== 'string') {
    return { valid: false, reason: 'malformed_header' }
  }

  let timestampStr: string | undefined
  const signatures: string[] = []

  for (const rawPart of header.split(',')) {
    const part = rawPart.trim()
    const eqIndex = part.indexOf('=')
    if (eqIndex <= 0) continue
    const key = part.slice(0, eqIndex).trim()
    const value = part.slice(eqIndex + 1).trim()
    if (key === 't') {
      timestampStr = value
    } else if (key === 'v1') {
      signatures.push(value)
    }
  }

  if (!timestampStr || !/^\d+$/.test(timestampStr) || signatures.length === 0) {
    return { valid: false, reason: 'malformed_header' }
  }

  const timestamp = Number(timestampStr)
  const toleranceSecs = opts.toleranceSecs ?? DEFAULT_TOLERANCE_SECS
  const now = Math.floor(Date.now() / 1000)

  if (Math.abs(now - timestamp) > toleranceSecs) {
    return { valid: false, reason: 'timestamp_too_old' }
  }

  const expectedHex = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(payload)
    .digest('hex')
  const expectedBuf = Buffer.from(expectedHex, 'hex')

  let sawSameLengthMismatch = false
  let sawDifferentLength = false
  let sawValidHex = false

  for (const sig of signatures) {
    if (!sig || !/^[0-9a-fA-F]+$/.test(sig) || sig.length % 2 !== 0) {
      continue
    }
    sawValidHex = true
    const providedBuf = Buffer.from(sig, 'hex')
    if (providedBuf.length !== expectedBuf.length) {
      sawDifferentLength = true
      continue
    }
    if (timingSafeEqual(providedBuf, expectedBuf)) {
      return { valid: true }
    }
    sawSameLengthMismatch = true
  }

  if (!sawValidHex) {
    return { valid: false, reason: 'malformed_header' }
  }
  if (sawDifferentLength && !sawSameLengthMismatch) {
    return { valid: false, reason: 'body_modified' }
  }
  return { valid: false, reason: 'wrong_secret' }
}
