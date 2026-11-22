import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { assertNoUnexpectedViolations, launchDesktop } from '../helpers/electronApp';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PRELOAD_PATH = path.join(ROOT, 'build/electron/preload.cjs');
const SESSION_STORE_KEY = 'mindroom_multi_account_store';
const SESSION_STORE_EVENT = 'mindroom-session-store-changed';
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);
const VIDEO_BYTES = Buffer.alloc(1024, 0x41);

type RecordedRequest = {
  url: string;
  method: string;
  authorization: string | undefined;
  range: string | undefined;
};

type MediaServer = {
  url: string;
  requests: RecordedRequest[];
  waitForRequest: (
    predicate: (req: RecordedRequest) => boolean,
    label: string
  ) => Promise<RecordedRequest>;
  close: () => Promise<void>;
};

const startMediaServer = async (
  getRedirectTarget?: (pathname: string) => string | undefined
): Promise<MediaServer> => {
  const requests: RecordedRequest[] = [];
  const waiters: Array<() => void> = [];
  const sockets = new Set<Duplex>();

  const notify = (): void => {
    for (const wake of waiters.splice(0)) wake();
  };

  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const cors: Record<string, string> = {
      'Access-Control-Allow-Origin': req.headers.origin ?? '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Range',
      'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Range',
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    const record: RecordedRequest = {
      url: req.url ?? '/',
      method: req.method ?? 'GET',
      authorization:
        typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
      range: typeof req.headers.range === 'string' ? req.headers.range : undefined,
    };
    requests.push(record);
    notify();

    const redirectTo = getRedirectTarget?.(pathname);
    if (redirectTo) {
      res.writeHead(302, { ...cors, Location: redirectTo });
      res.end();
      return;
    }

    if (pathname.endsWith('.png')) {
      res.writeHead(200, { ...cors, 'Content-Type': 'image/png' });
      res.end(PIXEL_PNG);
      return;
    }

    if (pathname.endsWith('.bin')) {
      res.writeHead(200, {
        ...cors,
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="file.bin"',
      });
      res.end(Buffer.from('download-bytes'));
      return;
    }

    if (pathname.endsWith('.mp4')) {
      if (req.headers.range) {
        const end = VIDEO_BYTES.length - 1;
        res.writeHead(206, {
          ...cors,
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes 0-${end}/${VIDEO_BYTES.length}`,
          'Content-Length': String(VIDEO_BYTES.length),
        });
        res.end(VIDEO_BYTES);
        return;
      }
      res.writeHead(200, {
        ...cors,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Length': String(VIDEO_BYTES.length),
      });
      res.end(VIDEO_BYTES);
      return;
    }

    if (pathname === '/_matrix/client/v3/sync') {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }

    res.writeHead(200, { ...cors, 'Content-Type': 'text/plain' });
    res.end('ok');
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  const waitForRequest = async (
    predicate: (req: RecordedRequest) => boolean,
    label: string
  ): Promise<RecordedRequest> => {
    const existing = requests.find(predicate);
    if (existing) return existing;
    return new Promise<RecordedRequest>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for media request: ${label}`)),
        10_000
      );
      const check = (): void => {
        const found = requests.find(predicate);
        if (found) {
          clearTimeout(timer);
          resolve(found);
        } else {
          waiters.push(check);
        }
      };
      waiters.push(check);
    });
  };

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    waitForRequest,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};

test.afterEach(() => {
  assertNoUnexpectedViolations();
});

test('authorizes main-frame media requests, preserves caller Authorization, denies subframes, and clears on sign-out', async () => {
  const server = await startMediaServer();
  const desktop = await launchDesktop();
  try {
    const { app, page } = desktop;

    // Record and cancel downloads once triggered so nothing lands on disk.
    await app.evaluate(({ session }) => {
      const downloaded: string[] = [];
      Object.assign(globalThis, { __mindroomDownloadedFiles: downloaded });
      session.defaultSession.on('will-download', (_event, item) => {
        downloaded.push(item.getFilename());
        item.cancel();
      });
    });

    // Push session through the real session store (exercising startDesktopMediaAuth).
    await page.evaluate(
      ({ key, eventName, baseUrl }) => {
        const sessionId = `${encodeURIComponent(baseUrl)}::${encodeURIComponent('@alice:local')}`;
        window.localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            activeSessionId: sessionId,
            sessions: [
              {
                sessionId,
                baseUrl,
                userId: '@alice:local',
                deviceId: 'DEV1',
                accessToken: 'tok-a',
                lastUsedAt: Date.now(),
              },
            ],
          })
        );
        window.dispatchEvent(new Event(eventName));
      },
      { key: SESSION_STORE_KEY, eventName: SESSION_STORE_EVENT, baseUrl: server.url }
    );

    // Wait for main to store the pushed session (no sleep).
    await expect
      .poll(async () => {
        await page.evaluate(async (url) => {
          await fetch(url);
        }, `${server.url}/_matrix/client/v1/media/download/a/probe.txt`);
        return server.requests.filter((r) => r.url.includes('/probe.txt')).at(-1)?.authorization;
      })
      .toBe('Bearer tok-a');

    // 1. <img>
    await page.evaluate(
      (src) =>
        new Promise<void>((resolve, reject) => {
          const img = document.createElement('img');
          img.onload = () => (img.naturalWidth === 1 ? resolve() : reject(new Error('bad size')));
          img.onerror = () => reject(new Error('img load failed'));
          img.src = src;
          document.body.append(img);
        }),
      `${server.url}/_matrix/client/v1/media/download/a/img.png`
    );
    const imgReq = await server.waitForRequest((r) => r.url.includes('/img.png'), 'img.png');
    expect(imgReq.authorization).toBe('Bearer tok-a');
    expect(imgReq.url).not.toContain('access_token');

    // 2. fetch
    const fetchOk = await page.evaluate(async (url) => {
      const res = await fetch(url);
      return res.ok && (await res.text()) === 'ok';
    }, `${server.url}/_matrix/client/v1/media/download/a/data.txt`);
    expect(fetchOk).toBe(true);
    const fetchReq = await server.waitForRequest((r) => r.url.includes('/data.txt'), 'data.txt');
    expect(fetchReq.authorization).toBe('Bearer tok-a');
    expect(fetchReq.url).not.toContain('access_token');

    // 3. download (downloadMedia -> Blob -> <a download> as saveFile does)
    await page.evaluate(async (href) => {
      const res = await fetch(href, { method: 'GET' });
      if (!res.ok) throw new Error(`download failed: ${res.status}`);
      const blobUrl = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = 'file.bin';
      document.body.append(a);
      a.click();
    }, `${server.url}/_matrix/client/v1/media/download/a/file.bin`);
    const downloadReq = await server.waitForRequest(
      (r) => r.url.includes('/file.bin'),
      'download file.bin'
    );
    expect(downloadReq.authorization).toBe('Bearer tok-a');
    expect(downloadReq.url).not.toContain('access_token');
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (globalThis as { __mindroomDownloadedFiles?: string[] }).__mindroomDownloadedFiles ?? []
        )
      )
      .toContain('file.bin');

    // 4. <video> Range request
    await page.evaluate((src) => {
      const video = document.createElement('video');
      video.preload = 'auto';
      video.src = src;
      document.body.append(video);
    }, `${server.url}/_matrix/client/v1/media/download/a/video.mp4`);
    const videoReq = await server.waitForRequest(
      (r) => r.url.includes('/video.mp4') && Boolean(r.range),
      'video.mp4 Range'
    );
    expect(videoReq.authorization).toBe('Bearer tok-a');
    expect(videoReq.range).toMatch(/^bytes=/);
    expect(videoReq.url).not.toContain('access_token');

    // 5. fetch to /sync with its own bearer passes untouched
    await page.evaluate(async (url) => {
      const res = await fetch(url, { headers: { Authorization: 'Bearer sdk-bearer' } });
      if (!res.ok) throw new Error(`sync status ${res.status}`);
    }, `${server.url}/_matrix/client/v3/sync`);
    const syncReq = await server.waitForRequest(
      (r) => r.url.includes('/_matrix/client/v3/sync'),
      'sync'
    );
    expect(syncReq.authorization).toBe('Bearer sdk-bearer');

    // 6. same-origin subframe arrives without Authorization
    await page.evaluate((src) => {
      const iframe = document.createElement('iframe');
      iframe.srcdoc = `<img src="${src}">`;
      document.body.append(iframe);
    }, `${server.url}/_matrix/client/v1/media/download/a/subframe.png`);
    const subReq = await server.waitForRequest(
      (r) => r.url.includes('/subframe.png'),
      'subframe.png'
    );
    expect(subReq.authorization).toBeUndefined();

    // 7. opaque sandboxed frame arrives without Authorization
    await page.evaluate((src) => {
      const iframe = document.createElement('iframe');
      iframe.sandbox.value = '';
      iframe.srcdoc = `<img src="${src}">`;
      document.body.append(iframe);
    }, `${server.url}/_matrix/client/v1/media/download/a/opaque.png`);
    const opaqueReq = await server.waitForRequest(
      (r) => r.url.includes('/opaque.png'),
      'opaque.png'
    );
    expect(opaqueReq.authorization).toBeUndefined();

    // 8. after sign-out, requests arrive without Authorization
    await page.evaluate(
      ({ key, eventName }) => {
        window.localStorage.setItem(key, JSON.stringify({ version: 1, sessions: [] }));
        window.dispatchEvent(new Event(eventName));
      },
      { key: SESSION_STORE_KEY, eventName: SESSION_STORE_EVENT }
    );
    await expect
      .poll(async () => {
        await page.evaluate(async (url) => {
          await fetch(url);
        }, `${server.url}/_matrix/client/v1/media/download/a/after-signout.txt`);
        return server.requests.filter((r) => r.url.includes('/after-signout.txt')).at(-1)
          ?.authorization;
      })
      .toBeUndefined();
  } finally {
    await desktop.close();
    await server.close();
  }
});

test('never attaches a token on redirects across two signed-in windows or same-origin redirects', async () => {
  const serverB = await startMediaServer();
  let serverAUrl = '';
  const serverA = await startMediaServer((pathname) => {
    if (pathname.endsWith('/redirect-to-b')) {
      return `${serverB.url}/_matrix/client/v1/media/download/b/target.txt`;
    }
    if (pathname.endsWith('/redirect-same')) {
      return `${serverAUrl}/_matrix/client/v1/media/download/a/same-target.txt`;
    }
    return undefined;
  });
  serverAUrl = serverA.url;

  const desktop = await launchDesktop();
  try {
    const { app, page } = desktop;

    // Open a second app window signed in to server B.
    const win2Promise = app.waitForEvent('window');
    await app.evaluate(async ({ BrowserWindow }, preload) => {
      const win = new BrowserWindow({
        show: false,
        webPreferences: {
          preload,
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webviewTag: false,
        },
      });
      await win.loadURL('capacitor://localhost/');
    }, PRELOAD_PATH);
    const page2 = await win2Promise;
    await page2.waitForLoadState('domcontentloaded');

    const resA = await page.evaluate(
      (baseUrl) => window.mindroomDesktop!.setMediaSession({ baseUrl, accessToken: 'tok-a' }),
      serverA.url
    );
    expect(resA).toEqual({ ok: true, value: undefined });

    const resB = await page2.evaluate(
      (baseUrl) => window.mindroomDesktop!.setMediaSession({ baseUrl, accessToken: 'tok-b' }),
      serverB.url
    );
    expect(resB).toEqual({ ok: true, value: undefined });

    // Confirm Window 2 is authorized for server B.
    await page2.evaluate(async (url) => {
      await fetch(url);
    }, `${serverB.url}/_matrix/client/v1/media/download/b/direct.txt`);
    const directB = await serverB.waitForRequest(
      (r) => r.url.includes('/direct.txt'),
      'direct.txt'
    );
    expect(directB.authorization).toBe('Bearer tok-b');

    // Window 1 hits A's media URL, which redirects to B's media URL: B gets no header.
    await page.evaluate(async (url) => {
      await fetch(url);
    }, `${serverA.url}/_matrix/client/v1/media/download/a/redirect-to-b`);
    const hopA = await serverA.waitForRequest(
      (r) => r.url.includes('/redirect-to-b'),
      'redirect-to-b'
    );
    const hopB = await serverB.waitForRequest((r) => r.url.includes('/target.txt'), 'target.txt');
    expect(hopA.authorization).toBe('Bearer tok-a');
    expect(hopB.authorization).toBeUndefined();

    // Window 1 hits A's media URL, which redirects to another media URL on A: hop 2 gets no header.
    await page.evaluate(async (url) => {
      await fetch(url);
    }, `${serverA.url}/_matrix/client/v1/media/download/a/redirect-same`);
    const sameHop1 = await serverA.waitForRequest(
      (r) => r.url.includes('/redirect-same'),
      'redirect-same'
    );
    const sameHop2 = await serverA.waitForRequest(
      (r) => r.url.includes('/same-target.txt'),
      'same-target.txt'
    );
    expect(sameHop1.authorization).toBe('Bearer tok-a');
    expect(sameHop2.authorization).toBeUndefined();
  } finally {
    await desktop.close();
    await serverA.close();
    await serverB.close();
  }
});
