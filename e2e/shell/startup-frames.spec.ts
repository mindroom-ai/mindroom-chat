import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { buildLoginPath } from '../env';
import { joinRoom, loginToMatrix, sendRoomMessage } from '../helpers/matrix';
import { createRoom } from '../helpers/createRoom';
import { blockWebKitServiceWorkers } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// What a person sees while the app starts, frame by frame, in the light theme: the splash never
// flashes black while its particle background starts, no frame between the splash and the shell is
// empty, and a start with saved rooms shows them while the first sync is still out. Checked against
// the slot's Tuwunel with the production build. Set STARTUP_FRAMES_SHOTS=<directory> to save every
// recorded frame.
const PASSWORD = 'startup-frames-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.STARTUP_FRAMES_SHOTS;
// STARTUP_ROOMS and STARTUP_MESSAGES make a heavier account (rooms, and messages in each).
const ROOM_COUNT = Number(process.env.STARTUP_ROOMS ?? 3);
const MESSAGES = Number(process.env.STARTUP_MESSAGES ?? 0);
const ROOMS = ['Harbor Plans', 'Budget Review', 'Release Notes'].concat(
  Array.from({ length: Math.max(0, ROOM_COUNT - 3) }, (_, index) => `Project Room ${index + 4}`)
);

test.use({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
// The warm start holds the first sync back with a route.
test.use(blockWebKitServiceWorkers);

const register = async (name: string) => {
  const username = `suf_${name}_${RUN}`;
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  expect(response.ok, `registering ${username}`).toBe(true);
  return { ...(await loginToMatrix(HOMESERVER, username, PASSWORD)), username };
};

type DomState = { t: number; state: string; detail: string };

/**
 * Records, in every animation frame, what the page shows: the document before the app renders, the
 * sign-in form, the splash, the shell (room rows) or none of them (an empty page).
 */
const sampleDomStates = (page: Page) =>
  page.addInitScript(() => {
    const states: { t: number; state: string; detail: string }[] = [];
    (window as unknown as { __domStates: typeof states }).__domStates = states;
    const frames: number[] = [];
    (window as unknown as { __frameTimes: typeof frames }).__frameTimes = frames;
    const classify = (): [string, string] => {
      const rows = document.querySelectorAll('[data-room-id]').length;
      if (rows) return ['shell', `${rows} rows`];
      if (document.querySelector('input[name="passwordInput"]')) return ['login', ''];
      // The document before the app's first render.
      if (!document.getElementById('root')?.childElementCount) return ['loading', ''];
      const text = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim();
      // The splash names the app under its loading line.
      if (text.endsWith('MindRoom')) return ['splash', ''];
      // What the page holds then, without generated class names.
      const markup = (document.getElementById('root')?.innerHTML ?? '')
        .replace(/ class="[^"]*"/g, '')
        .slice(0, 400);
      return ['empty', `${text.slice(0, 60)} | ${markup}`];
    };
    const sample = () => {
      frames.push(Math.round(performance.now()));
      const [state, detail] = classify();
      const last = states[states.length - 1];
      if (!last || last.state !== state || last.detail !== detail) {
        states.push({ t: Math.round(performance.now()), state, detail });
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

const readDomStates = (page: Page): Promise<DomState[]> =>
  page.evaluate(() => (window as unknown as { __domStates: DomState[] }).__domStates.slice());

type Frame = { t: number; data: string };

const startScreencast = async (page: Page): Promise<{ cdp: CDPSession; frames: Frame[] }> => {
  const cdp = await page.context().newCDPSession(page);
  const frames: Frame[] = [];
  cdp.on('Page.screencastFrame', (frame) => {
    frames.push({ t: frame.metadata.timestamp ?? 0, data: frame.data });
    cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => undefined);
  });
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 320, maxHeight: 200 });
  return { cdp, frames };
};

type FrameStats = { t: number; mean: number; std: number };

/** Mean luminance (0 to 255) and its spread for each frame, measured in a blank page. */
const measureFrames = async (page: Page, frames: Frame[], since: number): Promise<FrameStats[]> => {
  const helper = await page.context().newPage();
  try {
    const stats = await helper.evaluate(async (images) => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      const measured: { t: number; mean: number; std: number }[] = [];
      for (const image of images) {
        // eslint-disable-next-line no-await-in-loop
        const bitmap = await createImageBitmap(
          // eslint-disable-next-line no-await-in-loop
          await (await fetch(`data:image/png;base64,${image.data}`)).blob()
        );
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        context.drawImage(bitmap, 0, 0);
        const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
        let sum = 0;
        let squares = 0;
        const count = data.length / 4;
        for (let index = 0; index < data.length; index += 4) {
          const luminance =
            0.2126 * (data[index] ?? 0) +
            0.7152 * (data[index + 1] ?? 0) +
            0.0722 * (data[index + 2] ?? 0);
          sum += luminance;
          squares += luminance * luminance;
        }
        const mean = sum / count;
        measured.push({
          t: image.t,
          mean: Math.round(mean),
          std: Math.round(Math.sqrt(squares / count - mean * mean) * 10) / 10,
        });
      }
      return measured;
    }, frames);
    return stats.map((frame) => ({ ...frame, t: Math.round((frame.t - since) * 1000) }));
  } finally {
    await helper.close();
  }
};

const saveFrames = async (frames: Frame[], since: number, name: string) => {
  if (!SHOTS) return;
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(`${SHOTS}/${name}`, { recursive: true });
  frames.forEach((frame, index) =>
    writeFileSync(
      `${SHOTS}/${name}/f${String(index).padStart(3, '0')}-${Math.round(
        (frame.t - since) * 1000
      )}ms.png`,
      Buffer.from(frame.data, 'base64')
    )
  );
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/** Requests of the start that matter for its timing, in ms since `since` (a Date.now()). */
const recordRequests = (page: Page, since: () => number) => {
  const timeline: string[] = [];
  const watched =
    /\/(login|versions|pushrules\/|filter|sync|keys\/upload|keys\/query|capabilities)/;
  page.on('request', (request) => {
    const match = watched.exec(new URL(request.url()).pathname);
    if (match) timeline.push(`${Date.now() - since()} > ${match[1]}`);
  });
  page.on('response', (response) => {
    const match = watched.exec(new URL(response.url()).pathname);
    if (match) timeline.push(`${Date.now() - since()} < ${match[1]}`);
  });
  return timeline;
};

test('the start shows no black or empty frame, and saved rooms before the first sync @webkit', async ({
  page,
  browserName,
}) => {
  test.setTimeout(300_000);
  const reader = await register('reader');
  const writer = await register('writer');
  for (const name of ROOMS) {
    // eslint-disable-next-line no-await-in-loop
    const roomId = await createRoom(HOMESERVER, writer.accessToken, {
      name,
      invite: [reader.userId],
    });
    // eslint-disable-next-line no-await-in-loop
    await joinRoom(HOMESERVER, reader.accessToken, roomId);
    for (let start = 0; start < MESSAGES; start += 10) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(
        Array.from({ length: Math.min(10, MESSAGES - start) }, (_, offset) =>
          sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
            msgtype: 'm.text',
            body: `Update ${start + offset} on the schedule, the budget and the open review items.`,
          })
        )
      );
    }
  }
  // STARTUP_REDUCED_MOTION=1: the particle background stays still.
  if (process.env.STARTUP_REDUCED_MOTION === '1') {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  }
  await sampleDomStates(page);
  let clickedAt = 0;
  const requests = recordRequests(page, () => clickedAt);
  // The screencast is Chromium's (DevTools protocol); WebKit records only what the page shows.
  const screencast = async () =>
    browserName === 'chromium' ? startScreencast(page) : { cdp: undefined, frames: [] as Frame[] };

  // Cold: sign in.
  await page.goto(buildLoginPath(HOMESERVER, false));
  await page.locator('input[name="usernameInput"]').fill(reader.username);
  await page.locator('input[name="passwordInput"]').fill(PASSWORD);
  const cold = await screencast();
  const coldStart = Date.now() / 1000;
  const coldClick = await page.evaluate(() => performance.now());
  clickedAt = Date.now();
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.locator('[data-room-id]').first()).toBeVisible({ timeout: 60_000 });
  const coldRowsMs = Date.now() - clickedAt;
  await page.waitForTimeout(800);
  await cold.cdp?.send('Page.stopScreencast');
  const coldStates = (await readDomStates(page)).filter((state) => state.t >= coldClick);
  const coldFrameCount = await page.evaluate(
    (since) =>
      (window as unknown as { __frameTimes: number[] }).__frameTimes.filter((t) => t >= since)
        .length,
    coldClick
  );
  const coldRequests = requests.splice(0);
  const coldFrames = await measureFrames(page, cold.frames, coldStart);
  await saveFrames(cold.frames, coldStart, 'cold');

  // Warm: open the app again with the first sync held back.
  await page.goto('about:blank');
  let releaseSync!: () => void;
  const syncHeld = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });
  let syncAnswered = Number.POSITIVE_INFINITY;
  await page.route(/\/_matrix\/client\/v3\/sync/, async (route) => {
    await syncHeld;
    await route.continue();
  });
  page.on('response', (response) => {
    if (/\/_matrix\/client\/v3\/sync/.test(response.url())) {
      syncAnswered = Math.min(syncAnswered, Date.now());
    }
  });
  const warm = await screencast();
  const warmStart = Date.now() / 1000;
  clickedAt = Date.now();
  await page.goto('/home/');
  const rowsBeforeSync = await page
    .locator('[data-room-id]')
    .first()
    .waitFor({ timeout: 6_000 })
    .then(
      () => true,
      () => false
    );
  const rowsAt = Date.now();
  releaseSync();
  await expect(page.locator('[data-room-id]').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await warm.cdp?.send('Page.stopScreencast');
  const warmStates = await readDomStates(page);
  const warmFrames = await measureFrames(page, warm.frames, warmStart);
  await saveFrames(warm.frames, warmStart, 'warm');

  // Where WebGL draws decides what the particle background costs the main thread.
  const webgl = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return { webgl2: false };
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      webgl2: true,
      renderer: String(gl.getParameter(gl.RENDERER)),
      unmasked: info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : undefined,
      caveat:
        document
          .createElement('canvas')
          .getContext('webgl2', { failIfMajorPerformanceCaveat: true }) === null,
    };
  });
  // eslint-disable-next-line no-console
  console.log(
    'STARTUP',
    JSON.stringify({
      webgl,
      cold: {
        rowsMs: coldRowsMs,
        animationFrames: coldFrameCount,
        states: coldStates.map((s) => ({ ...s, t: Math.round(s.t - coldClick) })),
        requests: coldRequests,
        frames: coldFrames,
      },
      warm: {
        states: warmStates,
        frames: warmFrames,
        rowsBeforeSync,
        requests,
        rowsMs: Math.round(rowsAt - warmStart * 1000),
        syncAnsweredMs: Number.isFinite(syncAnswered)
          ? Math.round(syncAnswered - warmStart * 1000)
          : null,
      },
    })
  );

  const dark = (frames: FrameStats[]) => frames.filter((frame) => frame.mean < 80);
  expect(dark(coldFrames)).toEqual([]);
  expect(dark(warmFrames)).toEqual([]);
  const empty = (states: DomState[]) => states.filter((state) => state.state === 'empty');
  expect(empty(coldStates)).toEqual([]);
  expect(empty(warmStates)).toEqual([]);
  expect(rowsBeforeSync).toBe(true);
});
