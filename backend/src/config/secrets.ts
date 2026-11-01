// Minimum secret length in bytes (HS256 key should be at least 256 bits)
export const MIN_SECRET_BYTES = 32

// Placeholder values that have appeared in this repo's examples/defaults; never accept them
const KNOWN_WEAK_SECRETS = new Set([
  'dev-secret-change-in-production',
  'your-secret-key-change-this-in-production',
  'your-refresh-secret-change-this-in-production',
  'change-me',
  'changeme',
  'secret',
  'jwt-secret',
  'replace-with-output-of-openssl-rand-base64-48',
])

export interface AuthSecrets {
  accessSecret: string
  refreshSecret: string
}

/**
 * Validate a single signing secret. Throws a descriptive error (without echoing the value).
 */
export function validateSecret(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. Generate one with: openssl rand -base64 48`)
  }
  if (Buffer.byteLength(value, 'utf8') < MIN_SECRET_BYTES) {
    throw new Error(`${name} must be at least ${MIN_SECRET_BYTES} bytes`)
  }
  const normalized = value.trim().toLowerCase()
  if (KNOWN_WEAK_SECRETS.has(normalized) || normalized.includes('change-in-production') || normalized.includes('change-this')) {
    throw new Error(`${name} is a known example/default value; generate a random secret`)
  }
  // Reject trivially low-entropy values such as "aaaa…" or "abababab…"
  if (new Set(value).size < 8) {
    throw new Error(`${name} has too little variety to be a random secret`)
  }
  return value
}

/**
 * Read and validate the access/refresh signing secrets from the environment.
 */
export function loadAuthSecrets(env: Record<string, string | undefined> = process.env): AuthSecrets {
  const accessSecret = validateSecret('JWT_SECRET', env.JWT_SECRET)
  const refreshSecret = validateSecret('JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET)
  if (accessSecret === refreshSecret) {
    throw new Error('JWT_REFRESH_SECRET must differ from JWT_SECRET')
  }
  return { accessSecret, refreshSecret }
}

let cached: AuthSecrets | null = null

/**
 * Validated secrets, loaded once. Call at startup to fail fast on bad configuration.
 */
export function getAuthSecrets(): AuthSecrets {
  if (!cached) cached = loadAuthSecrets()
  return cached
}
