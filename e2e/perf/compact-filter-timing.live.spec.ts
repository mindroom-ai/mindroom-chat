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
import { showResolvedThreads } from '../helpers/threadOverview';
import { CHROMIUM_WITH_SCROLLBARS } from '../helpers/disposableAccounts';

/**
 * Filtering a big Compact list (live-test lane 6, finding L6-F020): a filter change must show its
 * result within 100 ms.
 *
 * A room holds FILTER_THREADS (default 600) threads, each a root and one reply; every fourth one
 * is resolved. The reader opens it in the Compact view among 24 other rooms and changes the
 * filters: the simple Unresolved toggle on and off, the switch to the advanced filters and back,
 * the Working and All presets, and a search (a letter no thread has, then Backspace). Each
 * change is timed from its press or keydown to the first frame after the count and the list's
 * first screenful show its result, that is until that frame has been painted (the next task
 * after it); the search's 300 ms pause in typing is not counted. Every change runs FILTER_ROUNDS
 * (default 3) times; the median of each must stay within FILTER_BUDGET_MS (default 100) and no
 * single run above twice that. The rest of the list must follow within FILTER_COMPLETE_BUDGET_MS
 * (default 1000), and in Chromium no task between the press and the whole list may take longer
 * than FILTER_BUDGET_MS.
 *
 * Then, once every engine has had its idle run, FILTER_AGENTS (default 8) agents stream replies
 * in threads of their own, an edit a second each, and the Unresolved toggle is timed again on each
 * engine's page: its median while they stream must stay within FILTER_BUSY_BUDGET_MS (default
 * 150).
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
const COMPLETE_BUDGET_MS = Number(process.env.FILTER_COMPLETE_BUDGET_MS ?? 1000);
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
      for (let edit = 1; edit <= 12; edit += 1) {
        // A stop ends the reply with its final edit, so no thread stays streaming afterwards.
        const last = edit === 12 || !running;
        if (running) await wait(1000);
        words.push(...Array.from({ length: 4 }, (_u, word) => `word${words.length + word + 1}`));
        const content = {
          msgtype: 'm.notice',
          body: words.join(' '),
          'io.mindroom.stream_status': last ? 'completed' : 'streaming',
        };
        await send(homeserver, agent, roomId, 'm.room.message', {
          ...content,
          body: `* ${content.body}`,
          'm.new_content': content,
          'm.relates_to': { rel_type: 'm.replace', event_id: replyId },
        });
        if (last) break;
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

/**
 * What a timed change must show. `first`: the list starts with these cards (a screenful) and the
 * count says `count`; the change counts as shown then. `count` alone: the list holds that many
 * cards. `resolved`, `resolvedAtLeast`: resolved cards in the list. `selector`: an element there.
 */
type Expect = {
  first?: string[];
  count?: number;
  resolved?: number;
  resolvedAtLeast?: number;
  selector?: string;
};
type Timing = { shown?: number; complete?: number; longestTask?: number; error?: string };

/**
 * Installed before the app. `arm(expect)` starts a timing at the next press or keydown: `shown`
 * when the frame after the list shows `expect` has been painted (the next task after it),
 * `complete` when the list holds all `expect.count` cards, and the longest task in between
 * (Chromium only).
 */
const instrument = () => {
  const state: { timing?: Timing } = {};
  const longTasks: { start: number; duration: number }[] = [];
  try {
    new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        longTasks.push({ start: entry.startTime, duration: entry.duration });
      });
    }).observe({ type: 'longtask', buffered: false });
  } catch {
    // WebKit has no long task entries.
  }
  const cardIds = () =>
    [...document.querySelectorAll('[data-compact-room-view="true"] [data-thread-root-id]')].map(
      (card) => card.getAttribute('data-thread-root-id') ?? ''
    );
  const resolved = () =>
    document.querySelectorAll(
      '[data-compact-room-view="true"] [data-thread-root-id][data-attention-state="resolved"]'
    ).length;
  const counted = () =>
    Number(
      document.querySelector('[data-room-thread-overview] [data-thread-count]')?.textContent?.trim()
    );
  const arm = (expected: Expect) => {
    const timing: Timing = {};
    state.timing = timing;
    const shownNow = () => {
      const ids = cardIds();
      if (expected.first && expected.first.some((id, index) => ids[index] !== id)) return false;
      if (expected.count !== undefined && counted() !== expected.count) return false;
      if (expected.count === 0 && ids.length > 0) return false;
      if (expected.resolved !== undefined && resolved() !== expected.resolved) return false;
      if (expected.resolvedAtLeast !== undefined && resolved() < expected.resolvedAtLeast)
        return false;
      if (expected.selector !== undefined && !document.querySelector(expected.selector))
        return false;
      return true;
    };
    const completeNow = () =>
      expected.count === undefined ? true : cardIds().length === expected.count;
    const start = () => {
      document.removeEventListener('pointerdown', start, true);
      document.removeEventListener('keydown', start, true);
      // Not the event's timeStamp: WebKit stamps synthesized pointer events from another clock.
      const startedAt = performance.now();
      let shownSeen = false;
      const finish = () => {
        timing.complete = performance.now() - startedAt;
        timing.longestTask = Math.round(
          Math.max(
            0,
            ...longTasks
              .filter((task) => task.start + task.duration >= startedAt)
              .map((task) => task.duration)
          )
        );
      };
      const check = () => {
        if (performance.now() - startedAt > 15_000) {
          timing.error = `${
            cardIds().length
          } cards (${resolved()} resolved), count ${counted()}; expected ${JSON.stringify({
            ...expected,
            first: expected.first?.length,
          })}`;
          return;
        }
        if (!shownSeen && shownNow()) {
          shownSeen = true;
          // The frame that shows the result is painted before the next task runs.
          setTimeout(() => {
            timing.shown = performance.now() - startedAt;
          }, 0);
        }
        if (shownSeen && completeNow()) {
          // Long tasks are reported after they end; read them a moment later.
          setTimeout(finish, 50);
          return;
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    };
    // The press, not the click: a preset option acts on its press and is gone before a click.
    document.addEventListener('pointerdown', start, true);
    document.addEventListener('keydown', start, true);
  };
  (window as unknown as { __filterTiming: unknown }).__filterTiming = { state, arm };
};

type FilterTiming = { state: { timing?: Timing }; arm: (expected: Expect) => void };

/** Times `act`, which must leave the list showing `expected`. */
const timeChange = async (
  page: Page,
  expected: Expect,
  act: () => Promise<void>
): Promise<Required<Omit<Timing, 'error'>>> => {
  await page.evaluate((value) => {
    (window as unknown as { __filterTiming: FilterTiming }).__filterTiming.arm(value);
  }, expected);
  await act();
  const handle = await page.waitForFunction(
    () => {
      const { timing } = (window as unknown as { __filterTiming: FilterTiming }).__filterTiming
        .state;
      if (timing?.error) return timing;
      return timing?.complete === undefined || timing.shown === undefined ? false : timing;
    },
    undefined,
    { timeout: 20_000, polling: 100 }
  );
  const result = (await handle.jsonValue()) as Timing;
  if (result.error !== undefined) throw new Error(result.error);
  return {
    shown: Math.round(result.shown ?? Number.NaN),
    complete: Math.round(result.complete ?? Number.NaN),
    longestTask: result.longestTask ?? 0,
  };
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
      chromium: () => chromium.launch(CHROMIUM_WITH_SCROLLBARS),
    };
    const engines = ENGINES.filter((engine) => engine !== 'webkit' || !!WEBKIT_EXECUTABLE);
    const results: Record<string, unknown>[] = [];
    const browsers: Browser[] = [];
    // Each engine's page is timed again while the agents stream, once every engine has had its
    // idle run: a client that starts after the agents ran would see other threads.
    const busyRuns: { result: Record<string, unknown>; measure: () => Promise<number[]> }[] = [];

    try {
      for (const engine of engines) {
        const launch = launchers[engine];
        if (!launch) throw new Error(`Unknown engine ${engine}`);
        const browser = await launch();
        browsers.push(browser);
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
        const total = THREADS;
        await expect(view).toBeVisible({ timeout: 120_000 });
        // Compact opens with resolved threads hidden; the timing starts with every thread shown.
        await showResolvedThreads(page);
        await expect
          .poll(() => cards.count(), { timeout: 180_000, message: 'all threads listed' })
          .toBe(total);
        const overview = page.locator('[data-room-thread-overview]');
        const count = overview.locator('[data-thread-count]');
        // The count reads N+ until the room's thread list has paged to its end.
        await expect(count).toHaveText(String(total), { timeout: 120_000 });
        // The seeded filter state opens the advanced filters; the timing starts simple.
        const modeSwitchButton = overview.locator('[data-thread-filter-mode-switch]');
        if ((await modeSwitchButton.getAttribute('aria-pressed')) === 'true') {
          await modeSwitchButton.click();
        }
        await expect(overview.locator('[data-simple-unresolved-toggle]')).toBeVisible();
        await page.mouse.move(1, 1);
        // Let the list settle (cache writes, receipts) before timing it.
        await wait(3_000);
        // The list's order, and which of its threads are resolved: what each change must show.
        const order = await cards.evaluateAll((elements) =>
          elements.map((element) => ({
            id: element.getAttribute('data-thread-root-id') ?? '',
            resolved: element.getAttribute('data-attention-state') === 'resolved',
          }))
        );
        expect(order.filter((card) => card.resolved)).toHaveLength(RESOLVED);
        const everyThread = order.map((card) => card.id);
        const unresolvedThreads = order.filter((card) => !card.resolved).map((card) => card.id);
        // A screenful of cards at 1280x800 is about eight.
        const showing = (ids: string[]): Expect => ({ first: ids.slice(0, 10), count: ids.length });

        const cdp = engine === 'chromium' && PROFILE ? await context.newCDPSession(page) : null;
        const profiled = async <T>(name: string, run: () => Promise<T>) => {
          if (!cdp) return run();
          await cdp.send('Profiler.enable');
          await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
          await cdp.send('Profiler.start');
          const result = await run();
          const { profile } = await cdp.send('Profiler.stop');
          writeFileSync(
            `${OUT_DIR}/compact-filter-${engine}-${name}.cpuprofile`,
            JSON.stringify(profile)
          );
          return result;
        };

        const unresolved = overview.locator('[data-simple-unresolved-toggle]');
        const modeSwitch = overview.locator('[data-thread-filter-mode-switch]');
        const timings: Record<
          string,
          { shown: number[]; complete: number[]; longestTask: number[] }
        > = {};
        const record = async (
          name: string,
          expected: Expect,
          act: () => Promise<void>,
          pauseMs = 0
        ) => {
          const entry = (timings[name] ??= { shown: [], complete: [], longestTask: [] });
          const label = `${name.replace(/\W+/g, '-')}-${entry.shown.length}`;
          const timing = await profiled(label, () => timeChange(page, expected, act));
          entry.shown.push(timing.shown - pauseMs);
          entry.complete.push(timing.complete - pauseMs);
          entry.longestTask.push(timing.longestTask);
          await page.mouse.move(1, 1);
          await wait(500);
        };
        const clickIn = (locator: Locator) => () => locator.click();
        // A preset is chosen with the keyboard (the list's own keys), in both engines alike.
        const PRESET_POSITIONS = { working: 1, all: 4 };
        const openPreset = async (id: keyof typeof PRESET_POSITIONS) => {
          await overview.locator('[data-preset-button]').click();
          await expect(overview.locator('[data-preset-option="all"]')).toBeVisible();
          for (let step = 0; step < PRESET_POSITIONS[id]; step += 1) {
            await page.keyboard.press('ArrowDown');
          }
          await expect(overview.locator(`[data-preset-option="${id}"]`)).toBeFocused();
        };
        const choose = () => page.keyboard.press('Enter');

        for (let round = 0; round < ROUNDS; round += 1) {
          await record(
            'unresolved on',
            { ...showing(unresolvedThreads), resolved: 0, selector: UNRESOLVED_ON },
            clickIn(unresolved)
          );
          await record(
            'unresolved off',
            { ...showing(everyThread), selector: UNRESOLVED_OFF },
            clickIn(unresolved)
          );
        }
        for (let round = 0; round < ROUNDS; round += 1) {
          await record(
            'advanced filters',
            {
              ...showing(everyThread),
              selector: '[data-room-thread-overview] [data-preset-button]',
            },
            clickIn(modeSwitch)
          );
          await record(
            'simple filters',
            { ...showing(everyThread), selector: UNRESOLVED_OFF },
            clickIn(modeSwitch)
          );
        }
        await modeSwitch.click();
        await expect(overview.locator('[data-preset-button]')).toBeVisible();
        for (let round = 0; round < ROUNDS; round += 1) {
          await openPreset('working');
          await record('preset working', showing([]), choose);
          await openPreset('all');
          await record('preset all', showing(everyThread), choose);
        }
        const search = overview.locator('[data-search-input]');
        if (!(await search.isVisible())) await overview.locator('[data-search-toggle]').click();
        await expect(search).toBeVisible();
        await search.click();
        for (let round = 0; round < ROUNDS; round += 1) {
          // The search applies after a 300 ms pause in typing; the time after it counts.
          await record('search, no match', showing([]), () => page.keyboard.press('q'), 300);
          await record(
            'search cleared',
            showing(everyThread),
            () => page.keyboard.press('Backspace'),
            300
          );
        }
        await modeSwitch.click();
        await expect(unresolved).toBeVisible();
        await page.screenshot({ path: `${OUT_DIR}/compact-filter-${engine}.png` });

        const summary = Object.fromEntries(
          Object.entries(timings).map(([name, entry]) => [
            name,
            {
              shown: entry.shown,
              median: median(entry.shown),
              complete: entry.complete,
              longestTask: entry.longestTask,
            },
          ])
        );
        const result: Record<string, unknown> = {
          engine,
          threads: total,
          seedSeconds,
          idle: summary,
        };
        results.push(result);
        busyRuns.push({
          result,
          // Their threads are new, unresolved cards at the top, so resolved ones show again
          // within the first screenful.
          measure: async () => {
            const busy: number[] = [];
            for (let round = 0; round < ROUNDS * 2; round += 1) {
              const timing = await profiled(`busy-${round}`, () =>
                timeChange(
                  page,
                  round % 2 === 0
                    ? { resolved: 0, selector: UNRESOLVED_ON }
                    : { resolvedAtLeast: 1, selector: UNRESOLVED_OFF },
                  clickIn(unresolved)
                )
              );
              busy.push(timing.shown);
              await page.mouse.move(1, 1);
              await wait(700);
            }
            return busy;
          },
        });
      }

      const load = startAgents(homeserver, seeded.roomId, seeded.poster, seeded.agents);
      try {
        await wait(5_000);
        for (const run of busyRuns) {
          const busy = await run.measure();
          run.result.busy = { values: busy, median: median(busy) };
          // eslint-disable-next-line no-console
          console.log(`PERF ${JSON.stringify(run.result)}`);
        }
      } finally {
        await load.stop();
      }
    } finally {
      await Promise.all(browsers.map((browser) => browser.close()));
    }

    writeFileSync(`${OUT_DIR}/compact-filter.json`, JSON.stringify(results, null, 1));
    for (const result of results) {
      const engine = String(result.engine);
      const idle = result.idle as Record<
        string,
        { shown: number[]; median: number; complete: number[]; longestTask: number[] }
      >;
      for (const [name, entry] of Object.entries(idle)) {
        expect
          .soft(entry.median, `${engine} ${name}: shown, median (ms)`)
          .toBeLessThanOrEqual(BUDGET_MS);
        expect
          .soft(Math.max(...entry.shown), `${engine} ${name}: shown, slowest (ms)`)
          .toBeLessThanOrEqual(BUDGET_MS * 2);
        // The rest of the list follows without blocking the page for long (Chromium reports it).
        expect
          .soft(Math.max(...entry.longestTask), `${engine} ${name}: longest task (ms)`)
          .toBeLessThanOrEqual(BUDGET_MS);
        expect
          .soft(Math.max(...entry.complete), `${engine} ${name}: every card listed (ms)`)
          .toBeLessThanOrEqual(COMPLETE_BUDGET_MS);
      }
      const busy = result.busy as { values: number[]; median: number };
      expect
        .soft(busy.median, `${engine} unresolved while streaming, median (ms)`)
        .toBeLessThanOrEqual(BUSY_BUDGET_MS);
    }
  });
});
