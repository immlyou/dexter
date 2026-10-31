import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import http from 'node:http';
import net from 'node:net';
import { preferIPv4, startEgressProxy, type EgressProxy } from './egress-proxy.js';
import { resolvePublicHost } from './url-guard.js';

// "public.test" stands in for a public host but is served locally; it does not resolve in
// real DNS, so a successful request also proves the proxy connected to the checked address.
// "rebind.test" resolves to a private address, as a rebinding host would at connect time.
// "multi.test" lists unreachable addresses before the reachable one (127.0.0.2 is refused
// on Linux and never answers on macOS); "dead.test" has only unreachable addresses.
let lookups: string[] = [];
const resolve = (host: string) => {
  lookups.push(host);
  if (host === 'public.test') return Promise.resolve(['127.0.0.1']);
  if (host === 'multi.test') return Promise.resolve(['::1', '127.0.0.2', '127.0.0.1']);
  if (host === 'dead.test') return Promise.resolve(['127.0.0.2']);
  return resolvePublicHost(host, async (name) => (name === 'rebind.test' ? ['10.0.0.5'] : ['93.184.216.34']));
};

const timeouts = { connectTimeoutMs: 300, idleTimeoutMs: 300 };
let proxy: EgressProxy;
let web: http.Server;
let echo: net.Server;
let silent: net.Server;
let webPort = 0;
let echoPort = 0;
let silentPort = 0;
// Resolves when the origin sees the /stall request's connection close
let stallClosed: Promise<void> = Promise.resolve();

function listen(server: net.Server): Promise<number> {
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done((server.address() as net.AddressInfo).port)));
}

/** Send raw bytes to the proxy; resolve with everything it returns until it closes. */
function raw(request: string, after?: string, via: EgressProxy = proxy): Promise<string> {
  const port = Number(new URL(via.server).port);
  return new Promise((done) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(request));
    let out = '';
    socket.on('data', (chunk) => {
      out += chunk.toString();
      if (after && out.startsWith('HTTP/1.1 200')) {
        socket.write(after);
        after = undefined;
      } else if (!after && request.startsWith('CONNECT') && out.endsWith('ping')) {
        socket.end();
      }
    });
    socket.on('close', () => done(out));
    socket.on('error', () => done(out));
  });
}

beforeAll(async () => {
  web = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: `http://127.0.0.1:${webPort}/secret` });
      return res.end();
    }
    if (req.url === '/truncated') {
      res.writeHead(200, { 'content-length': '100000' });
      res.write('partial');
      return setTimeout(() => req.socket.destroy(), 50);
    }
    if (req.url === '/stall') {
      stallClosed = new Promise((done) => req.socket.once('close', () => done()));
      return;
    }
    res.end(`ok ${req.method} ${req.url} host=${req.headers.host} proxyauth=${req.headers['proxy-authorization'] ?? '-'}`);
  });
  echo = net.createServer((socket) => socket.pipe(socket));
  silent = net.createServer(() => {});
  webPort = await listen(web);
  echoPort = await listen(echo);
  silentPort = await listen(silent);
  proxy = await startEgressProxy({ resolve, allowConnectPort: (port) => port !== 25, ...timeouts });
});

afterAll(async () => {
  await proxy.close();
  web.closeAllConnections();
  web.close();
  echo.close();
  silent.close();
});

describe('egress proxy', () => {
  test('forwards plain HTTP to the checked address, keeping Host and dropping proxy headers', async () => {
    lookups = [];
    const out = await raw(
      `GET http://public.test:${webPort}/page?q=1 HTTP/1.1\r\nHost: public.test:${webPort}\r\nProxy-Authorization: x\r\nConnection: close\r\n\r\n`,
    );
    expect(out).toStartWith('HTTP/1.1 200');
    expect(out).toContain(`ok GET /page?q=1 host=public.test:${webPort} proxyauth=-`);
    expect(lookups).toEqual(['public.test']);
  });

  test('tunnels CONNECT to the checked address', async () => {
    const out = await raw(`CONNECT public.test:${echoPort} HTTP/1.1\r\nHost: public.test:${echoPort}\r\n\r\n`, 'ping');
    expect(out).toStartWith('HTTP/1.1 200');
    expect(out).toEndWith('ping');
  });

  test('passes redirects through, and the next hop to loopback is refused', async () => {
    const first = await raw(`GET http://public.test:${webPort}/redirect HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    expect(first).toStartWith('HTTP/1.1 302');
    expect(first).toContain(`http://127.0.0.1:${webPort}/secret`);
    const next = await raw(`GET http://127.0.0.1:${webPort}/secret HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    expect(next).toStartWith('HTTP/1.1 403');
    expect(next).not.toContain('ok GET');
  });

  test.each([
    ['loopback literal', `127.0.0.1:${0}`],
    ['IPv6 loopback', '[::1]:443'],
    ['metadata address', '169.254.169.254:80'],
    ['blocked hostname', 'localhost:443'],
    ['host resolving to a private address', 'rebind.test:443'],
  ])('refuses CONNECT to %s', async (_label, authority) => {
    const target = authority.replace(':0', `:${echoPort}`);
    const out = await raw(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`, 'ping');
    expect(out).toStartWith('HTTP/1.1 403');
    expect(out).not.toContain('ping');
  });

  test('refuses plain HTTP to a host resolving to a private address', async () => {
    const out = await raw('GET http://rebind.test/ HTTP/1.1\r\nHost: rebind.test\r\nConnection: close\r\n\r\n');
    expect(out).toStartWith('HTTP/1.1 403');
  });

  test('rejects malformed targets', async () => {
    expect(await raw('CONNECT nonsense HTTP/1.1\r\nHost: nonsense\r\n\r\n')).toStartWith('HTTP/1.1 400');
    expect(await raw('GET /relative HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')).toStartWith('HTTP/1.1 400');
  });

  test('falls back to the next checked address, IPv4 first, without re-resolving', async () => {
    lookups = [];
    const http1 = await raw(`GET http://multi.test:${webPort}/ HTTP/1.1\r\nHost: multi.test\r\nConnection: close\r\n\r\n`);
    expect(http1).toStartWith('HTTP/1.1 200');
    const tunnel = await raw(`CONNECT multi.test:${echoPort} HTTP/1.1\r\nHost: multi.test:${echoPort}\r\n\r\n`, 'ping');
    expect(tunnel).toStartWith('HTTP/1.1 200');
    expect(tunnel).toEndWith('ping');
    expect(lookups).toEqual(['multi.test', 'multi.test']);
  });

  test('orders IPv4 answers first, keeping resolver order within a family', () => {
    expect(preferIPv4(['2001:4860::1', '93.184.216.34', '2001:4860::2', '1.1.1.1'])).toEqual([
      '93.184.216.34', '1.1.1.1', '2001:4860::1', '2001:4860::2',
    ]);
  });

  test('answers 502 when no checked address is reachable', async () => {
    expect(await raw(`GET http://dead.test:${webPort}/ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`)).toStartWith('HTTP/1.1 502');
    expect(await raw(`CONNECT dead.test:${echoPort} HTTP/1.1\r\nHost: dead.test:${echoPort}\r\n\r\n`)).toStartWith('HTTP/1.1 502');
  });

  test('refuses CONNECT to ports outside the allowed set before resolving', async () => {
    lookups = [];
    expect(await raw('CONNECT public.test:25 HTTP/1.1\r\nHost: public.test:25\r\n\r\n')).toStartWith('HTTP/1.1 403');
    const strict = await startEgressProxy({ resolve });
    try {
      expect(await raw(`CONNECT public.test:${echoPort} HTTP/1.1\r\nHost: public.test:${echoPort}\r\n\r\n`, 'ping', strict)).toStartWith('HTTP/1.1 403');
    } finally {
      await strict.close();
    }
    expect(lookups).toEqual([]);
  });

  test('closes the browser connection when the upstream body is truncated', async () => {
    const out = await raw(`GET http://public.test:${webPort}/truncated HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    expect(out).toStartWith('HTTP/1.1 200');
    expect(out).toContain('\r\n\r\npartial'); // resolving at all means the connection was closed
  });

  test('times out an idle upstream request and an idle tunnel', async () => {
    expect(await raw(`GET http://public.test:${webPort}/stall HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`)).toStartWith('HTTP/1.1 502');
    await stallClosed;
    expect(await raw(`CONNECT public.test:${silentPort} HTTP/1.1\r\nHost: public.test:${silentPort}\r\n\r\n`)).toBe('HTTP/1.1 200 Connection Established\r\n\r\n');
  });

  test('close() tears down in-flight upstream requests', async () => {
    const own = await startEgressProxy({ resolve });
    const pending = raw(`GET http://public.test:${webPort}/stall HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`, undefined, own);
    while (lookups.at(-1) !== 'public.test') await Bun.sleep(5);
    await Bun.sleep(100);
    const originSawClose = stallClosed;
    await own.close();
    await originSawClose;
    await pending;
  });

  test('does not connect when DNS answers after close()', async () => {
    let answer: (addresses: string[]) => void = () => {};
    let connections = 0;
    const counter = net.createServer((socket) => {
      connections++;
      socket.destroy();
    });
    const port = await listen(counter);
    const own = await startEgressProxy({
      resolve: () => new Promise((done) => (answer = done)),
      allowConnectPort: () => true,
    });
    const pending = raw(`CONNECT slow.test:${port} HTTP/1.1\r\nHost: slow.test:${port}\r\n\r\n`, undefined, own);
    await Bun.sleep(50);
    await own.close();
    answer(['127.0.0.1']);
    await pending;
    await Bun.sleep(50);
    expect(connections).toBe(0);
    counter.close();
  });
});
