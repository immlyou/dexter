import { describe, test, expect } from 'bun:test'
import { createQuerySchema } from './query'
import { createSessionSchema, updateSessionSchema } from './session'
import { clampMaxIterations, isAllowedModel, MAX_QUERY_LENGTH } from '../config/models'

const sessionId = crypto.randomUUID()

describe('query input caps', () => {
  test(`accepts queries up to ${MAX_QUERY_LENGTH} characters`, () => {
    expect(createQuerySchema.safeParse({ sessionId, query: 'x'.repeat(MAX_QUERY_LENGTH) }).success).toBe(true)
  })

  test('rejects over-long, empty and whitespace-only queries', () => {
    expect(createQuerySchema.safeParse({ sessionId, query: 'x'.repeat(MAX_QUERY_LENGTH + 1) }).success).toBe(false)
    expect(createQuerySchema.safeParse({ sessionId, query: '' }).success).toBe(false)
    expect(createQuerySchema.safeParse({ sessionId, query: '   ' }).success).toBe(false)
  })
})

describe('session model allow-list and config', () => {
  const base = { model: 'claude-sonnet-4-5', provider: 'anthropic' }

  test('accepts allow-listed model/provider pairs', () => {
    expect(createSessionSchema.safeParse(base).success).toBe(true)
    expect(createSessionSchema.safeParse({ model: 'gpt-5.2', provider: 'openai', config: { maxIterations: 20 } }).success).toBe(true)
  })

  test('rejects unknown models, providers and mismatched pairs', () => {
    expect(createSessionSchema.safeParse({ ...base, model: 'claude-opus-9000' }).success).toBe(false)
    expect(createSessionSchema.safeParse({ model: 'llama3', provider: 'ollama' }).success).toBe(false)
    expect(createSessionSchema.safeParse({ model: 'openrouter:anything', provider: 'openrouter' }).success).toBe(false)
    expect(createSessionSchema.safeParse({ model: 'gpt-5.2', provider: 'anthropic' }).success).toBe(false)
  })

  test('maxIterations must be an integer in 1..20 and unknown config keys are rejected', () => {
    for (const maxIterations of [0, 21, 1000, 2.5, -1]) {
      expect(createSessionSchema.safeParse({ ...base, config: { maxIterations } }).success).toBe(false)
    }
    expect(createSessionSchema.safeParse({ ...base, config: { maxIterations: 1 } }).success).toBe(true)
    expect(createSessionSchema.safeParse({ ...base, config: { anything: 'x' } }).success).toBe(false)
  })

  test('update must change model and provider together, to an allowed pair', () => {
    expect(updateSessionSchema.safeParse({ name: 'renamed' }).success).toBe(true)
    expect(updateSessionSchema.safeParse({ model: 'gpt-4.1' }).success).toBe(false)
    expect(updateSessionSchema.safeParse({ model: 'gpt-4.1', provider: 'openai' }).success).toBe(true)
    expect(updateSessionSchema.safeParse({ model: 'gpt-4.1', provider: 'google' }).success).toBe(false)
  })

  test('isAllowedModel guards legacy session rows', () => {
    expect(isAllowedModel('anthropic', 'claude-opus-4-6')).toBe(true)
    expect(isAllowedModel('anthropic', 'gpt-5.2')).toBe(false)
    expect(isAllowedModel('constructor', 'x')).toBe(false)
  })

  test('clampMaxIterations bounds stored values', () => {
    expect(clampMaxIterations(undefined)).toBe(10)
    expect(clampMaxIterations('50')).toBe(10)
    expect(clampMaxIterations(1e9)).toBe(20)
    expect(clampMaxIterations(0)).toBe(1)
    expect(clampMaxIterations(Number.NaN)).toBe(10)
    expect(clampMaxIterations(7.9)).toBe(7)
  })
})
