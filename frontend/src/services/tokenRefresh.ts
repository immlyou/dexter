export interface TokenStore {
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  setTokens(accessToken: string, refreshToken: string): void;
  clearTokens(): void;
}

export type RefreshRequest = (refreshToken: string, signal: AbortSignal) => Promise<{ token: string; refreshToken: string }>;
export type LockRunner = <T>(name: string, fn: () => Promise<T>) => Promise<T>;
export const REFRESH_TIMEOUT_MS = 10_000;

export class LockUnavailableError extends Error {
  constructor() {
    super('Secure refresh requires Web Locks; please sign in again');
    this.name = 'LockUnavailableError';
  }
}

/**
 * localStorage cannot provide an atomic cross-tab mutex. Fail closed without Web Locks
 * (e.g. plain-http, non-localhost origins are not secure contexts).
 */
export function defaultLockRunner(): LockRunner {
  return async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (!locks?.request) throw new LockUnavailableError();
    return locks.request(name, { mode: 'exclusive' }, fn);
  };
}

/** The lock covers reading, rotating and publishing tokens across all same-origin tabs. */
export function createTokenRefresher({
  store,
  request,
  lock = defaultLockRunner(),
  lockName = 'dexter-token-refresh',
  timeoutMs = REFRESH_TIMEOUT_MS,
}: {
  store: TokenStore;
  request: RefreshRequest;
  lock?: LockRunner;
  lockName?: string;
  timeoutMs?: number;
}) {
  let inFlight: Promise<string> | null = null;

  return function refresh(staleAccessToken: string | null): Promise<string> {
    if (inFlight) return inFlight;
    inFlight = lock(lockName, async () => {
      const current = store.getAccessToken();
      if (current && current !== staleAccessToken) return current;
      const refreshToken = store.getRefreshToken();
      if (!refreshToken) {
        // A stale access token alone would keep the app on its signed-in screen.
        store.clearTokens();
        throw new Error('No refresh token available');
      }

      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Refresh request timed out; please sign in again'));
          }, timeoutMs);
        });
        const result = await Promise.race([request(refreshToken, controller.signal), timeout]);
        // A login/logout may have changed the session while the request was pending.
        if (store.getRefreshToken() !== refreshToken) throw new Error('Session changed during refresh');
        store.setTokens(result.token, result.refreshToken);
        return result.token;
      } catch (error) {
        // Clear an uncertain/invalid credential while still holding the lock so a waiting
        // tab cannot replay it. A late response is never allowed to publish credentials.
        if (store.getRefreshToken() === refreshToken) store.clearTokens();
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }).catch((error: unknown) => {
      // No tab of this origin can ever refresh safely, so end the session (otherwise the
      // retained tokens keep the signed-in screen up and every 401 loops via /login).
      if (error instanceof LockUnavailableError) store.clearTokens();
      throw error;
    }).finally(() => { inFlight = null; });
    return inFlight;
  };
}
