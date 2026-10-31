import { describe, expect, test } from 'bun:test';
import type { APIResponse, Route } from 'playwright';
import { fetchGuarded, MAX_REDIRECTS } from './guarded-fetch.js';

type FetchOptions = NonNullable<Parameters<Route['fetch']>[0]>;

const publicLookup = async (host: string) => (host.endsWith('internal.example') ? ['10.0.0.5'] : ['93.184.216.34']);

function response(status: number, location?: string): APIResponse {
  return {
    status: () => status,
    headers: () => (location ? { location } : {}),
    dispose: async () => {},
  } as unknown as APIResponse;
}

/** Fake route whose server answers each URL from `replies` (default 200). */
function fakeRoute(replies: Record<string, [number, string?]>, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  const calls: FetchOptions[] = [];
  const route = {
    request: () => ({
      url: () => 'https://start.example/a',
      method: () => init.method ?? 'GET',
      headers: () => init.headers ?? {},
      postDataBuffer: () => (init.body ? Buffer.from(init.body) : null),
    }),
    fetch: async (options: FetchOptions = {}) => {
      calls.push(options);
      const [status, location] = replies[options.url!] ?? [200];
      return response(status, location);
    },
  } as unknown as Pick<Route, 'request' | 'fetch'>;
  return { route, calls };
}

describe('fetchGuarded', () => {
  test('never lets the browser follow a redirect to an internal address', async () => {
    const { route, calls } = fakeRoute({ 'https://start.example/a': [302, 'http://169.254.169.254/latest/meta-data'] });
    await expect(fetchGuarded(route, publicLookup)).rejects.toThrow('not allowed');
    expect(calls.map((c) => c.url)).toEqual(['https://start.example/a']);
    expect(calls[0]!.maxRedirects).toBe(0);
  });

  test('checks every hop, including names that resolve internally', async () => {
    const { route, calls } = fakeRoute({
      'https://start.example/a': [301, '/b'],
      'https://start.example/b': [302, 'https://svc.internal.example/'],
    });
    await expect(fetchGuarded(route, publicLookup)).rejects.toThrow('not allowed');
    expect(calls.map((c) => c.url)).toEqual(['https://start.example/a', 'https://start.example/b']);
  });

  test('returns the final response of an allowed chain', async () => {
    const { route } = fakeRoute({ 'https://start.example/a': [302, 'https://other.example/final'] });
    const final = await fetchGuarded(route, publicLookup);
    expect(final.status()).toBe(200);
  });

  test('drops credentials across origins and converts POST to GET on 303', async () => {
    const { route, calls } = fakeRoute(
      { 'https://start.example/a': [303, 'https://other.example/done'] },
      { method: 'POST', body: 'x=1', headers: { cookie: 'sid=1', authorization: 'Bearer t', 'content-type': 'text/plain', accept: '*/*' } },
    );
    await fetchGuarded(route, publicLookup);
    expect(calls[1]).toMatchObject({ url: 'https://other.example/done', method: 'GET', postData: undefined });
    expect(calls[1]!.headers).toEqual({ accept: '*/*' });
  });

  test('stops redirect loops', async () => {
    const { route, calls } = fakeRoute({ 'https://start.example/a': [302, '/a'] });
    await expect(fetchGuarded(route, publicLookup)).rejects.toThrow('Too many redirects');
    expect(calls).toHaveLength(MAX_REDIRECTS + 1);
  });
});
