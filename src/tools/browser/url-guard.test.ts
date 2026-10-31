import { describe, test, expect } from 'bun:test';
import { assertPublicHttpUrl, isBlockedIp, UrlNotAllowedError } from './url-guard.js';

// Fake resolver so tests never hit the network
const resolver = (table: Record<string, string[]>) => async (host: string) => {
  const hit = table[host];
  if (!hit) throw new Error('ENOTFOUND');
  return hit;
};

const publicDns = resolver({
  'example.com': ['93.184.215.14', '2606:2800:21f:cb07:6820:80da:af6b:8b2c'],
  'rebind.attacker.test': ['93.184.215.14', '127.0.0.1'],
  'internal.attacker.test': ['10.0.0.5'],
  'v6-internal.attacker.test': ['fd00::1'],
  'metadata.attacker.test': ['169.254.169.254'],
});

async function rejected(url: string): Promise<boolean> {
  try {
    await assertPublicHttpUrl(url, publicDns);
    return false;
  } catch (e) {
    expect(e).toBeInstanceOf(UrlNotAllowedError);
    return true;
  }
}

describe('assertPublicHttpUrl', () => {
  test('accepts public http(s) URLs', async () => {
    expect((await assertPublicHttpUrl('https://example.com/investors', publicDns)).hostname).toBe('example.com');
    expect((await assertPublicHttpUrl('http://93.184.215.14/', publicDns)).hostname).toBe('93.184.215.14');
    expect((await assertPublicHttpUrl('https://[2606:4700:4700::1111]/', publicDns)).hostname).toBe('[2606:4700:4700::1111]');
  });

  test.each([
    'file:///etc/passwd',
    'ftp://example.com/',
    'javascript:alert(1)',
    'data:text/html,<h1>x</h1>',
    'chrome://settings',
    'not a url',
  ])('rejects non-http(s) or invalid URL %s', async (url) => {
    expect(await rejected(url)).toBe(true);
  });

  test.each([
    'http://127.0.0.1:8000/api',
    'http://localhost:5432/',
    'http://foo.localhost/',
    'http://[::1]/',
    'http://0.0.0.0/',
    'http://10.1.2.3/',
    'http://172.16.0.1/',
    'http://192.168.1.1/',
    'http://100.64.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://[fd00:ec2::254]/',
    'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:a9fe:a9fe]/',
    'http://[64:ff9b::a9fe:a9fe]/',
    'http://[2002:7f00:1::]/',
    'http://2130706433/', // decimal 127.0.0.1
    'http://0x7f.1/', // hex/short form 127.0.0.1
    'http://017700000001/', // octal 127.0.0.1
    'http://224.0.0.1/',
    'http://255.255.255.255/',
  ])('rejects internal destination %s', async (url) => {
    expect(await rejected(url)).toBe(true);
  });

  test('rejects hostnames resolving to any private/loopback/metadata address', async () => {
    expect(await rejected('https://internal.attacker.test/')).toBe(true);
    expect(await rejected('https://v6-internal.attacker.test/')).toBe(true);
    expect(await rejected('https://metadata.attacker.test/')).toBe(true);
    expect(await rejected('https://rebind.attacker.test/')).toBe(true);
  });

  test('rejects unresolvable hosts and URLs with credentials', async () => {
    expect(await rejected('https://nope.invalid/')).toBe(true);
    expect(await rejected('https://user:pass@example.com/')).toBe(true);
  });
});

describe('isBlockedIp', () => {
  test('public addresses are allowed', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.215.14', '2606:4700:4700::1111', '2001:4860:4860::8888']) {
      expect(isBlockedIp(ip)).toBe(false);
    }
  });

  test('non-IP input is never considered safe', () => {
    expect(isBlockedIp('example.com')).toBe(true);
  });
});
