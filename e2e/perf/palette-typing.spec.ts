import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  chromium,
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import { joinRoom, matrixFetch, type MatrixSession } from '../helpers/matrix';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';
import { pressPaletteShortcut } from '../helpers/paletteShortcut';

/**
 * Typing in the command palette (live-test finding L1-F021: about 340 ms from a key to the frame
 * that shows it, against 40 ms in the composer). Opt in with PERF_PALETTE=1; run it on the
 * production build (`e2e-slot.sh --preview`).
 *
 * The reader is in 66 rooms and 500 threads with two other people. In each engine (Chromium, and
 * WebKit when PLAYWRIGHT_WEBKIT_EXECUTABLE names it) and on a desktop (1440x900) and a phone
 * (390x844, touch), the reader opens the palette and types room and thread words (60 ms between
 * keys) for PERF_TYPE_MS (default 8,000) ms, clearing the field after each phrase. A keystroke's
 * latency runs from its keydown event to the first task after the next animation frame, that is
 * until the frame that shows it has been painted. The median for typed characters must stay
 * within PERF_MAX_P50_MS (default 50), the measure the finding used; the 95th percentile is
 * reported. The composer is measured the same way for comparison.
 * Results go to test-results/perf/palette-typing.json; with PERF_PROFILE=1 a CPU profile of the
 * Chromium desktop page while typing in the palette goes there too.
 */

const enabled = process.env.PERF_PALETTE === '1';
const ROOMS = 66;
const THREADS = 500;
const TYPE_MS = Number(process.env.PERF_TYPE_MS ?? 8_000);
const MAX_P50_MS = Number(process.env.PERF_MAX_P50_MS ?? 50);
const PROFILE = process.env.PERF_PROFILE === '1';
const OUT_DIR = 'test-results/perf';
const PHRASES = ['release p', 'budget review', 'ops handbook deploy'];

const TEAMS = [
  'Release Planning',
  'Ops Handbook',
  'Design Review',
  'Backend Sync',
  'Customer Calls',
  'Data Science',
  'Mobile App',
  'Security Desk',
  'Docs Corner',
  'Support Queue',
  'Infra Budget',
] as const;

const TOPICS = [
  'deploy window and the budget review',
  'release notes for the next build',
  'customer escalation follow-up',
  'onboarding checklist and access',
  'quarterly goals and staffing',
] as const;

const withRetry = async <T>(run: () => Promise<T>): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt > 10 || !String(error).includes('Matrix API 429')) throw error;
      await new Promise((resolve) => {
        setTimeout(resolve, 500 * (attempt + 1));
      });
    }
  }
};

const send = (account: MatrixSession, roomId: string, content: Record<string, unknown>) =>
  withRetry(() =>
    matrixFetch<{ event_id: string }>(
      HOMESERVER,
      `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${randomUUID()}`,
      { method: 'PUT', accessToken: account.accessToken, body: JSON.stringify(content) }
    )
  ).then((body) => body.event_id);

/** Runs `work` over `items` with at most `limit` at a time. */
const pool = async <T>(items: T[], limit: number, work: (item: T) => Promise<unknown>) => {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
    })
  );
};

const seed = async () => {
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const password = `palette-typing-${run}`;
  const reader = await registerDisposableUser(`palette_reader_${run}`, password);
  const others = [
    await registerDisposableUser(`palette_jonas_${run}`, password),
    await registerDisposableUser(`palette_priya_${run}`, password),
  ];
  const rooms = Array.from({ length: ROOMS }, (_, index) => ({
    index,
    name: `${TEAMS[index % TEAMS.length]} ${Math.floor(index / TEAMS.length) + 1}`,
  }));
  const roomIds: string[] = [];
  await pool(rooms, 8, async ({ index, name }) => {
    const body = await withRetry(() =>
      matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
        method: 'POST',
        accessToken: reader.accessToken,
        body: JSON.stringify({
          preset: 'public_chat',
          name,
          topic: `${name}: ${TOPICS[index % TOPICS.length]}`,
        }),
      })
    );
    roomIds[index] = body.room_id;
  });
  await pool(
    roomIds.flatMap((roomId) => others.map((account) => ({ roomId, account }))),
    8,
    ({ roomId, account }) => withRetry(() => joinRoom(HOMESERVER, account.accessToken, roomId))
  );
  await pool(
    Array.from({ length: THREADS }, (_, index) => index),
    12,
    async (index) => {
      const roomId = roomIds[index % ROOMS]!;
      const author = [reader, ...others][index % 3]!;
      const rootId = await send(author, roomId, {
        msgtype: 'm.text',
        body: `Thread ${index + 1}: ${
          TOPICS[index % TOPICS.length]
        }, with notes from the last sync.`,
      });
      await send(others[index % 2]!, roomId, {
        msgtype: 'm.text',
        body: `Reply in thread ${index + 1}: agreed, I will take the ${
          TOPICS[(index + 1) % TOPICS.length]
        } part.`,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: rootId },
        },
      });
    }
  );
  return { reader, roomIds };
};

/** Installed before the app: the latency of each typed key until the frame that shows it. */
const instrument = () => {
  const state = { typed: [] as number[] };
  (window as unknown as { __typing: typeof state }).__typing = state;
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key.length !== 1 || event.ctrlKey || event.metaKey) return;
      const start = event.timeStamp;
      requestAnimationFrame(() => {
        setTimeout(() => state.typed.push(performance.now() - start), 0);
      });
    },
    true
  );
};

const takeLatencies = (page: Page): Promise<number[]> =>
  page.evaluate(() => {
    const state = (window as unknown as { __typing: { typed: number[] } }).__typing;
    const values = state.typed;
    state.typed = [];
    return values;
  });

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, index)] ?? Number.NaN);
};

const summarize = (values: number[]) => ({
  n: values.length,
  p50: percentile(values, 50),
  p95: percentile(values, 95),
  max: Math.round(Math.max(...values)),
});

/** Types the phrases for `ms`, clearing the field after each one. */
const typeFor = async (page: Page, ms: number) => {
  const end = Date.now() + ms;
  for (let index = 0; Date.now() < end; index += 1) {
    await page.keyboard.type(PHRASES[index % PHRASES.length]!, { delay: 60 });
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');
  }
};

type Setup = { name: string; engine: 'chromium' | 'webkit'; options: BrowserContextOptions };

const SETUPS: Setup[] = [
  {
    name: 'chromium-desktop',
    engine: 'chromium',
    options: { viewport: { width: 1440, height: 900 } },
  },
  {
    name: 'chromium-phone',
    engine: 'chromium',
    options: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  },
  { name: 'webkit-desktop', engine: 'webkit', options: { viewport: { width: 1440, height: 900 } } },
  {
    name: 'webkit-phone',
    engine: 'webkit',
    options: { viewport: { width: 390, height: 844 }, hasTouch: true },
  },
];

const measure = async (
  browser: Browser,
  setup: Setup,
  baseURL: string,
  reader: DisposableUser,
  roomId: string
) => {
  const context = await browser.newContext({ baseURL, locale: 'en-US', ...setup.options });
  await context.addInitScript(instrument);
  const page = await context.newPage();
  try {
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: reader.username,
      password: reader.password,
    });
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    const composer = page.getByRole('textbox', { name: 'Send a message...' });
    await expect(composer).toBeVisible({ timeout: 60_000 });
    // Let the first syncs and the thread index settle.
    await page.waitForTimeout(5_000);

    await composer.click();
    await takeLatencies(page);
    await typeFor(page, TYPE_MS / 2);
    const composerLatencies = await takeLatencies(page);
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');

    await pressPaletteShortcut(page);
    const field = page
      .getByRole('dialog', { name: 'Command palette', exact: true })
      .getByRole('combobox');
    await expect(field).toBeFocused();
    const cdp =
      PROFILE && setup.name === 'chromium-desktop' ? await context.newCDPSession(page) : undefined;
    if (cdp) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
      await cdp.send('Profiler.start');
    }
    await takeLatencies(page);
    await typeFor(page, TYPE_MS);
    const paletteLatencies = await takeLatencies(page);
    if (cdp) {
      const { profile } = await cdp.send('Profiler.stop');
      writeFileSync(`${OUT_DIR}/palette-typing-${setup.name}.cpuprofile`, JSON.stringify(profile));
    }
    return {
      setup: setup.name,
      palette: summarize(paletteLatencies),
      composer: summarize(composerLatencies),
    };
  } finally {
    await context.close();
  }
};

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test.describe('palette typing', () => {
  test.skip(!enabled, 'PERF_PALETTE=1 not set');
  test.setTimeout(20 * 60_000);

  test('each key paints within the budget in a busy account', async ({ baseURL }) => {
    test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
    const started = Date.now();
    const { reader, roomIds } = await seed();
    console.log(`seeded ${ROOMS} rooms and ${THREADS} threads in ${Date.now() - started} ms`);
    mkdirSync(OUT_DIR, { recursive: true });

    const results: Awaited<ReturnType<typeof measure>>[] = [];
    for (const setup of SETUPS) {
      if (setup.engine === 'webkit' && !WEBKIT_EXECUTABLE) continue;
      const browser =
        setup.engine === 'webkit'
          ? await launchWebKit()
          : await chromium.launch(CHROMIUM_WITH_SCROLLBARS);
      try {
        const result = await measure(browser, setup, baseURL!, reader, roomIds[0]!);
        console.log(JSON.stringify(result));
        results.push(result);
      } finally {
        await browser.close();
      }
    }
    writeFileSync(`${OUT_DIR}/palette-typing.json`, JSON.stringify(results, null, 2));
    for (const result of results) {
      expect(result.palette.n, `${result.setup} typed keys`).toBeGreaterThan(20);
      expect(result.palette.p50, `${result.setup} palette median ms`).toBeLessThanOrEqual(
        MAX_P50_MS
      );
    }
  });
});
