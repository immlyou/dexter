import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import axios, { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import type { LookupFn } from '../browser/url-guard.js';
import { clearWebFetchCache, getURLMarkdownContent } from './utils.js';

// Fake resolver so tests never hit the network
const resolver =
  (table: Record<string, string[]>): LookupFn =>
  async (host) => {
    const hit = table[host];
    if (!hit) throw new Error('ENOTFOUND');
    return hit;
  };

const dns = resolver({
  'example.com': ['93.184.215.14'],
  'www.example.com': ['10.0.0.7'],
  'other.example.org': ['93.184.215.20'],
  'metadata.attacker.test': ['169.254.169.254'],
});

function okResponse(body: string): AxiosResponse<ArrayBuffer> {
  const data = new TextEncoder().encode(body).buffer as ArrayBuffer;
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'text/plain' },
    config: { headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
  };
}

function redirectError(location: string): AxiosError {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  return new AxiosError('redirect', 'ERR_BAD_RESPONSE', config, undefined, {
    data: new ArrayBuffer(0),
    status: 302,
    statusText: 'Found',
    headers: { location },
    config,
  });
}

let getSpy: ReturnType<typeof spyOn<typeof axios, 'get'>>;

beforeEach(() => {
  clearWebFetchCache();
  getSpy = spyOn(axios, 'get');
});

afterEach(() => {
  getSpy.mockRestore();
});

async function fetchError(url: string): Promise<string> {
  try {
    await getURLMarkdownContent(url, new AbortController(), dns);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`expected ${url} to be rejected`);
}

describe('web_fetch SSRF guard', () => {
  test.each([
    'http://127.0.0.1/admin',
    'https://10.1.2.3/',
    'http://169.254.169.254/latest/meta-data/',
    'https://metadata.attacker.test/',
    'https://0x7f.0.0.1:8080/',
  ])('blocks private destination %s before any request', async (url) => {
    expect(await fetchError(url)).toMatch(/not allowed/);
    expect(getSpy).not.toHaveBeenCalled();
  });

  test('fetches a public URL with proxy bypassed and a pinned DNS lookup', async () => {
    getSpy.mockResolvedValueOnce(okResponse('hello'));
    const result = await getURLMarkdownContent('https://example.com/ir', new AbortController(), dns);

    expect('content' in result && result.content).toBe('hello');
    const config = getSpy.mock.calls[0]![1]!;
    expect(config.proxy).toBe(false);
    expect(config.maxRedirects).toBe(0);
    expect(typeof config.lookup).toBe('function');
  });

  test('pinned lookup rejects a rebinding answer at connect time', async () => {
    getSpy.mockResolvedValueOnce(okResponse('hello'));
    await getURLMarkdownContent('https://example.com/', new AbortController(), dns);
    const lookup = getSpy.mock.calls[0]![1]!.lookup as (
      host: string,
      opts: object,
      cb: (err: Error | null, addrs: Array<{ address: string }>) => void,
    ) => void;

    const connectTo = (host: string) =>
      new Promise<string>((resolve) =>
        lookup(host, {}, (err, addrs) => resolve(err ? `error: ${err.message}` : addrs.map((a) => a.address).join())),
      );
    expect(await connectTo('example.com')).toBe('93.184.215.14');
    expect(await connectTo('www.example.com')).toMatch(/^error: .*not allowed/);
  });

  test('blocks a followed redirect hop that resolves to a private address', async () => {
    getSpy.mockRejectedValueOnce(redirectError('https://www.example.com/next'));
    expect(await fetchError('https://example.com/')).toMatch(/not allowed/);
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  test('does not surface a cross-host redirect to a private address', async () => {
    getSpy.mockRejectedValueOnce(redirectError('http://169.254.169.254/latest/meta-data/'));
    expect(await fetchError('https://example.com/')).toMatch(/not allowed/);
  });

  test('still surfaces a cross-host redirect to a public address', async () => {
    getSpy.mockRejectedValueOnce(redirectError('https://other.example.org/page'));
    const result = await getURLMarkdownContent('https://example.com/', new AbortController(), dns);
    expect(result).toMatchObject({ type: 'redirect', redirectUrl: 'https://other.example.org/page' });
  });
});
