import axios from 'axios';

export interface TokenStore {
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  setTokens(accessToken: string, refreshToken: string): void;
}

export type RefreshRequest = (refreshToken: string) => Promise<{ token: string; refreshToken: string }>;

export type LockRunner = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Best-effort cross-tab mutex on localStorage for browsers without the Web Locks API.
 * localStorage has no compare-and-set, so a claim is written, then re-read after a
 * short settle delay; the server's refresh grace window covers the rare collision.
 */
export function createStorageLock(
  storage: Storage = localStorage,
  { ttlMs = 10_000, pollMs = 50, settleMs = 30, timeoutMs = 15_000 } = {}
): LockRunner {
  return async (name, fn) => {
    const key = `lock:${name}`;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const deadline = Date.now() + timeoutMs;
    let acquired = false;

    while (!acquired && Date.now() < deadline) {
      const raw = storage.getItem(key);
      const current = raw ? (JSON.parse(raw) as { id: string; exp: number }) : null;
      if (!current || current.exp < Date.now()) {
        storage.setItem(key, JSON.stringify({ id, exp: Date.now() + ttlMs }));
        await sleep(settleMs);
        const after = storage.getItem(key);
        acquired = after !== null && (JSON.parse(after) as { id: string }).id === id;
      }
      if (!acquired) await sleep(pollMs);
    }

    try {
      // On timeout (holder crashed without expiring yet) proceed unlocked rather than hang
      return await fn();
    } finally {
      const raw = acquired ? storage.getItem(key) : null;
      if (raw && (JSON.parse(raw) as { id: string }).id === id) storage.removeItem(key);
    }
  };
}

/** Web Locks API when available (shared by all same-origin tabs), else the storage lock. */
export function defaultLockRunner(): LockRunner {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks?.request) {
    // request() resolves with the callback's result, i.e. the awaited value of fn()
    return <T>(name: string, fn: () => Promise<T>) =>
      locks.request(name, { mode: 'exclusive' }, () => fn()) as unknown as Promise<T>;
  }
  return createStorageLock();
}

function isRefreshRetry(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 409 &&
    (error.response.data as { error?: { code?: string } } | undefined)?.error?.code === 'REFRESH_RETRY';
}

/**
 * Refresh coordinator shared by every tab: at most one refresh runs at a time per
 * origin, and whoever gets the lock first rereads stored tokens so a refresh another
 * tab already completed is reused instead of replaying the rotated refresh token
 * (which the server would treat as theft).
 */
export function createTokenRefresher({
  store,
  request,
  lock = defaultLockRunner(),
  lockName = 'dexter-token-refresh',
  retryDelayMs = 250,
}: {
  store: TokenStore;
  request: RefreshRequest;
  lock?: LockRunner;
  lockName?: string;
  retryDelayMs?: number;
}) {
  let inFlight: Promise<string> | null = null;

  /**
   * @param staleAccessToken access token the failed request was sent with; if storage
   *   already holds a different one, another tab refreshed and it is returned as-is.
   */
  return function refresh(staleAccessToken: string | null): Promise<string> {
    if (inFlight) return inFlight;

    inFlight = lock(lockName, async () => {
      const current = store.getAccessToken();
      if (current && current !== staleAccessToken) return current;

      const refreshToken = store.getRefreshToken();
      if (!refreshToken) throw new Error('No refresh token available');

      try {
        const result = await request(refreshToken);
        store.setTokens(result.token, result.refreshToken);
        return result.token;
      } catch (error) {
        if (!isRefreshRetry(error)) throw error;
        // Another client rotated this token moments ago; its result should land in storage
        await sleep(retryDelayMs);
        const latest = store.getAccessToken();
        if (store.getRefreshToken() !== refreshToken && latest) return latest;
        throw error;
      }
    }).finally(() => {
      inFlight = null;
    });

    return inFlight;
  };
}
