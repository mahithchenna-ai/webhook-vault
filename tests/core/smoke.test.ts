import { describe, expect, test } from 'vitest'
import { VERSION } from '../../src/core/index.js'

describe('core smoke test', () => {
  test('VERSION is a string', () => {
    expect(typeof VERSION).toBe('string')
  })
})
