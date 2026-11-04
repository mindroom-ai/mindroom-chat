import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { frameHeaders, framingHeaders } from '../scripts/frame-headers.mjs';

type Middleware = (
  req: { url?: string },
  res: { setHeader: (name: string, value: string) => void },
  next: () => void
) => void;

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

describe('framingHeaders', () => {
  it('lets only pages of the same origin frame the app, which frames its own PDF page', () => {
    for (const path of ['/', '/login/matrix.org/', '/home/!room:example.org', '/pdf-frame.html']) {
      expect(framingHeaders(path), path).toEqual({
        'Content-Security-Policy': "frame-ancestors 'self'",
        'X-Frame-Options': 'SAMEORIGIN',
      });
    }
  });

  it('lets nothing frame the pairing page, also under a base path', () => {
    for (const path of ['/connect', '/connect/', '/chat/connect']) {
      expect(framingHeaders(path), path).toEqual({
        'Content-Security-Policy': "frame-ancestors 'none'",
        'X-Frame-Options': 'DENY',
      });
    }
    expect(framingHeaders('/connections')['X-Frame-Options']).toBe('SAMEORIGIN');
  });
});

describe('frameHeaders', () => {
  it('sends them from vite preview, by the path without its query', () => {
    expect(previewHeaders('/connect?code=123')['X-Frame-Options']).toBe('DENY');
    expect(previewHeaders('/home/')['Content-Security-Policy']).toBe("frame-ancestors 'self'");
  });
});

describe('index.html policy', () => {
  const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  it('allows no plugin content and no <base> element that moves relative URLs', () => {
    expect(indexHtml).toContain(
      `<meta http-equiv="Content-Security-Policy" content="object-src 'none'; base-uri 'self'" />`
    );
  });
});

describe('netlify.toml', () => {
  const netlify = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');

  it('sends the same framing headers as vite preview', () => {
    const rule = (path: string) =>
      new RegExp(
        `for = "${path.replace(/[*/]/g, '\\$&')}"\\s+\\[headers\\.values\\]\\s+` +
          `Content-Security-Policy = "${framingHeaders(path)['Content-Security-Policy']}"\\s+` +
          `X-Frame-Options = "${framingHeaders(path)['X-Frame-Options']}"`
      );
    expect(netlify).toMatch(rule('/*'));
    expect(netlify).toMatch(rule('/connect'));
    expect(netlify).toMatch(rule('/connect/'));
  });
});
