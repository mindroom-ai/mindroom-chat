import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium, expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  registerAgentAccount,
  seedRoomOverviewState,
  sendStateEvent,
  type MatrixSession,
} from '../helpers/matrix';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';

/**
 * Filtering a big Compact list (live-test lane 6, finding L6-F020): a filter change must show its
 * result within 100 ms.
 *
 * A room holds FILTER_THREADS (default 600) threads, each a root and one reply; every fourth one
 * is resolved. The reader opens it in the Compact view among 24 other rooms and changes the
 * filters: the simple Unresolved toggle on and off, the switch to the advanced filters and back,
 * the Working and All presets, and a search (a letter no thread has, then Backspace). Each
 * change is timed from its click or keydown to the first frame after the list and the count show
 * its result, that is until that frame has been painted (the next task after it); the search's
 * 300 ms pause in typing is not counted. Every change
 * runs FILTER_ROUNDS (default 3) times; the median of each must stay within FILTER_BUDGET_MS
 * (default 100) and no single run above twice that.
 *
 * Then FILTER_AGENTS (default 8) agents stream replies in threads of their own, an edit a second
 * each, and the Unresolved toggle is timed again: its median while they stream must stay within
 * FILTER_BUSY_BUDGET_MS (default 150).
 *
 * Chromium at 1280x800 with classic scrollbars, and WebKit when PLAYWRIGHT_WEBKIT_EXECUTABLE names
 * it. Run it on the production build (e2e-slot.sh --preview). The timings go to
 * test-results/perf/compact-filter.json; with FILTER_PROFILE=1, a CPU profile of each Chromium
 * change goes beside it.
 */

const THREADS = Number(process.env.FILTER_THREADS ?? 600);
const ROUNDS = Number(process.env.FILTER_ROUNDS ?? 3);
const BUDGET_MS = Number(process.env.FILTER_BUDGET_MS ?? 100);
const BUSY_BUDGET_MS = Number(process.env.FILTER_BUSY_BUDGET_MS ?? 150);
const AGENTS = Number(process.env.FILTER_AGENTS ?? 8);
const PROFILE = process.env.FILTER_PROFILE === '1';
const ENGINES = (process.env.FILTER_ENGINES ?? 'chromium,webkit').split(',');
const OTHER_ROOMS = 24;
const UNRESOLVED_ON = '[data-simple-unresolved-toggle][aria-pressed="true"]';
const UNRESOLVED_OFF = '[data-simple-unresolved-toggle][aria-pressed="false"]';
const OUT_DIR = 'test-results/perf';
const DESKTOP = { width: 1280, height: 800 };

const TOPICS = [
  'Draft the onboarding email',
  'Profile the search API under load',
  'Deploy checklist for the release',
  'Translate the help center batch',
  'Rotate the staging keys',
  'Fix the login timeout on slow networks',
  'Compare vector stores for memory',
  'Write the backup and restore guide',
];
const isResolved = (index: number) => index % 4 === 1;
const RESOLVED = Array.from({ length: THREADS }, (_u, index) => index).filter(isResolved).length;

const send = async (
  homeserver: string,
  session: MatrixSession,
  roomId: string,
  type: string,
  content: Record<string, unknown>
): Promise<string> => {
  const body = await matrixFetch<{ event_id: string }>(
    homeserver,
    `/rooms/${encodeURIComponent(roomId)}/send/${type}/${randomUUID()}`,
    { method: 'PUT', accessToken: session.accessToken, body: JSON.stringify(content) }
  );
  return body.event_id;
};

const threadRelation = (rootId: string, replyTo: string, fallingBack: boolean) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: fallingBack,
  'm.in_reply_to': { event_id: replyTo },
});

/** Runs `work` over `items` with at most `limit` at a time. */
const pool = async <T>(items: T[], limit: number, work: (item: T) => Promise<void>) => {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
    })
  );
};

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const registerPerson = async (homeserver: string): Promise<MatrixSession> => {
  const body = await matrixFetch<{ access_token: string; user_id: string }>(
    homeserver,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({
        username: `filter-person-${randomUUID().slice(0, 8)}`,
        password: randomUUID(),
        auth: { type: 'm.login.dummy' },
      }),
    }
  );
  return { accessToken: body.access_token, userId: body.user_id };
};

/** Every agent streams replies in new threads, an edit a second, until `stop`. */
const startAgents = (
  homeserver: string,
  roomId: string,
  poster: MatrixSession,
  agents: MatrixSession[]
) => {
  let running = true;
  const stream = async (agent: MatrixSession, index: number) => {
    await wait((index * 1000) / agents.length);
    for (let round = 1; running; round += 1) {
      const rootId = await send(homeserver, poster, roomId, 'm.room.message', {
        msgtype: 'm.text',
        body: `Agent ${index + 1}, round ${round}: summarize the open questions`,
        'm.mentions': { user_ids: [agent.userId] },
      });
      const replyId = await send(homeserver, agent, roomId, 'm.room.message', {
        msgtype: 'm.text',
        body: 'Thinking...',
        'io.mindroom.stream_status': 'pending',
        'm.relates_to': threadRelation(rootId, rootId, false),
      });
      const words: string[] = [];
      for (let edit = 1; edit <= 12 && running; edit += 1) {
        await wait(1000);
        words.push(...Array.from({ length: 4 }, (_u, word) => `word${words.length + word + 1}`));
        const content = {
          msgtype: 'm.notice',
          body: words.join(' '),
          'io.mindroom.stream_status': edit === 12 ? 'completed' : 'streaming',
        };
        await send(homeserver, agent, roomId, 'm.room.message', {
          ...content,
          body: `* ${content.body}`,
          'm.new_content': content,
          'm.relates_to': { rel_type: 'm.replace', event_id: replyId },
        });
      }
    }
  };
  const done = Promise.all(agents.map((agent, index) => stream(agent, index)));
  return {
    stop: async () => {
      running = false;
      await done;
    },
  };
};

/** What a timed change must show: cards (the count saying so), resolved cards, an element. */
type Expect = { cards?: number; resolved?: number; selector?: string };

/**
 * Installed before the app. `arm(expect)` starts a timing at the next click or keydown: from that
 * event until the frame after the list shows `expect` and the count matches the list.
 */
const instrument = () => {
  type Timing = { done?: number; error?: string };
  const state: { timing?: Timing } = {};
  const list = () => document.querySelector('[data-compact-room-view="true"]');
  const shown = () => list()?.querySelectorAll('[data-thread-root-id]').length ?? 0;
  const resolved = () =>
    list()?.querySelectorAll('[data-thread-root-id][data-attention-state="resolved"]').length ?? 0;
  const counted = () =>
    document.querySelector('[data-room-thread-overview] [data-thread-count]')?.textContent?.trim();
  const arm = (expected: { cards?: number; resolved?: number; selector?: string }) => {
    const timing: Timing = {};
    state.timing = timing;
    const met = () =>
      (expected.cards === undefined || shown() === expected.cards) &&
      (expected.resolved === undefined || resolved() === expected.resolved) &&
      (expected.selector === undefined || !!document.querySelector(expected.selector)) &&
      counted() === String(shown());
    const start = (event: Event) => {
      document.removeEventListener('click', start, true);
      document.removeEventListener('keydown', start, true);
      const startedAt = event.timeStamp;
      const check = () => {
        if (performance.now() - startedAt > 15_000) {
          timing.error = `${shown()} cards, ${resolved()} resolved, count ${
            counted() ?? '-'
          }; expected ${JSON.stringify(expected)}`;
          return;
        }
        if (met()) {
          // The frame that shows the result is painted before the next task runs.
          setTimeout(() => {
            timing.done = performance.now() - startedAt;
          }, 0);
          return;
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    };
    document.addEventListener('click', start, true);
    document.addEventListener('keydown', start, true);
  };
  (window as unknown as { __filterTiming: unknown }).__filterTiming = { state, arm };
};

type FilterTiming = {
  state: { timing?: { done?: number; error?: string } };
  arm: (expected: Expect) => void;
};

/** Times `act`, which must leave the list showing `expected`. */
const timeChange = async (
  page: Page,
  expected: Expect,
  act: () => Promise<void>
): Promise<number> => {
  await page.evaluate((value) => {
    (window as unknown as { __filterTiming: FilterTiming }).__filterTiming.arm(value);
  }, expected);
  await act();
  const handle = await page.waitForFunction(
    () => {
      const { timing } = (window as unknown as { __filterTiming: FilterTiming }).__filterTiming
        .state;
      if (timing?.error) return { error: timing.error };
      return timing?.done === undefined ? false : { done: timing.done };
    },
    undefined,
    { timeout: 20_000, polling: 100 }
  );
  const result = (await handle.jsonValue()) as { done?: number; error?: string };
  if (result.error !== undefined) throw new Error(result.error);
  return Math.round(result.done ?? Number.NaN);
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
};

type Seeded = { roomId: string; poster: MatrixSession; agents: MatrixSession[] };

const seedRoom = async (homeserver: string, reader: MatrixSession): Promise<Seeded> => {
  const poster = await registerPerson(homeserver);
  const agents = await Promise.all(
    Array.from({ length: Math.max(1, AGENTS) }, (_u, index) =>
      registerAgentAccount(homeserver, `filter${index + 1}`)
    )
  );
  const roomId = await createPrivateRoom(homeserver, poster.accessToken, {
    name: `Filter room ${Date.now()}`,
    topic: 'Hundreds of threads to filter',
    invite: [reader.userId, ...agents.map((agent) => agent.userId)],
  });
  await Promise.all(
    [reader, ...agents].map((session) => joinRoom(homeserver, session.accessToken, roomId))
  );
  await pool(
    Array.from({ length: THREADS }, (_u, index) => index),
    12,
    async (index) => {
      const author = index % 3 === 0 ? reader : poster;
      const rootId = await send(homeserver, author, roomId, 'm.room.message', {
        msgtype: 'm.text',
        body: `${TOPICS[index % TOPICS.length]} ${index}: what is left before Friday?`,
      });
      const agent = agents[index % agents.length]!;
      await send(homeserver, agent, roomId, 'm.room.message', {
        msgtype: 'm.notice',
        body: `Thread ${index}: two items are left, the review and the rollout note. I will post both today.`,
        'm.relates_to': threadRelation(rootId, rootId, true),
      });
      if (isResolved(index)) {
        await sendStateEvent(
          homeserver,
          poster.accessToken,
          roomId,
          'com.mindroom.thread.tags',
          JSON.stringify([rootId, 'resolved']),
          { set_by: poster.userId, set_at: new Date().toISOString() }
        );
      }
    }
  );
  // Other rooms in the sidebar, as an account in use has.
  await pool(
    Array.from({ length: OTHER_ROOMS }, (_u, index) => index),
    6,
    async (index) => {
      const otherId = await createPrivateRoom(homeserver, poster.accessToken, {
        name: `Side room ${index + 1}`,
        topic: 'Other work',
        invite: [reader.userId],
      });
      await joinRoom(homeserver, reader.accessToken, otherId);
      await send(homeserver, poster, otherId, 'm.room.message', {
        msgtype: 'm.text',
        body: `Notes for side room ${index + 1}`,
      });
    }
  );
  return { roomId, poster, agents };
};

// A trace snapshots the whole page at every action, which would cost more than the page does.
test.use({ trace: 'off', video: 'off', screenshot: 'off', actionTimeout: 30_000 });

test.describe('compact filter timing', () => {
  test.skip(!hasPrimaryCredentials(), 'needs the e2e homeserver');
  test.setTimeout(20 * 60_000);

  test('filters a 600-thread Compact list within 100 ms', async ({ baseURL }) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const reader = await loginToMatrix(homeserver, username, password);
    const seedStart = Date.now();
    const seeded = await seedRoom(homeserver, reader);
    const seedSeconds = Math.round((Date.now() - seedStart) / 1000);

    mkdirSync(OUT_DIR, { recursive: true });
    const launchers: Record<string, () => Promise<Browser>> = {
      webkit: launchWebKit,
      chromium: () =>
        chromium.launch({
          executablePath: process.env.CHROMIUM_PATH || undefined,
          args: ['--disable-features=IsolateSandboxedIframes'],
          ignoreDefaultArgs: ['--hide-scrollbars'],
        }),
    };
    const engines = ENGINES.filter((engine) => engine !== 'webkit' || !!WEBKIT_EXECUTABLE);
    const results: Record<string, unknown>[] = [];

    for (const engine of engines) {
      const launch = launchers[engine];
      if (!launch) throw new Error(`Unknown engine ${engine}`);
      const browser = await launch();
      try {
        const context = await browser.newContext({
          baseURL,
          viewport: DESKTOP,
          locale: 'en-US',
        });
        await context.addInitScript(instrument);
        const page = await context.newPage();
        await loginWithPassword(page, { homeserver, username, password });
        await seedRoomOverviewState({
          page,
          roomId: seeded.roomId,
          userId: reader.userId,
          viewMode: 'compact',
          filterState: createDefaultThreadFilterState(),
        });
        await page.goto(`/home/${encodeURIComponent(seeded.roomId)}`);
        const view = page.locator('[data-compact-room-view="true"]');
        const cards = view.locator('[data-thread-root-id]');
        await expect(view).toBeVisible({ timeout: 120_000 });
        await expect
          .poll(() => cards.count(), { timeout: 180_000, message: 'all threads listed' })
          .toBe(THREADS);
        const overview = page.locator('[data-room-thread-overview]');
        const count = overview.locator('[data-thread-count]');
        await expect(count).toHaveText(String(THREADS));
        // The seeded filter state opens the advanced filters; the timing starts simple.
        const modeSwitchButton = overview.locator('[data-thread-filter-mode-switch]');
        if ((await modeSwitchButton.getAttribute('aria-pressed')) === 'true') {
          await modeSwitchButton.click();
        }
        await expect(overview.locator('[data-simple-unresolved-toggle]')).toBeVisible();
        await page.mouse.move(1, 1);
        // Let the list settle (cache writes, receipts) before timing it.
        await wait(3_000);

        const cdp = engine === 'chromium' && PROFILE ? await context.newCDPSession(page) : null;
        const profiled = async (name: string, run: () => Promise<number>) => {
          if (!cdp) return run();
          await cdp.send('Profiler.enable');
          await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
          await cdp.send('Profiler.start');
          const ms = await run();
          const { profile } = await cdp.send('Profiler.stop');
          writeFileSync(
            `${OUT_DIR}/compact-filter-${engine}-${name}.cpuprofile`,
            JSON.stringify(profile)
          );
          return ms;
        };

        const unresolved = overview.locator('[data-simple-unresolved-toggle]');
        const modeSwitch = overview.locator('[data-thread-filter-mode-switch]');
        const timings: Record<string, number[]> = {};
        const record = async (
          name: string,
          expected: Expect,
          act: () => Promise<void>,
          pauseMs = 0
        ) => {
          const label = `${name.replace(/\W+/g, '-')}-${(timings[name] ?? []).length}`;
          const ms = await profiled(label, () => timeChange(page, expected, act));
          (timings[name] ??= []).push(ms - pauseMs);
          await page.mouse.move(1, 1);
          await wait(500);
        };
        const clickIn = (locator: Locator) => () => locator.click();
        const pressOption = (id: string) => async () => {
          // A preset option acts on its press.
          await overview.locator(`[data-preset-option="${id}"]`).hover();
          await page.mouse.down();
          await page.mouse.up();
        };
        const openPresets = async () => {
          await overview.locator('[data-preset-button]').click();
          await expect(overview.locator('[data-preset-option="all"]')).toBeVisible();
        };

        for (let round = 0; round < ROUNDS; round += 1) {
          await record(
            'unresolved on',
            { cards: THREADS - RESOLVED, resolved: 0, selector: UNRESOLVED_ON },
            clickIn(unresolved)
          );
          await record(
            'unresolved off',
            { cards: THREADS, resolved: RESOLVED, selector: UNRESOLVED_OFF },
            clickIn(unresolved)
          );
        }
        for (let round = 0; round < ROUNDS; round += 1) {
          await record(
            'advanced filters',
            { cards: THREADS, selector: '[data-room-thread-overview] [data-preset-button]' },
            clickIn(modeSwitch)
          );
          await record(
            'simple filters',
            { cards: THREADS, selector: UNRESOLVED_OFF },
            clickIn(modeSwitch)
          );
        }
        await modeSwitch.click();
        await expect(overview.locator('[data-preset-button]')).toBeVisible();
        for (let round = 0; round < ROUNDS; round += 1) {
          await openPresets();
          await record('preset working', { cards: 0 }, pressOption('working'));
          await openPresets();
          await record('preset all', { cards: THREADS }, pressOption('all'));
        }
        const search = overview.locator('[data-search-input]');
        if (!(await search.isVisible())) await overview.locator('[data-search-toggle]').click();
        await expect(search).toBeVisible();
        await search.click();
        for (let round = 0; round < ROUNDS; round += 1) {
          // The search applies after a 300 ms pause in typing; the time after it counts.
          await record('search, no match', { cards: 0 }, () => page.keyboard.press('q'), 300);
          await record(
            'search cleared',
            { cards: THREADS },
            () => page.keyboard.press('Backspace'),
            300
          );
        }
        await modeSwitch.click();
        await expect(unresolved).toBeVisible();
        await page.screenshot({ path: `${OUT_DIR}/compact-filter-${engine}.png` });

        // While agents stream: their threads are new, unresolved cards at the top.
        const load = startAgents(homeserver, seeded.roomId, seeded.poster, seeded.agents);
        await wait(5_000);
        const busy: number[] = [];
        try {
          for (let round = 0; round < ROUNDS * 2; round += 1) {
            busy.push(
              await profiled(`busy-${round}`, () =>
                timeChange(
                  page,
                  round % 2 === 0
                    ? { resolved: 0, selector: UNRESOLVED_ON }
                    : { resolved: RESOLVED, selector: UNRESOLVED_OFF },
                  clickIn(unresolved)
                )
              )
            );
            await page.mouse.move(1, 1);
            await wait(700);
          }
        } finally {
          await load.stop();
        }

        const summary = Object.fromEntries(
          Object.entries(timings).map(([name, values]) => [
            name,
            { values, median: median(values) },
          ])
        );
        const result = {
          engine,
          threads: THREADS,
          seedSeconds,
          idle: summary,
          busy: { values: busy, median: median(busy) },
        };
        // eslint-disable-next-line no-console
        console.log(`PERF ${JSON.stringify(result)}`);
        results.push(result);
        await context.close();
      } finally {
        await browser.close();
      }
    }

    writeFileSync(`${OUT_DIR}/compact-filter.json`, JSON.stringify(results, null, 1));
    for (const result of results) {
      const engine = String(result.engine);
      const idle = result.idle as Record<string, { values: number[]; median: number }>;
      for (const [name, { values, median: middle }] of Object.entries(idle)) {
        expect.soft(middle, `${engine} ${name} median (ms)`).toBeLessThanOrEqual(BUDGET_MS);
        expect
          .soft(Math.max(...values), `${engine} ${name} slowest (ms)`)
          .toBeLessThanOrEqual(BUDGET_MS * 2);
      }
      const busy = result.busy as { values: number[]; median: number };
      expect
        .soft(busy.median, `${engine} unresolved while streaming, median (ms)`)
        .toBeLessThanOrEqual(BUSY_BUDGET_MS);
    }
  });
});
