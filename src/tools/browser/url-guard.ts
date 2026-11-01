import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type LookupFn = (hostname: string) => Promise<string[]>;

const defaultLookup: LookupFn = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((r) => r.address);

// Hostnames that resolve to internal services regardless of DNS
const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata', 'metadata.google.internal', 'instance-data']);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa'];

// [network, prefix length] in IPv4 integer form
const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments (incl. some metadata endpoints)
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isBlockedV4(ip: string): boolean {
  const addr = v4ToInt(ip);
  return BLOCKED_V4.some(([net, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (addr & mask) === (v4ToInt(net) & mask);
  });
}

/** Expand an IPv6 address into 8 16-bit groups (handles `::` and embedded IPv4). */
function v6ToGroups(ip: string): number[] {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf('%');
  if (zone !== -1) addr = addr.slice(0, zone);

  // Convert a trailing dotted IPv4 into two hex groups
  const v4Match = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Match) {
    const n = v4ToInt(v4Match[1]!);
    addr = addr.slice(0, -v4Match[1]!.length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }

  const [head, tail] = addr.split('::') as [string, string | undefined];
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const fill = tail !== undefined ? 8 - headGroups.length - tailGroups.length : 0;
  return [...headGroups, ...Array(fill).fill('0'), ...tailGroups].map((g) => parseInt(g, 16) || 0);
}

function groupsToV4(hi: number, lo: number): string {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
}

function isBlockedV6(ip: string): boolean {
  const g = v6ToGroups(ip);
  const allZeroUpTo = (n: number) => g.slice(0, n).every((x) => x === 0);

  // :: (unspecified) and ::1 (loopback)
  if (allZeroUpTo(7) && (g[7] === 0 || g[7] === 1)) return true;
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d -> check the embedded IPv4
  if (allZeroUpTo(5) && (g[5] === 0xffff || g[5] === 0)) return isBlockedV4(groupsToV4(g[6]!, g[7]!));
  // NAT64 64:ff9b::/96 -> embedded IPv4
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isBlockedV4(groupsToV4(g[6]!, g[7]!));
  // 6to4 2002::/16 -> embedded IPv4 in groups 1-2
  if (g[0] === 0x2002) return isBlockedV4(groupsToV4(g[1]!, g[2]!));

  const first = g[0]!;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local (incl. fd00:ec2::254 metadata)
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (first === 0x2001 && g[1] === 0x0db8) return true; // 2001:db8::/32 documentation
  if (first === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return true; // 100::/64 discard
  return false;
}

/** True if an IP literal points at a non-public destination. */
export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedV4(ip);
  if (version === 6) return isBlockedV6(ip);
  return true; // not an IP: never treat as safe
}

export class UrlNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UrlNotAllowedError';
  }
}

/**
 * Resolve `host` (a hostname or IP literal, brackets allowed) and return its addresses,
 * throwing unless every one is public. Connect to a returned address, not to the
 * hostname, so a second DNS answer cannot redirect the connection (DNS rebinding).
 */
export async function resolvePublicHost(host: string, lookup: LookupFn = defaultLookup): Promise<string[]> {
  const hostname = host.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!hostname) throw new UrlNotAllowedError('Missing host');

  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new UrlNotAllowedError('Destination address is not allowed');
    return [hostname];
  }

  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_SUFFIXES.some((s) => hostname.endsWith(s))) {
    throw new UrlNotAllowedError('Destination host is not allowed');
  }

  let addresses: string[];
  try {
    addresses = await lookup(hostname);
  } catch {
    throw new UrlNotAllowedError('Host could not be resolved');
  }
  if (addresses.length === 0 || addresses.some((a) => isBlockedIp(a))) {
    throw new UrlNotAllowedError('Destination address is not allowed');
  }
  return addresses;
}

/**
 * Throw unless `rawUrl` is an http(s) URL whose host resolves only to public addresses.
 * The browser's own connections are pinned to checked addresses by the egress proxy
 * (egress-proxy.ts); this check rejects bad URLs early with a clear error.
 */
export async function assertPublicHttpUrl(rawUrl: string, lookup: LookupFn = defaultLookup): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UrlNotAllowedError('Invalid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlNotAllowedError(`Protocol not allowed: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new UrlNotAllowedError('Credentials in URL are not allowed');
  }

  // WHATWG URL already normalizes decimal/octal/hex IPv4 forms; IPv6 keeps brackets
  await resolvePublicHost(url.hostname, lookup);
  return url;
}
