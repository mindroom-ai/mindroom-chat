import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  registerAgentAccount,
  seedRoomOverviewState,
  type MatrixSession,
} from '../helpers/matrix';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';

/**
 * Typing in a busy room while agents stream (live-test lane 6, finding L6-F002). Opt in with
 * PERF_BUSY_ROOM=1; run it on the production build (`e2e-slot.sh --preview`).
 *
 * A room holds PERF_HISTORY_THREADS (default 300) older threads. PERF_AGENTS (default 20) agent
 * accounts then stream replies in threads of their own, the way MindRoom's backend does: a
 * "Thinking..." reply, a stop reaction on it, an edit every PERF_EDIT_MS (default 1000) ms that
 * grows the text, a final edit, and the stop reaction redacted. Each agent starts a new thread as
 * soon as its reply finishes, so all of them stream at once for the whole measurement.
 *
 * While they stream, the reader types into the room's composer in the Compact view (60 ms between
 * keys) for PERF_TYPE_MS (default 20,000) ms, selecting all and deleting after each phrase. A
 * keystroke's latency runs from its keydown event to the first task after the next animation
 * frame, that is until the frame that shows it has been painted; typed characters and the select
 * all and delete commands are counted apart. Each engine (WebKit when PLAYWRIGHT_WEBKIT_EXECUTABLE
 * names it, and Chromium) is measured in its own browser; the results, a screenshot taken while
 * the agents stream, and with PERF_PROFILE=1 a CPU profile of the Chromium page, go to
 * test-results/perf/. PERF_MAX_P95_MS (default 50) is the budget the 95th percentile of typed
 * characters must meet, and no edit may move a card.
 */

const enabled = process.env.PERF_BUSY_ROOM === '1';
const HISTORY_THREADS = Number(process.env.PERF_HISTORY_THREADS ?? 300);
const AGENTS = Number(process.env.PERF_AGENTS ?? 20);
const EDIT_MS = Number(process.env.PERF_EDIT_MS ?? 1000);
const EDITS_PER_REPLY = Number(process.env.PERF_EDITS_PER_REPLY ?? 30);
const TYPE_MS = Number(process.env.PERF_TYPE_MS ?? 20_000);
const MAX_P95_MS = Number(process.env.PERF_MAX_P95_MS ?? 50);
const CPU_THROTTLE = Number(process.env.PERF_CPU_THROTTLE ?? 1);
const PROFILE = process.env.PERF_PROFILE === '1';
const ENGINES = (process.env.PERF_ENGINES ?? 'webkit,chromium').split(',');
const OUT_DIR = 'test-results/perf';
const THREAD_ROOT_WARNING =
  'Event is not a relation or a thread root, but still has a threadRootId';

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

const redact = async (
  homeserver: string,
  session: MatrixSession,
  roomId: string,
  eventId: string
): Promise<void> => {
  await matrixFetch(
    homeserver,
    `/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}/${randomUUID()}`,
    {
      method: 'PUT',
      accessToken: session.accessToken,
      body: JSON.stringify({ reason: 'Reply removed' }),
    }
  );
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

type Load = { stop: () => Promise<void>; counts: { roots: number; edits: number } };

/** Every agent streams replies in new threads, one after the other, until `stop`. */
const startAgents = (
  homeserver: string,
  roomId: string,
  poster: MatrixSession,
  agents: MatrixSession[]
): Load => {
  let running = true;
  const counts = { roots: 0, edits: 0 };
  const stream = async (agent: MatrixSession, index: number) => {
    // Agents start a little apart, as replies to one burst of prompts do.
    await wait((index * EDIT_MS) / agents.length);
    for (let round = 1; running; round += 1) {
      const name = `A${String(index + 1).padStart(2, '0')}`;
      const rootId = await send(homeserver, poster, roomId, 'm.room.message', {
        msgtype: 'm.text',
        body: `${name}: Round ${round} question for ${name} #slow`,
        'm.mentions': { user_ids: [agent.userId] },
      });
      counts.roots += 1;
      const replyId = await send(homeserver, agent, roomId, 'm.room.message', {
        msgtype: 'm.text',
        body: 'Thinking...',
        format: 'org.matrix.custom.html',
        formatted_body: '<p>Thinking...</p>\n',
        'io.mindroom.stream_status': 'pending',
        'm.relates_to': threadRelation(rootId, rootId, false),
      });
      const stopId = await send(homeserver, agent, roomId, 'm.reaction', {
        'm.relates_to': { rel_type: 'm.annotation', event_id: replyId, key: '🛑' },
      });
      const words: string[] = [];
      for (let edit = 1; edit <= EDITS_PER_REPLY && running; edit += 1) {
        await wait(EDIT_MS);
        words.push(...Array.from({ length: 4 }, (_, word) => `word${words.length + word + 1}`));
        const last = edit === EDITS_PER_REPLY;
        const text = words.join(' ');
        const content = {
          msgtype: 'm.notice',
          body: text,
          format: 'org.matrix.custom.html',
          formatted_body: `<p>${text}</p>\n`,
          'io.mindroom.stream_status': last ? 'completed' : 'streaming',
        };
        await send(homeserver, agent, roomId, 'm.room.message', {
          ...content,
          body: `* ${text}`,
          'm.new_content': content,
          'm.relates_to': { rel_type: 'm.replace', event_id: replyId },
        });
        counts.edits += 1;
      }
      await redact(homeserver, agent, roomId, stopId);
    }
  };
  const done = Promise.all(agents.map((agent, index) => stream(agent, index)));
  return {
    counts,
    stop: async () => {
      running = false;
      await done;
    },
  };
};

/** Installed before the app: keystroke latencies, long tasks and slow frames. */
const instrument = () => {
  const state = {
    inputLat: [] as number[],
    commandLat: [] as number[],
    longTasks: [] as number[],
    frames: 0,
    slowFrames: 0,
    last: 0,
  };
  (window as unknown as { __busyRoom: typeof state }).__busyRoom = state;
  try {
    new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => state.longTasks.push(Math.round(entry.duration)));
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // WebKit has no long task entries.
  }
  document.addEventListener(
    'keydown',
    (event) => {
      const start = event.timeStamp;
      // A typed character, or an editing command (select all, delete) of the probe's cycle.
      const typed = event.key.length === 1 && !event.ctrlKey && !event.metaKey;
      const samples = typed ? state.inputLat : state.commandLat;
      requestAnimationFrame(() => {
        setTimeout(() => samples.push(performance.now() - start), 0);
      });
    },
    true
  );
  const tick = (now: number) => {
    if (state.last) {
      state.frames += 1;
      if (now - state.last > 50) state.slowFrames += 1;
    }
    state.last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

type PageStats = {
  inputLat: number[];
  commandLat: number[];
  longTasks: number[];
  frames: number;
  slowFrames: number;
};

const readStats = (page: Page): Promise<PageStats> =>
  page.evaluate(() => {
    const state = (window as unknown as { __busyRoom: PageStats & { last: number } }).__busyRoom;
    const stats = { ...state };
    state.inputLat = [];
    state.commandLat = [];
    state.longTasks = [];
    state.frames = 0;
    state.slowFrames = 0;
    return stats;
  });

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, index)] ?? Number.NaN);
};

// A trace snapshots the whole page at every action, which would cost more than the page does.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test.describe('busy room typing', () => {
  test.skip(!enabled, 'PERF_BUSY_ROOM=1 not set');
  test.setTimeout(30 * 60_000);

  test('typing stays responsive in the Compact view while agents stream', async ({ baseURL }) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const reader = await loginToMatrix(homeserver, username, password);
    // A person, not an agent: the prompts come from someone other than the reader.
    const poster = await matrixFetch<{ access_token: string; user_id: string }>(
      homeserver,
      '/register',
      {
        method: 'POST',
        body: JSON.stringify({
          username: `busy-room-poster-${randomUUID().slice(0, 8)}`,
          password: randomUUID(),
          auth: { type: 'm.login.dummy' },
        }),
      }
    ).then((body): MatrixSession => ({ accessToken: body.access_token, userId: body.user_id }));
    const agents = await Promise.all(
      Array.from({ length: AGENTS }, (_, index) =>
        registerAgentAccount(homeserver, `a${String(index + 1).padStart(2, '0')}`)
      )
    );
    const roomName = `Busy room ${Date.now()}`;
    const roomId = await createPrivateRoom(homeserver, poster.accessToken, {
      name: roomName,
      topic: 'Agents stream replies here while the reader types.',
      invite: [reader.userId, ...agents.map((agent) => agent.userId)],
    });
    await Promise.all(
      [reader, ...agents].map((session) => joinRoom(homeserver, session.accessToken, roomId))
    );

    const seedStart = Date.now();
    await pool(
      Array.from({ length: HISTORY_THREADS }, (_, index) => index),
      12,
      async (index) => {
        const author = index % 3 === 0 ? reader : poster;
        const rootId = await send(homeserver, author, roomId, 'm.room.message', {
          msgtype: 'm.notice',
          body: `History thread ${index}: release notes, deploy window and the budget review #${index}`,
        });
        let last = rootId;
        for (let reply = 0; reply < 1 + (index % 4); reply += 1) {
          const replier = (index + reply) % 2 === 0 ? poster : reader;
          last = await send(homeserver, replier, roomId, 'm.room.message', {
            msgtype: 'm.notice',
            body: `Reply ${
              reply + 1
            } in history thread ${index}, with enough words to fill a line.`,
            'm.relates_to': threadRelation(rootId, last, true),
          });
        }
      }
    );
    const seedSeconds = Math.round((Date.now() - seedStart) / 1000);

    mkdirSync(OUT_DIR, { recursive: true });
    const results: Record<string, unknown>[] = [];
    const launchers: Record<string, () => Promise<Browser>> = {
      webkit: launchWebKit,
      chromium: () =>
        chromium.launch({
          executablePath: process.env.CHROMIUM_PATH || undefined,
          args: ['--disable-features=IsolateSandboxedIframes'],
        }),
    };
    const engines = ENGINES.filter((engine) => engine !== 'webkit' || !!WEBKIT_EXECUTABLE);

    for (const engine of engines) {
      const launch = launchers[engine];
      if (!launch) throw new Error(`Unknown engine ${engine}`);
      const browser = await launch();
      try {
        const context = await browser.newContext({
          baseURL,
          viewport: { width: 1440, height: 900 },
          locale: 'en-US',
        });
        await context.addInitScript(instrument);
        const page = await context.newPage();
        let threadRootWarnings = 0;
        page.on('console', (message) => {
          if (message.text().includes(THREAD_ROOT_WARNING)) threadRootWarnings += 1;
        });
        // Syncs, and those whose timeline for the room had a gap ("limited"): the client then
        // drops the room's loaded timeline and builds its state again.
        const syncs = { all: 0, limited: 0 };
        page.on('response', (response) => {
          if (!/\/_matrix\/client\/v3\/sync\b/.test(response.url()) || response.status() !== 200)
            return;
          response
            .json()
            .then(
              (body: {
                rooms?: { join?: Record<string, { timeline?: { limited?: boolean } }> };
              }) => {
                syncs.all += 1;
                if (body.rooms?.join?.[roomId]?.timeline?.limited) syncs.limited += 1;
              }
            )
            .catch(() => undefined);
        });
        await loginWithPassword(page, { homeserver, username, password });
        await seedRoomOverviewState({
          page,
          roomId,
          userId: reader.userId,
          viewMode: 'compact',
          filterState: createDefaultThreadFilterState(),
        });
        await page.goto(`/home/${encodeURIComponent(roomId)}`);
        const view = page.locator('[data-compact-room-view="true"]');
        await expect(view).toBeVisible({ timeout: 120_000 });
        await expect
          .poll(() => view.locator('[data-thread-root-id]').count(), { timeout: 180_000 })
          .toBeGreaterThanOrEqual(HISTORY_THREADS);
        const composer = page.getByRole('textbox', { name: 'Send a message...' });
        await composer.click();

        const cdp = engine === 'chromium' ? await context.newCDPSession(page) : undefined;
        if (cdp && CPU_THROTTLE > 1) {
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
        }

        // Idle typing first: what the page costs without the agents.
        await readStats(page);
        const idleEnd = Date.now() + 5_000;
        while (Date.now() < idleEnd) {
          await page.keyboard.type('idle typing probe ', { delay: 60 });
          await page.keyboard.press('ControlOrMeta+A');
          await page.keyboard.press('Backspace');
        }
        const idle = await readStats(page);

        const load = startAgents(homeserver, roomId, poster, agents);
        threadRootWarnings = 0;
        // Let every agent reach its stream before measuring.
        await wait(Math.max(5_000, EDIT_MS * 3));
        await readStats(page);
        await page.evaluate(() => {
          const list = document.querySelector('[data-compact-room-view="true"]');
          const counts = { inserted: 0 };
          (window as unknown as { __cardInserts: typeof counts }).__cardInserts = counts;
          new MutationObserver((records) => {
            records.forEach((record) =>
              record.addedNodes.forEach((node) => {
                if (node instanceof HTMLElement && node.hasAttribute('data-scroll-anchor')) {
                  counts.inserted += 1;
                }
              })
            );
          }).observe(list ?? document.body, { childList: true, subtree: true });
        });
        const syncsBefore = { ...syncs };
        const editsBefore = load.counts.edits;
        const rootsBefore = load.counts.roots;
        if (cdp && PROFILE) {
          await cdp.send('Profiler.enable');
          await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
          await cdp.send('Profiler.start');
        }
        const typeStart = Date.now();
        let cycles = 0;
        while (Date.now() < typeStart + TYPE_MS) {
          await page.keyboard.type('load test typing probe ', { delay: 60 });
          await page.keyboard.press('ControlOrMeta+A');
          await page.keyboard.press('Backspace');
          cycles += 1;
        }
        const typedMs = Date.now() - typeStart;
        const busy = await readStats(page);
        if (cdp && PROFILE) {
          const { profile } = await cdp.send('Profiler.stop');
          writeFileSync(`${OUT_DIR}/busy-room-${engine}.cpuprofile`, JSON.stringify(profile));
        }
        // What the reader sees while the agents stream (test data only).
        await page.screenshot({ path: `${OUT_DIR}/busy-room-${engine}.png` });
        const edits = load.counts.edits - editsBefore;
        const cardInserts = await page.evaluate(
          () =>
            (window as unknown as { __cardInserts: { inserted: number } }).__cardInserts.inserted
        );
        await load.stop();
        const cards = await view.locator('[data-thread-root-id]').count();

        const result = {
          engine,
          cpuThrottle: engine === 'chromium' ? CPU_THROTTLE : 1,
          historyThreads: HISTORY_THREADS,
          agents: AGENTS,
          editMs: EDIT_MS,
          seedSeconds,
          cards,
          idle: {
            samples: idle.inputLat.length,
            p50: percentile(idle.inputLat, 50),
            p95: percentile(idle.inputLat, 95),
          },
          busy: {
            samples: busy.inputLat.length,
            p50: percentile(busy.inputLat, 50),
            p95: percentile(busy.inputLat, 95),
            max: percentile(busy.inputLat, 100),
            commands: {
              samples: busy.commandLat.length,
              p50: percentile(busy.commandLat, 50),
              p95: percentile(busy.commandLat, 95),
            },
            cycles,
            editsPerSecond: Math.round((edits / typedMs) * 10_000) / 10,
            longTaskMs: busy.longTasks.reduce((sum, value) => sum + value, 0),
            slowFrames: busy.slowFrames,
            frames: busy.frames,
            syncs: syncs.all - syncsBefore.all,
            limitedSyncs: syncs.limited - syncsBefore.limited,
            // Cards put into the list: new threads, and cards React moved to a new place.
            cardInserts,
            newThreads: load.counts.roots - rootsBefore,
          },
          threadRootWarnings,
        };
        // eslint-disable-next-line no-console
        console.log(`PERF ${JSON.stringify(result)}`);
        results.push(result);
        await context.close();
      } finally {
        await browser.close();
      }
    }

    writeFileSync(`${OUT_DIR}/busy-room.json`, JSON.stringify(results, null, 1));
    for (const result of results) {
      const engine = String(result.engine);
      const busy = result.busy as {
        p95: number;
        samples: number;
        cardInserts: number;
        newThreads: number;
      };
      // Work per edit: an edit changes its card in place, so only new threads add cards (one
      // posted as the measurement ends may show after it).
      expect(busy.cardInserts, `${engine} cards moved or added`).toBeLessThanOrEqual(
        busy.newThreads + 1
      );
      expect(busy.samples, `${engine} keystrokes`).toBeGreaterThan(50);
      expect(busy.p95, `${engine} typed character p95 (ms)`).toBeLessThanOrEqual(MAX_P95_MS);
    }
  });
});
