import { describe, test, expect } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { validateSecret, loadAuthSecrets, MIN_SECRET_BYTES } from './secrets'

const strong = () => randomBytes(48).toString('base64')

describe('validateSecret', () => {
  test('rejects missing secret', () => {
    expect(() => validateSecret('JWT_SECRET', undefined)).toThrow(/not set/)
    expect(() => validateSecret('JWT_SECRET', '')).toThrow(/not set/)
  })

  test(`rejects secrets shorter than ${MIN_SECRET_BYTES} bytes`, () => {
    expect(() => validateSecret('JWT_SECRET', randomBytes(8).toString('hex'))).toThrow(/at least 32 bytes/)
  })

  test('rejects known example/default values even when long enough', () => {
    expect(() => validateSecret('JWT_SECRET', 'dev-secret-change-in-production')).toThrow()
    expect(() => validateSecret('JWT_SECRET', 'your-secret-key-change-this-in-production')).toThrow(/example/)
    expect(() => validateSecret('JWT_SECRET', 'my-long-jwt-value-please-change-in-production')).toThrow(/example/)
  })

  test('rejects low-variety values', () => {
    expect(() => validateSecret('JWT_SECRET', 'a'.repeat(64))).toThrow(/variety/)
  })

  test('accepts a random secret and does not echo values in errors', () => {
    const value = strong()
    expect(validateSecret('JWT_SECRET', value)).toBe(value)
    try {
      validateSecret('JWT_SECRET', 'short-value')
    } catch (e) {
      expect((e as Error).message).not.toContain('short-value')
    }
  })
})

describe('loadAuthSecrets', () => {
  test('requires both secrets', () => {
    expect(() => loadAuthSecrets({ JWT_SECRET: strong() })).toThrow(/JWT_REFRESH_SECRET/)
    expect(() => loadAuthSecrets({ JWT_REFRESH_SECRET: strong() })).toThrow(/JWT_SECRET/)
  })

  test('requires distinct access and refresh secrets', () => {
    const s = strong()
    expect(() => loadAuthSecrets({ JWT_SECRET: s, JWT_REFRESH_SECRET: s })).toThrow(/differ/)
  })

  test('returns validated secrets', () => {
    const a = strong()
    const r = strong()
    expect(loadAuthSecrets({ JWT_SECRET: a, JWT_REFRESH_SECRET: r })).toEqual({ accessSecret: a, refreshSecret: r })
  })
})
