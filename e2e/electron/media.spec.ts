import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { DISPOSABLE_HOMESERVER } from '../helpers/disposableAccounts';
import { assertNoUnexpectedViolations, launchDesktop } from '../helpers/electronApp';
import { loginToMatrix, matrixFetch } from '../helpers/matrix';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PRELOAD_PATH = path.join(ROOT, 'build/electron/preload.cjs');
const SESSION_STORE_KEY = 'mindroom_multi_account_store';
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);
const APP_ORIGIN = 'capacitor://localhost';
const VIDEO_BYTES = Buffer.alloc(1024, 0x41);
const TINY_WEBM = Buffer.from(
  'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAALeEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEyTbuMU6uEHFO7a1OsggLI7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjMuMS4xMDJXQYxMYXZmNjMuMS4xMDJEiYhAj0AAAAAAABZUrmvXrgEAAAAAAABO14EBc8WIQfRNr6Mm7NacgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QF9eEA4JCwgSC6gSCagQJVsIRVuYEBVe6BAOwBAAAAAAAAAgAAElTDZ/pzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYzLjEuMTAyc3PVY8CLY8WIQfRNr6Mm7NZnyKBFo4dFTkNPREVSRIeTTGF2YzYzLjEuMTAyIGxpYnZweGfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMDAwMDAwMDAwAB9DtnVBEeeBAKO9gQAAgNACAJ0BKiAAIAAARwiFhYiFhIgCAgJ1qgP4AgghCD0A/v9NEv/8WFfxYV/FhX/xYV/8/M7txfzmAKOVgQBkALEBAAEQEAAYABhYL/QACHAAo5WBAMgAsQEAARAQABgAGFgv9AAIcACjlYEBLACxAQABEBAAGAAYWC/0AAhwAKOVgQGQALEBAAEQEAAYABhYL/QACHAAo5WBAfQAsQEAARAQABgAGFgv9AAIcACjlYECWACxAQABEBAAGAAYWC/0AAhwAKOVgQK8ALEBAAEQEBRgAGFgv9AAIcAAo5WBAyAAsQEAARAQABgAGFgv9AAIcACjlYEDhACxAQABEBAAGAAYWC/0AAhwABxTu2uRu4+zgQC3iveBAfGCAbHwgQM=',
  'base64'
);

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
      'Cache-Control': 'no-store',
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

    if (pathname.endsWith('/cacheable.txt')) {
      res.writeHead(200, {
        ...cors,
        'Content-Type': 'text/plain',
        'Cache-Control': 'private, max-age=31536000, immutable',
      });
      res.end('cached');
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

    // Push session through the real session store (exercising startDesktopMediaAuth). The push is
    // synchronous, so a request issued right after the store change already carries the token.
    await page.evaluate(
      async ({ key, baseUrl }) => {
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
        window.dispatchEvent(new StorageEvent('storage', { key }));
        await fetch(`${baseUrl}/_matrix/client/v1/media/download/a/probe.txt`);
      },
      { key: SESSION_STORE_KEY, baseUrl: server.url }
    );
    expect(
      server.requests.filter((r) => r.url.includes('/probe.txt')).map((r) => r.authorization)
    ).toStrictEqual(['Bearer tok-a']);

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

    // 6b. dedicated blob: worker GET arrives without Authorization while the page's own GET still gets it
    await page.evaluate(
      (url) =>
        new Promise<void>((resolve, reject) => {
          const blob = new Blob(
            [
              `fetch(${JSON.stringify(
                url
              )}).then((r) => postMessage(r.ok ? 'ok' : 'bad'), (e) => postMessage(String(e)));`,
            ],
            { type: 'text/javascript' }
          );
          const blobUrl = URL.createObjectURL(blob);
          const worker = new Worker(blobUrl);
          worker.onmessage = (event) => {
            worker.terminate();
            URL.revokeObjectURL(blobUrl);
            if (event.data === 'ok') resolve();
            else reject(new Error(`worker fetch failed: ${String(event.data)}`));
          };
          worker.onerror = (err) => {
            worker.terminate();
            URL.revokeObjectURL(blobUrl);
            reject(new Error(`worker error: ${err.message}`));
          };
        }),
      `${server.url}/_matrix/client/v1/media/download/a/worker.txt`
    );
    const workerReq = await server.waitForRequest(
      (r) => r.url.includes('/worker.txt'),
      'worker.txt'
    );
    expect(workerReq.authorization).toBeUndefined();

    const pageAfterWorker = await page.evaluate(async (url) => {
      const res = await fetch(url);
      return res.ok;
    }, `${server.url}/_matrix/client/v1/media/download/a/page-after-worker.txt`);
    expect(pageAfterWorker).toBe(true);
    const pageAfterWorkerReq = await server.waitForRequest(
      (r) => r.url.includes('/page-after-worker.txt'),
      'page-after-worker.txt'
    );
    expect(pageAfterWorkerReq.authorization).toBe('Bearer tok-a');

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

    // 8. a cacheable authorized response is served from the HTTP cache while signed in
    const cacheableUrl = `${server.url}/_matrix/client/v1/media/download/a/cacheable.txt`;
    const cacheableRequests = (): RecordedRequest[] =>
      server.requests.filter((r) => r.url.includes('/cacheable.txt'));
    const fetchText = (url: string): Promise<string> =>
      page.evaluate(async (u) => (await fetch(u)).text(), url);
    expect(await fetchText(cacheableUrl)).toBe('cached');
    expect(await fetchText(cacheableUrl)).toBe('cached');
    expect(cacheableRequests().map((r) => r.authorization)).toStrictEqual(['Bearer tok-a']);

    // 9. after sign-out the next request arrives without Authorization, and the cached response
    // is gone: the same URL reaches the server again, without Authorization
    await page.evaluate(
      async ({ key, url }) => {
        window.localStorage.setItem(key, JSON.stringify({ version: 1, sessions: [] }));
        window.dispatchEvent(new StorageEvent('storage', { key }));
        await fetch(url);
      },
      {
        key: SESSION_STORE_KEY,
        url: `${server.url}/_matrix/client/v1/media/download/a/after-signout.txt`,
      }
    );
    const afterSignOut = server.requests.filter((r) => r.url.includes('/after-signout.txt'));
    expect(afterSignOut).toHaveLength(1);
    expect(afterSignOut[0]?.authorization).toBeUndefined();
    expect(await fetchText(cacheableUrl)).toBe('cached');
    expect(cacheableRequests()).toHaveLength(2);
    expect(cacheableRequests()[1]?.authorization).toBeUndefined();
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
    await desktop.watchPage(page2);
    await page2.waitForLoadState('domcontentloaded');

    const resA = await page.evaluate(
      (baseUrl) =>
        window.mindroomDesktop!.setMediaSession({ baseUrl, userId: '@a:a', accessToken: 'tok-a' }),
      serverA.url
    );
    expect(resA).toEqual({ ok: true, value: undefined });

    const resB = await page2.evaluate(
      (baseUrl) =>
        window.mindroomDesktop!.setMediaSession({ baseUrl, userId: '@b:b', accessToken: 'tok-b' }),
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

test('@homeserver renders authenticated image and avatar, plays video, and copies without token', async () => {
  const homeserver = process.env.E2E_HOMESERVER_URL ?? DISPOSABLE_HOMESERVER;
  const suffix = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const username = `desktop_media_${suffix}`;
  const password = `Pass_${crypto.randomBytes(8).toString('hex')}`;
  const displayName = `Media User ${suffix}`;

  const reg = await fetch(`${homeserver}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  expect(reg.ok, `registering ${username} on ${homeserver} (${reg.status})`).toBe(true);
  const alice = await loginToMatrix(homeserver, username, password);

  const upload = async (bytes: Buffer, contentType: string, filename: string): Promise<string> => {
    const res = await fetch(
      `${homeserver}/_matrix/media/v3/upload?filename=${encodeURIComponent(filename)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${alice.accessToken}`,
          'Content-Type': contentType,
        },
        body: new Uint8Array(bytes),
      }
    );
    expect(res.ok, `uploading ${filename} (${res.status})`).toBe(true);
    const data = (await res.json()) as { content_uri?: string };
    expect(data.content_uri).toMatch(/^mxc:\/\//);
    return data.content_uri!;
  };

  const imageUri = await upload(PIXEL_PNG, 'image/png', 'media-auth-picture.png');
  // Its own upload, so a request for the timeline image is not the avatar's.
  const avatarUri = await upload(PIXEL_PNG, 'image/png', 'media-auth-avatar.png');
  expect(avatarUri).not.toBe(imageUri);
  const videoUri = await upload(TINY_WEBM, 'video/webm', 'media-auth-clip.webm');

  const profilePath = `/profile/${encodeURIComponent(alice.userId)}`;
  await matrixFetch(homeserver, `${profilePath}/displayname`, {
    method: 'PUT',
    accessToken: alice.accessToken,
    body: JSON.stringify({ displayname: displayName }),
  });
  await matrixFetch(homeserver, `${profilePath}/avatar_url`, {
    method: 'PUT',
    accessToken: alice.accessToken,
    body: JSON.stringify({ avatar_url: avatarUri }),
  });

  const roomName = `Desktop Media ${suffix}`;
  const roomId = await createRoom(homeserver, alice.accessToken, {
    name: roomName,
    encrypted: false,
  });

  const sendMessage = async (txn: string, content: Record<string, unknown>): Promise<void> => {
    await matrixFetch(
      homeserver,
      `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txn)}`,
      {
        method: 'PUT',
        accessToken: alice.accessToken,
        body: JSON.stringify(content),
      }
    );
  };

  await sendMessage(`img_${suffix}`, {
    msgtype: 'm.image',
    body: 'media-auth-picture.png',
    url: imageUri,
    info: { mimetype: 'image/png', w: 1, h: 1, size: PIXEL_PNG.length },
  });
  await sendMessage(`vid_${suffix}`, {
    msgtype: 'm.video',
    body: 'media-auth-clip.webm',
    url: videoUri,
    info: { mimetype: 'video/webm', w: 32, h: 32, duration: 1000, size: TINY_WEBM.length },
  });

  const desktop = await launchDesktop();
  const { app, page } = desktop;
  const setup = page.getByRole('dialog').filter({ hasText: 'Set up your recovery password' });
  await page.addLocatorHandler(setup, () => setup.getByRole('button', { name: 'Not now' }).click());

  // Every media request of the page, from before the sign-in on.
  const mediaRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/_matrix\/(?:client\/v1\/)?media\//.test(request.url()))
      mediaRequests.push(request.url());
  });

  try {
    await loginWithPassword(page, {
      homeserver,
      username,
      password,
      baseUrl: APP_ORIGIN,
    });

    // Open the seeded room through the sidebar: no reload between the sign-in and the first image.
    await page.getByRole('link', { name: roomName }).first().click({ timeout: 30_000 });
    const timeline = page.getByTestId('room-virtual-inner');
    await expect(timeline).toBeVisible({ timeout: 20_000 });

    // 1. Timeline image renders right after sign-in. The app shows it from a blob it fetched, so
    // the endpoint is checked on the requests: the image came from the authenticated endpoint, and
    // no media request went to the legacy one (which this homeserver also answers, and which the
    // page uses while main holds no session) or put a token in a URL.
    const image = timeline.locator('img[alt="media-auth-picture.png"]').first();
    await expect(image).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth > 0), {
        timeout: 15_000,
      })
      .toBe(true);
    const imageSrc = await image.evaluate((el: HTMLImageElement) => el.currentSrc);
    expect(imageSrc).toMatch(/^blob:|\/_matrix\/client\/v1\/media\//);
    const imagePath = imageUri.replace('mxc://', '');
    expect(
      mediaRequests.filter((url) =>
        new RegExp(`/_matrix/client/v1/media/(?:thumbnail|download)/${imagePath}(?:[/?]|$)`).test(
          url
        )
      ).length
    ).toBeGreaterThan(0);
    expect(mediaRequests.filter((url) => !url.includes('/_matrix/client/v1/media/'))).toEqual([]);
    expect(mediaRequests.filter((url) => url.includes('access_token'))).toEqual([]);
    expect(imageSrc).not.toContain('access_token');
    expect(imageSrc).not.toContain(alice.accessToken);

    // 2. User A's avatar renders with naturalWidth > 0 and no access_token in its URL.
    const avatar = page.locator(`img[alt="${displayName}"]`).first();
    await expect(avatar).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => avatar.evaluate((el: HTMLImageElement) => el.naturalWidth > 0), {
        timeout: 15_000,
      })
      .toBe(true);
    const avatarSrc = await avatar.evaluate((el: HTMLImageElement) => el.currentSrc || el.src);
    expect(avatarSrc).not.toContain('access_token');
    expect(avatarSrc).not.toContain(alice.accessToken);

    // 3. Video loads and plays (currentTime > 0).
    const video = timeline.locator('video').first();
    const watchButton = timeline.getByRole('button', { name: 'Watch' }).first();
    await expect(video.or(watchButton)).toBeVisible({ timeout: 20_000 });
    if (await watchButton.isVisible()) await watchButton.click();
    await expect(video).toBeVisible({ timeout: 15_000 });
    await video.evaluate(async (el: HTMLVideoElement) => {
      el.muted = true;
      el.loop = true;
      try {
        await el.play();
      } catch {
        // Headless environments may block play(); polled below.
      }
    });
    await expect
      .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime > 0), {
        timeout: 15_000,
      })
      .toBe(true);

    // 4. Copying a selection across the image puts neither access_token nor the session token on the clipboard.
    const desktopAccessToken = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return '';
      const parsed = JSON.parse(raw) as {
        activeSessionId?: string;
        sessions?: Array<{ sessionId?: string; accessToken?: string }>;
      };
      return (
        parsed.sessions?.find((s) => s.sessionId === parsed.activeSessionId)?.accessToken ?? ''
      );
    }, SESSION_STORE_KEY);
    expect(desktopAccessToken.length).toBeGreaterThan(0);

    await app.evaluate(({ clipboard }) => clipboard.clear());
    await image.evaluate((img: HTMLImageElement) => {
      const container =
        img.closest('[data-event-id]') ?? img.closest('article') ?? img.parentElement ?? img;
      const range = document.createRange();
      range.selectNodeContents(container);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand('copy');
    });
    const clip = await app.evaluate(async ({ clipboard }) => {
      let html = '';
      for (const item of await clipboard.read()) {
        if (item.types.includes('text/html')) {
          html += await (await item.getType('text/html')).text();
        }
      }
      return { html, text: await clipboard.readText() };
    });
    // The copy took the image element along, so the checks below look at its URL.
    expect(clip.html).toMatch(/<img\b[^>]*\bsrc="[^"]+"/);
    expect(clip.html).toContain('media-auth-picture.png');
    const copied = `${clip.html}\n${clip.text}`;
    expect(copied).not.toContain('access_token');
    expect(copied).not.toContain(desktopAccessToken);
    expect(copied).not.toContain(alice.accessToken);

    // 5. Zero unexpected CSP violations.
    expect(desktop.violations).toEqual([]);
  } finally {
    await desktop.close();
  }
});
