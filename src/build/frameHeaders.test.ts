import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { frameHeaders, framingHeaders, isPairingPagePath } from '../../scripts/frame-headers.mjs';
import policy from '../../scripts/frame-headers.json';
import { withServePy } from './test-utils/servePy';

type Middleware = (
  req: { url?: string },
  res: { setHeader: (name: string, value: string) => void },
  next: () => void
) => void;

const repoFile = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

/** The headers `vite preview` sends for a request to `url`. */
const previewHeaders = (url: string) => {
  let middleware: Middleware | undefined;
  const configure = frameHeaders().configurePreviewServer as unknown as (server: {
    middlewares: { use: (handler: Middleware) => void };
  }) => void;
  configure({ middlewares: { use: (handler) => (middleware = handler) } });
  const headers: Record<string, string> = {};
  const next = vi.fn();
  middleware?.({ url }, { setHeader: (name, value) => (headers[name] = value) }, next);
  expect(next).toHaveBeenCalledTimes(1);
  return headers;
};

const UNFRAMEABLE = policy.pairingPageHeaders;
const SAME_ORIGIN = policy.otherPageHeaders;

// Every spelling that renders the pairing page: the router ignores letter case and decodes
// escapes, browsers send repeated slashes and dot segments as typed, and a base path may lead.
const PAIRING_PAGE_SPELLINGS = [
  '/connect',
  '/connect/',
  '/connect//',
  '/CONNECT/',
  '/Connect',
  '/%63onnect/',
  '/%43ONNECT',
  '/%63%6F%6E%6E%65%63%74',
  '//connect',
  '/./connect',
  '/x/../connect',
  '/chat/connect',
  '/connect%2F',
];
// Paths the router shows as something else (a space, a room) or that are files.
const OTHER_PATHS = [
  '/',
  '/index.html',
  '/login/matrix.org/',
  '/home/!room:example.org',
  '/pdf-frame.html',
  '/connections',
  '/connect/ABC',
  '/connect.',
  '/connect;x',
  '/connectx',
  '/%zz',
  '/runtime-config.js',
];

describe('framingHeaders', () => {
  it('lets only pages of the same origin frame the app, which frames its own PDF page', () => {
    for (const path of OTHER_PATHS) expect(framingHeaders(path), path).toEqual(SAME_ORIGIN);
  });

  it('lets nothing frame the pairing page, in every spelling that renders it', () => {
    for (const path of PAIRING_PAGE_SPELLINGS) {
      expect(isPairingPagePath(path), path).toBe(true);
      expect(framingHeaders(path), path).toEqual(UNFRAMEABLE);
    }
  });

  it('takes its values from frame-headers.json', () => {
    expect(UNFRAMEABLE).toEqual({
      'Content-Security-Policy': "frame-ancestors 'none'",
      'X-Frame-Options': 'DENY',
    });
    expect(SAME_ORIGIN).toEqual({
      'Content-Security-Policy': "frame-ancestors 'self'",
      'X-Frame-Options': 'SAMEORIGIN',
    });
  });
});

describe('frameHeaders', () => {
  it('sends them from vite preview, by the path without its query', () => {
    expect(previewHeaders('/connect?code=123')['X-Frame-Options']).toBe('DENY');
    expect(previewHeaders('/CONNECT/?code=123')['X-Frame-Options']).toBe('DENY');
    expect(previewHeaders('/home/?next=/connect')['Content-Security-Policy']).toBe(
      "frame-ancestors 'self'"
    );
  });
});

describe('scripts/frame_headers.py (serve.py)', () => {
  it('answers every path the way the JavaScript rule does', () => {
    const paths = [...PAIRING_PAGE_SPELLINGS, ...OTHER_PATHS, '/connect/?code=AB', '/?x=/connect'];
    const lines = execFileSync('python3', [repoFile('scripts/frame_headers.py'), ...paths], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n');
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual(
      paths.map((path) => framingHeaders(path.split('?')[0] ?? path))
    );
  });

  // Starts Python and serve.py (test-utils/servePy.ts), so this test gets 30 s.
  it('is what serve.py sends, on the app shell and on files alike', async () => {
    const files = {
      'index.html': '<!doctype html><title>app</title>',
      'pdf-frame.html': '<!doctype html><title>pdf</title>',
    };
    await withServePy(files, async (request) => {
      for (const path of ['/', '/pdf-frame.html', '/home/', '/connect/?code=AB', '/CONNECT']) {
        const { headers } = await request(path);
        const sent = {
          'Content-Security-Policy': headers.get('content-security-policy'),
          'X-Frame-Options': headers.get('x-frame-options'),
        };
        expect(sent, path).toEqual(framingHeaders(path.split('?')[0] ?? path));
      }
    });
  }, 30_000);
});

describe('docker/entrypoint.d/40-frame-headers.sh (nginx)', () => {
  const script = readFileSync(repoFile('docker/entrypoint.d/40-frame-headers.sh'), 'utf8');

  /** The nginx map on `variable`: its case-insensitive pattern, match value and default. */
  const nginxMap = (variable: string) => {
    const block = new RegExp(
      `map \\$request_uri \\$${variable} \\{\\s*"~\\*([^"]+)" "([^"]+)";\\s*default "([^"]+)";\\s*\\}`
    ).exec(script);
    expect(block, variable).not.toBeNull();
    const [, pattern = '', matched = '', fallback = ''] = block ?? [];
    const regex = new RegExp(pattern, 'i');
    return (requestUri: string) => (regex.test(requestUri) ? matched : fallback);
  };

  it('sends the same headers as the JavaScript rule, for the address the browser asked for', () => {
    const csp = nginxMap('mindroom_frame_ancestors');
    const xfo = nginxMap('mindroom_frame_options');
    const requests = [...PAIRING_PAGE_SPELLINGS, ...OTHER_PATHS, '/connect/?code=AB'];
    for (const request of [...requests, '/?x=/connect', '/home/?next=%2Fconnect']) {
      const expected = framingHeaders(request.split('?')[0] ?? request);
      expect({ 'Content-Security-Policy': csp(request), 'X-Frame-Options': xfo(request) }).toEqual(
        expected
      );
    }
  });

  it('sets both headers on every answer, errors included, for the whole http block', () => {
    expect(script).toContain(
      'add_header Content-Security-Policy $mindroom_frame_ancestors always;'
    );
    expect(script).toContain('add_header X-Frame-Options $mindroom_frame_options always;');
    expect(script).toContain('include /etc/nginx/mindroom-frame-headers.inc;');
    expect(script).toContain('> /etc/nginx/conf.d/mindroom-frame-headers.conf');
  });
});

describe('index.html policy', () => {
  const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

  it('allows no plugin content and no <base> element that moves relative URLs', () => {
    expect(indexHtml).toContain(
      `<meta http-equiv="Content-Security-Policy" content="object-src 'none'; base-uri 'self'" />`
    );
  });
});
