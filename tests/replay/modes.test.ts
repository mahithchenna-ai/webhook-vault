import { describe, expect, test } from 'vitest'
import {
  calculateBackoffMs,
  parseReplayMode,
  resolveOutOfOrderSequence,
  sleep,
} from '../../src/replay/modes.js'

describe('replay modes helpers', () => {
  test('calculates exponential backoff capped at 30 seconds', () => {
    expect(calculateBackoffMs(0, 1000)).toBe(1000)
    expect(calculateBackoffMs(1, 1000)).toBe(2000)
    expect(calculateBackoffMs(2, 1000)).toBe(4000)
    expect(calculateBackoffMs(3, 1000)).toBe(8000)
    expect(calculateBackoffMs(4, 1000)).toBe(16000)
    expect(calculateBackoffMs(5, 1000)).toBe(30000)
    expect(calculateBackoffMs(10, 1000)).toBe(30000)
  })

  test('supports custom backoff base and negative attempt clamp', () => {
    expect(calculateBackoffMs(-2, 250)).toBe(250)
    expect(calculateBackoffMs(2, 50)).toBe(200)
  })

  test('resolves explicit or reversed out-of-order sequences', () => {
    expect(resolveOutOfOrderSequence(['a', 'b', 'c'], ['c', 'a'])).toEqual(['c', 'a'])
    expect(resolveOutOfOrderSequence(['a', 'b', 'c'])).toEqual(['c', 'b', 'a'])
  })

  test('parses CLI mode flags and rejects unknown mode', () => {
    expect(parseReplayMode()).toEqual({ type: 'once' })
    expect(parseReplayMode('once')).toEqual({ type: 'once' })
    expect(parseReplayMode('duplicate')).toEqual({ type: 'duplicate' })
    expect(parseReplayMode('fail-then-succeed')).toEqual({ type: 'failThenSucceed' })
    expect(parseReplayMode('out-of-order', ['e2', 'e1'])).toEqual({
      type: 'outOfOrder',
      sequence: ['e2', 'e1'],
    })
    expect(() => parseReplayMode('invalid-mode')).toThrow(/Unknown replay mode/)
  })

  test('sleep resolves cleanly', async () => {
    await expect(sleep(0)).resolves.toBeUndefined()
    await expect(sleep(5)).resolves.toBeUndefined()
  })
})
