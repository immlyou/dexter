import { z } from 'zod'

// Models the web backend may run with server-held API keys. Free-form providers
// (OpenRouter, Ollama) are intentionally excluded.
export const ALLOWED_MODELS = {
  openai: ['gpt-5.2', 'gpt-4.1'],
  anthropic: ['claude-sonnet-5-5', 'claude-sonnet-4-5', 'claude-opus-4-6'],
  google: ['gemini-3-flash-preview', 'gemini-3-pro-preview'],
  xai: ['grok-4-0709', 'grok-4-1-fast-reasoning'],
  moonshot: ['kimi-k2-5']
} as const satisfies Record<string, readonly string[]>

export type AllowedProvider = keyof typeof ALLOWED_MODELS

export const PROVIDERS = Object.keys(ALLOWED_MODELS) as [AllowedProvider, ...AllowedProvider[]]
export const MODELS = Object.values(ALLOWED_MODELS).flat() as [string, ...string[]]

export const providerSchema = z.enum(PROVIDERS)
export const modelSchema = z.enum(MODELS)

export const MAX_ITERATIONS_LIMIT = 20
export const DEFAULT_MAX_ITERATIONS = 10
export const MAX_QUERY_LENGTH = 4000

export function isAllowedModel(provider: string, model: string): boolean {
  // Own-property check so keys like "constructor" never match
  if (!Object.hasOwn(ALLOWED_MODELS, provider)) return false
  return (ALLOWED_MODELS as Record<string, readonly string[]>)[provider]!.includes(model)
}

/**
 * Bound a stored/legacy maxIterations value to 1..MAX_ITERATIONS_LIMIT.
 */
export function clampMaxIterations(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_ITERATIONS
  return Math.min(MAX_ITERATIONS_LIMIT, Math.max(1, Math.floor(value)))
}
