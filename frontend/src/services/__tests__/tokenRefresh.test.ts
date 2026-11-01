import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTokenRefresher, defaultLockRunner, type LockRunner, type TokenStore } from '../tokenRefresh';

/** Shared localStorage-backed store, like two tabs of the same origin. */
function storageStore(): TokenStore {
  return {
    clearTokens: () => { localStorage.removeItem('access_token'); localStorage.removeItem('refresh_token'); },
    getAccessToken: () => localStorage.getItem('access_token'),
    getRefreshToken: () => localStorage.getItem('refresh_token'),
    setTokens: (a, r) => {
      localStorage.setItem('access_token', a);
      localStorage.setItem('refresh_token', r);
    },
  };
}

/** In-process exclusive lock standing in for navigator.locks across "tabs". */
function memoryLock(): LockRunner {
  let tail: Promise<unknown> = Promise.resolve();
  return (_name, fn) => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}

describe('cross-tab token refresh', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('access_token', 'access-0');
    localStorage.setItem('refresh_token', 'refresh-0');
  });

  it('two tabs refreshing at once rotate the refresh token exactly once', async () => {
    const lock = memoryLock();
    const request = vi.fn(async (rt: string) => {
      await new Promise((r) => setTimeout(r, 10));
      return { token: `access-after-${rt}`, refreshToken: `${rt}-next` };
    });
    const tabA = createTokenRefresher({ store: storageStore(), request, lock });
    const tabB = createTokenRefresher({ store: storageStore(), request, lock });

    const [a, b] = await Promise.all([tabA('access-0'), tabB('access-0')]);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('refresh-0', expect.any(AbortSignal));
    expect(a).toBe('access-after-refresh-0');
    expect(b).toBe('access-after-refresh-0');
    expect(localStorage.getItem('refresh_token')).toBe('refresh-0-next');
  });

  it('dedupes concurrent refreshes within one tab', async () => {
    const request = vi.fn(async () => ({ token: 'a1', refreshToken: 'r1' }));
    const refresh = createTokenRefresher({ store: storageStore(), request, lock: memoryLock() });
    await Promise.all([refresh('access-0'), refresh('access-0'), refresh('access-0')]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rereads tokens after acquiring the lock and skips refresh if another tab already did it', async () => {
    const request = vi.fn(async () => ({ token: 'never', refreshToken: 'never' }));
    const refresh = createTokenRefresher({ store: storageStore(), request, lock: memoryLock() });
    localStorage.setItem('access_token', 'access-from-other-tab');
    localStorage.setItem('refresh_token', 'refresh-from-other-tab');

    await expect(refresh('access-0')).resolves.toBe('access-from-other-tab');
    expect(request).not.toHaveBeenCalled();
  });

  it('a timed-out request clears the uncertain token under the lock and ignores late results', async () => {
    const lock = memoryLock();
    let finish!: (value: { token: string; refreshToken: string }) => void;
    let signal: AbortSignal | undefined;
    const request = vi.fn((_token: string, abort: AbortSignal) => {
      signal = abort;
      return new Promise<{ token: string; refreshToken: string }>(resolve => { finish = resolve; });
    });
    const first = createTokenRefresher({ store: storageStore(), request, lock, timeoutMs: 15 });
    const second = createTokenRefresher({ store: storageStore(), request, lock, timeoutMs: 15 });
    const results = await Promise.allSettled([first('access-0'), second('access-0')]);
    expect(results.map(r => r.status)).toEqual(['rejected', 'rejected']);
    expect(request).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(true);
    expect(localStorage.getItem('refresh_token')).toBeNull();
    finish({ token: 'late', refreshToken: 'late' });
    await Promise.resolve();
    expect(localStorage.getItem('refresh_token')).toBeNull();
  });

  it('a failed refresh cannot erase a new login', async () => {
    const request = vi.fn(async () => {
      storageStore().setTokens('new-login', 'new-session');
      throw new Error('old session failed');
    });
    const refresh = createTokenRefresher({ store: storageStore(), request, lock: memoryLock() });
    await expect(refresh('access-0')).rejects.toThrow('old session failed');
    expect(localStorage.getItem('refresh_token')).toBe('new-session');
  });

  it('fails without a refresh token', async () => {
    localStorage.removeItem('refresh_token');
    const refresh = createTokenRefresher({ store: storageStore(), request: vi.fn(), lock: memoryLock() });
    await expect(refresh('access-0')).rejects.toThrow('No refresh token available');
    expect(localStorage.getItem('access_token')).toBeNull();
  });

  it('without Web Locks clears the session instead of leaving a stale signed-in state', async () => {
    vi.stubGlobal('navigator', {});
    const request = vi.fn();
    const refresh = createTokenRefresher({ store: storageStore(), request });
    await expect(refresh('access-0')).rejects.toThrow('Web Locks');
    expect(request).not.toHaveBeenCalled();
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('lock runners', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('uses navigator.locks when available', async () => {
    const request = vi.fn((_name: string, _opts: unknown, cb: () => Promise<unknown>) => cb());
    vi.stubGlobal('navigator', { locks: { request } });
    const run = defaultLockRunner();
    await expect(run('x', async () => 42)).resolves.toBe(42);
    expect(request).toHaveBeenCalledWith('x', { mode: 'exclusive' }, expect.any(Function));
  });

  it('without Web Locks never calls the refresh operation, even with an expired storage claim', async () => {
    vi.stubGlobal('navigator', {});
    localStorage.setItem('lock:n', JSON.stringify({ id: 'dead', exp: 0 }));
    const operation = vi.fn(async () => 'unsafe');
    await expect(defaultLockRunner()('n', operation)).rejects.toThrow('Web Locks');
    expect(operation).not.toHaveBeenCalled();
  });
});
