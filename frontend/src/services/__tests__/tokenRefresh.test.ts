import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { createStorageLock, createTokenRefresher, defaultLockRunner, type LockRunner, type TokenStore } from '../tokenRefresh';

/** Shared localStorage-backed store, like two tabs of the same origin. */
function storageStore(): TokenStore {
  return {
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

function refreshRetryError(): AxiosError {
  const headers = new AxiosHeaders();
  return new AxiosError('conflict', '409', { headers }, null, {
    status: 409,
    statusText: 'Conflict',
    headers: {},
    config: { headers },
    data: { error: { code: 'REFRESH_RETRY' } },
  });
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
    expect(request).toHaveBeenCalledWith('refresh-0');
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

  it('on REFRESH_RETRY uses tokens another client stored meanwhile', async () => {
    const request = vi.fn(async () => {
      // A tab without the lock (e.g. older build) finished rotating first
      localStorage.setItem('access_token', 'access-other');
      localStorage.setItem('refresh_token', 'refresh-other');
      throw refreshRetryError();
    });
    const refresh = createTokenRefresher({ store: storageStore(), request, lock: memoryLock(), retryDelayMs: 1 });
    await expect(refresh('access-0')).resolves.toBe('access-other');
  });

  it('on REFRESH_RETRY with nothing new stored, fails instead of looping', async () => {
    const request = vi.fn(async () => {
      throw refreshRetryError();
    });
    const refresh = createTokenRefresher({ store: storageStore(), request, lock: memoryLock(), retryDelayMs: 1 });
    await expect(refresh('access-0')).rejects.toBeInstanceOf(AxiosError);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('fails without a refresh token', async () => {
    localStorage.removeItem('refresh_token');
    const refresh = createTokenRefresher({ store: storageStore(), request: vi.fn(), lock: memoryLock() });
    await expect(refresh('access-0')).rejects.toThrow('No refresh token available');
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

  it('storage lock gives mutual exclusion and releases on error', async () => {
    const lock = createStorageLock(localStorage, { pollMs: 5, settleMs: 5 });
    let inside = 0;
    let maxInside = 0;
    const work = async () => {
      inside++;
      maxInside = Math.max(maxInside, inside);
      await new Promise((r) => setTimeout(r, 15));
      inside--;
    };
    await Promise.all([lock('n', work), lock('n', work), lock('n', work)]);
    expect(maxInside).toBe(1);

    await expect(lock('n', async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(localStorage.getItem('lock:n')).toBeNull();
  });

  it('storage lock takes over an expired claim', async () => {
    localStorage.setItem('lock:n', JSON.stringify({ id: 'dead-tab', exp: Date.now() - 1 }));
    const lock = createStorageLock(localStorage, { pollMs: 5, settleMs: 5 });
    await expect(lock('n', async () => 'ok')).resolves.toBe('ok');
  });
});
