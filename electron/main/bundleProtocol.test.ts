import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { framingHeaders } from '../../scripts/frame-headers.mjs';

const protocolMock = vi.hoisted(() => ({
  registerSchemesAsPrivileged: vi.fn(),
  handle: vi.fn(),
}));

vi.mock('electron', () => ({
  protocol: protocolMock,
}));

import {
  APP_ORIGIN,
  FRAME_PAGE_FILES,
  isFramePage,
  registerBundleScheme,
  resolveBundlePath,
  serveBundle,
} from './bundleProtocol';

describe('bundleProtocol', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    protocolMock.registerSchemesAsPrivileged.mockReset();
    protocolMock.handle.mockReset();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const makeDist = (files: Record<string, string>): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindroom-bundle-'));
    tempDirs.push(dir);
    for (const [relative, content] of Object.entries(files)) {
      const target = path.join(dir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, 'utf8');
    }
    return dir;
  };

  it('exports the app origin and frame page list', () => {
    expect(APP_ORIGIN).toBe('capacitor://localhost');
    expect(FRAME_PAGE_FILES).toEqual(['pdf-frame.html']);
  });

  describe('resolveBundlePath', () => {
    const known = new Set(['index.html', 'pdf-frame.html', 'config.json', 'assets/app.js']);
    const isFile = (relative: string) => known.has(relative);

    it('resolves existing bundle files and SPA routes with dots', () => {
      expect(resolveBundlePath('/', isFile)).toEqual({ file: 'index.html' });
      expect(resolveBundlePath('/assets/app.js', isFile)).toEqual({ file: 'assets/app.js' });
      expect(resolveBundlePath('/config.json', isFile)).toEqual({ file: 'config.json' });
      expect(resolveBundlePath('/pdf-frame.html', isFile)).toEqual({ file: 'pdf-frame.html' });
      expect(resolveBundlePath('/!abc:server.org/$event', isFile)).toEqual({ file: 'index.html' });
      expect(resolveBundlePath('/home/room.with.dots', isFile)).toEqual({ file: 'index.html' });
    });

    it('returns 404 when index.html is missing even on SPA fallback', () => {
      const withoutIndex = (relative: string) => relative === 'assets/app.js';
      expect(resolveBundlePath('/', withoutIndex)).toEqual({ status: 404 });
      expect(resolveBundlePath('/home', withoutIndex)).toEqual({ status: 404 });
      expect(resolveBundlePath('/assets/app.js', withoutIndex)).toEqual({ file: 'assets/app.js' });
    });

    it('returns 404 for missing assets and capacitor paths', () => {
      expect(resolveBundlePath('/assets/missing.js', isFile)).toEqual({ status: 404 });
      expect(resolveBundlePath('/assets/', isFile)).toEqual({ status: 404 });
      expect(resolveBundlePath('/_capacitor_file_/secret', isFile)).toEqual({ status: 404 });
    });

    it('refuses path traversal, escapes, backslashes, null bytes and malformed encoding', () => {
      const probed: string[] = [];
      const trackingIsFile = (relative: string) => {
        probed.push(relative);
        return isFile(relative);
      };

      for (const bad of [
        '/../../etc/passwd',
        '/%2e%2e/etc/passwd',
        '/%2e%2e/',
        '/%2E%2E/etc/passwd',
        '/assets/%2e%2e/%2e%2e/etc/passwd',
        '/..\\etc\\passwd',
        '/%5c..%5cetc/passwd',
        '/index.html%00.png',
        '/%ZZ',
      ]) {
        expect(resolveBundlePath(bad, trackingIsFile), bad).toEqual({ status: 404 });
      }
      expect(probed).toEqual([]);
    });

    it('never reads outside dist for absolute paths', () => {
      const probed: string[] = [];
      const trackingIsFile = (relative: string) => {
        probed.push(relative);
        return relative === 'index.html';
      };
      expect(resolveBundlePath('/etc/passwd', trackingIsFile)).toEqual({ file: 'index.html' });
      expect(resolveBundlePath('//etc/passwd', trackingIsFile)).toEqual({ file: 'index.html' });
      expect(
        probed.every((relative) => !path.isAbsolute(relative) && !relative.includes('..'))
      ).toBe(true);
    });
  });

  describe('isFramePage', () => {
    const known = new Set(['index.html', 'pdf-frame.html', 'assets/app.js']);
    const isFile = (relative: string) => known.has(relative);

    const spellings: Array<[string, boolean]> = [
      ['/pdf-frame.html', true],
      ['/PDF-FRAME.HTML', false],
      ['/Pdf-Frame.html', false],
      ['/pdf-frame%2ehtml', true],
      ['/%70df-frame.html', true],
      ['/%70df-frame%2ehtml', true],
      ['//pdf-frame.html', true],
      ['/pdf-frame.html/', false],
      ['/index', false],
      ['/index.html', false],
      ['/pdf-frame.html?x=1', true],
      ['/%70df-frame%2ehtml?a=b#blob:capacitor://localhost/1', true],
      ['/%2e/pdf-frame.html', false],
      ['/%2e%2e/pdf-frame.html', false],
      ['/assets/pdf-frame.html', false],
    ];

    it('matches resolveBundlePath on every spelling', () => {
      for (const [spelling, expected] of spellings) {
        const resolved = resolveBundlePath(spelling, isFile);
        const resolvedToFrame = 'file' in resolved && FRAME_PAGE_FILES.includes(resolved.file);
        expect(isFramePage(spelling), spelling).toBe(expected);
        expect(isFramePage(spelling), `${spelling} agrees with resolveBundlePath`).toBe(
          resolvedToFrame
        );
      }
    });
  });

  describe('registerBundleScheme', () => {
    it('registers capacitor as standard, secure, cors, stream, fetch without service workers', () => {
      registerBundleScheme();
      expect(protocolMock.registerSchemesAsPrivileged).toHaveBeenCalledWith([
        {
          scheme: 'capacitor',
          privileges: {
            standard: true,
            secure: true,
            corsEnabled: true,
            stream: true,
            supportFetchAPI: true,
            allowServiceWorkers: false,
          },
        },
      ]);
    });
  });

  describe('serveBundle', () => {
    it('serves bundle files, applies framing headers to HTML, and blocks escapes and other hosts', async () => {
      const parent = makeDist({
        'secret.txt': 'TOP_SECRET',
        'dist/index.html': '<!doctype html><title>app</title>',
        'dist/pdf-frame.html': '<!doctype html><title>pdf</title>',
        'dist/assets/app.js': 'console.log(1);',
      });
      const distDir = path.join(parent, 'dist');
      fs.symlinkSync(path.join(parent, 'secret.txt'), path.join(distDir, 'leak.txt'));

      serveBundle(distDir);
      expect(protocolMock.handle).toHaveBeenCalledWith('capacitor', expect.any(Function));
      const handler = protocolMock.handle.mock.calls[0]?.[1] as (
        request: Request
      ) => Promise<Response>;

      const home = await handler(new Request(`${APP_ORIGIN}/!abc:server.org/$event`));
      expect(home.status).toBe(200);
      expect(await home.text()).toContain('<title>app</title>');
      expect({
        'Content-Security-Policy': home.headers.get('content-security-policy'),
        'X-Frame-Options': home.headers.get('x-frame-options'),
      }).toEqual(framingHeaders('/!abc:server.org/$event'));

      for (const unframeable of ['/connect', '/CONNECT', '/invite/', '/invite?code=1']) {
        const res = await handler(new Request(`${APP_ORIGIN}${unframeable}`));
        expect(res.status, unframeable).toBe(200);
        expect(
          {
            'Content-Security-Policy': res.headers.get('content-security-policy'),
            'X-Frame-Options': res.headers.get('x-frame-options'),
          },
          unframeable
        ).toEqual(framingHeaders(unframeable.split('?')[0] ?? unframeable));
      }

      expect(isFramePage('/PDF-FRAME.HTML')).toBe(false);
      const upperCaseFrame = await handler(new Request(`${APP_ORIGIN}/PDF-FRAME.HTML`));
      expect(upperCaseFrame.status).toBe(200);
      expect(await upperCaseFrame.text()).toContain('<title>app</title>');

      const otherHost = await handler(new Request('capacitor://evil.com/index.html'));
      expect(otherHost.status).toBe(404);

      const otherPort = await handler(new Request('capacitor://localhost:8080/index.html'));
      expect(otherPort.status).toBe(404);

      const normalizedEscape = await handler(new Request(`${APP_ORIGIN}/%2e%2e/secret.txt`));
      expect(await normalizedEscape.text()).not.toContain('TOP_SECRET');

      const symlink = await handler(new Request(`${APP_ORIGIN}/leak.txt`));
      expect(symlink.status).toBe(404);
      expect(await symlink.text()).not.toContain('TOP_SECRET');
    });

    it('checks files on each request: symlink swap, removal, and newly added hashed files', async () => {
      const parent = makeDist({
        'secret.txt': 'TOP_SECRET',
        'dist/index.html': '<!doctype html><title>app</title>',
        'dist/assets/app.js': 'console.log(1);',
      });
      const distDir = path.join(parent, 'dist');

      serveBundle(distDir);
      const handler = protocolMock.handle.mock.calls[0]?.[1] as (
        request: Request
      ) => Promise<Response>;

      expect((await handler(new Request(`${APP_ORIGIN}/assets/app.js`))).status).toBe(200);

      // File swapped to a symlink after start -> 404.
      fs.rmSync(path.join(distDir, 'assets/app.js'));
      fs.symlinkSync(path.join(parent, 'secret.txt'), path.join(distDir, 'assets/app.js'));
      const swapped = await handler(new Request(`${APP_ORIGIN}/assets/app.js`));
      expect(swapped.status).toBe(404);
      expect(await swapped.text()).not.toContain('TOP_SECRET');

      // File removed after start -> 404 (no throw).
      fs.rmSync(path.join(distDir, 'assets/app.js'));
      const removed = await handler(new Request(`${APP_ORIGIN}/assets/app.js`));
      expect(removed.status).toBe(404);

      // New hashed file added after start -> served.
      fs.writeFileSync(path.join(distDir, 'assets/app-abc123.js'), 'console.log("new");', 'utf8');
      const added = await handler(new Request(`${APP_ORIGIN}/assets/app-abc123.js`));
      expect(added.status).toBe(200);
      expect(await added.text()).toBe('console.log("new");');

      // index.html swapped to symlink after start -> 404 on SPA fallback too.
      fs.rmSync(path.join(distDir, 'index.html'));
      fs.symlinkSync(path.join(parent, 'secret.txt'), path.join(distDir, 'index.html'));
      for (const route of ['/', '/home', '/index.html']) {
        const res = await handler(new Request(`${APP_ORIGIN}${route}`));
        expect(res.status, route).toBe(404);
        expect(await res.text(), route).not.toContain('TOP_SECRET');
      }
    });
  });
});
