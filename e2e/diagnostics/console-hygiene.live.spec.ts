import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium, expect, test, type Browser } from '@playwright/test';
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
 * Console hygiene over a realistic session (live-test lane 9, finding L9-F007). The reader has
 * SIDE_ROOMS more rooms in the sidebar, and a room holds HISTORY_THREADS threads, half of them
 * answered by agents the way MindRoom's backend streams (a stop reaction, edits, the stop reaction
 * redacted). The reader opens it in the Compact view while agents stream new answers, reloads,
 * opens a thread while an agent streams into it, and goes back. No warning "Event is not a
 * relation or a thread root, but still has a threadRootId!" may appear, no event may be refused
 * by a timeline ("cannot be added to any timeline", live-test pass 2, P2-lane9-F003), and no
 * emitter may report a listener leak.
 *
 * Each engine (Chromium, and WebKit when PLAYWRIGHT_WEBKIT_EXECUTABLE names it) runs the session
 * in its own browser. The warnings' call sites go to test-results/console-hygiene/.
 */

const OUT_DIR = 'test-results/console-hygiene';
const HISTORY_THREADS = 60;
/** Other rooms of the reader's, so the sidebar holds as many rows as an active account's. */
const SIDE_ROOMS = 25;
const THREAD_ROOT_WARNING = 'still has a threadRootId';
const NO_TIMELINE_WARNING = /cannot be added to any timeline|that does not belong in timeline/;
const LISTENER_LEAK_WARNING = /memory leak detected|MaxListenersExceeded/;

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
    { method: 'PUT', accessToken: session.accessToken, body: JSON.stringify({}) }
  );
};

const threadRelation = (rootId: string, replyTo: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: replyTo },
});

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * An agent's reply the way MindRoom's backend streams it: "Thinking...", a stop reaction on it,
 * edits that grow the text, a final edit, and the stop reaction redacted.
 */
const streamAgentReply = async (
  homeserver: string,
  agent: MatrixSession,
  roomId: string,
  rootId: string,
  edits: number,
  editMs: number
): Promise<void> => {
  const replyId = await send(homeserver, agent, roomId, 'm.room.message', {
    msgtype: 'm.text',
    body: 'Thinking...',
    'io.mindroom.stream_status': 'pending',
    'm.relates_to': threadRelation(rootId, rootId),
  });
  const stopId = await send(homeserver, agent, roomId, 'm.reaction', {
    'm.relates_to': { rel_type: 'm.annotation', event_id: replyId, key: '🛑' },
  });
  const words: string[] = [];
  for (let edit = 1; edit <= edits; edit += 1) {
    if (editMs > 0) await wait(editMs);
    words.push(`step${edit}`, 'checked', 'the', 'deploy', 'notes');
    const text = words.join(' ');
    const content = {
      msgtype: 'm.text',
      body: text,
      'io.mindroom.stream_status': edit === edits ? 'completed' : 'streaming',
    };
    await send(homeserver, agent, roomId, 'm.room.message', {
      ...content,
      body: `* ${text}`,
      'm.new_content': content,
      'm.relates_to': { rel_type: 'm.replace', event_id: replyId },
    });
  }
  await redact(homeserver, agent, roomId, stopId);
};

/** Installed before the app: keeps one stack per call site of the warnings. */
const recordWarningSites = () => {
  const sites: Record<string, number> = {};
  (window as unknown as { __warningSites: typeof sites }).__warningSites = sites;
  const original = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    const text = args
      .map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : String(arg)))
      .join(' ');
    if (
      text.includes('still has a threadRootId') ||
      /memory leak detected|cannot be added to any timeline|does not belong in timeline/.test(text)
    ) {
      const limit = Error.stackTraceLimit;
      Error.stackTraceLimit = 40;
      const stack = (new Error().stack ?? '').split('\n').slice(2).join('\n');
      Error.stackTraceLimit = limit;
      const site = `${text.replace(/\$[\w-]+/g, '$id').slice(0, 160)}\n${stack}`;
      sites[site] = (sites[site] ?? 0) + 1;
    }
    original(...args);
  };
};

test.use({ trace: 'off', video: 'off' });

test.describe('console hygiene', () => {
  test.skip(!process.env.E2E_USERNAME, 'E2E_USERNAME / E2E_PASSWORD not set');
  test.setTimeout(15 * 60_000);

  test('a session with streaming agents repeats no warning and leaks no listener', async ({
    baseURL,
  }) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const reader = await loginToMatrix(homeserver, username, password);
    const poster = await matrixFetch<{ access_token: string; user_id: string }>(
      homeserver,
      '/register',
      {
        method: 'POST',
        body: JSON.stringify({
          username: `hygiene-poster-${randomUUID().slice(0, 8)}`,
          password: randomUUID(),
          auth: { type: 'm.login.dummy' },
        }),
      }
    ).then((body): MatrixSession => ({ accessToken: body.access_token, userId: body.user_id }));
    const agents = await Promise.all([
      registerAgentAccount(homeserver, 'helper'),
      registerAgentAccount(homeserver, 'writer'),
    ]);
    const roomId = await createPrivateRoom(homeserver, poster.accessToken, {
      name: `Console hygiene ${Date.now()}`,
      topic: 'Agents answer in threads here.',
      invite: [reader.userId, ...agents.map((agent) => agent.userId)],
    });
    await Promise.all(
      [reader, ...agents].map((session) => joinRoom(homeserver, session.accessToken, roomId))
    );
    await Promise.all(
      Array.from({ length: SIDE_ROOMS }, (_, index) =>
        createPrivateRoom(homeserver, reader.accessToken, {
          name: `Side room ${index + 1}`,
          topic: 'Another room of the reader.',
        })
      )
    );

    // History: agent threads streamed to the end, and threads between people.
    const roots: string[] = [];
    for (let index = 0; index < HISTORY_THREADS; index += 1) {
      const author = index % 3 === 0 ? reader : poster;
      const rootId = await send(homeserver, author, roomId, 'm.room.message', {
        msgtype: 'm.text',
        body: `Question ${index}: what changed in the deploy notes for release ${index}?`,
      });
      roots.push(rootId);
      const agent = agents[index % agents.length];
      if (index % 2 === 0 && agent) {
        await streamAgentReply(homeserver, agent, roomId, rootId, 3, 0);
      } else {
        const first = await send(homeserver, poster, roomId, 'm.room.message', {
          msgtype: 'm.text',
          body: `Reply in thread ${index} with enough words to fill a line of the card.`,
          'm.relates_to': threadRelation(rootId, rootId),
        });
        await send(homeserver, reader, roomId, 'm.room.message', {
          msgtype: 'm.text',
          body: `Second reply in thread ${index}.`,
          'm.relates_to': threadRelation(rootId, first),
        });
      }
    }

    mkdirSync(OUT_DIR, { recursive: true });
    const launchers: Record<string, () => Promise<Browser>> = {
      chromium: () =>
        chromium.launch({
          executablePath: process.env.CHROMIUM_PATH || undefined,
          args: ['--disable-features=IsolateSandboxedIframes'],
        }),
      webkit: launchWebKit,
    };
    const engines = ['chromium', ...(WEBKIT_EXECUTABLE ? ['webkit'] : [])];
    const results: Record<
      string,
      Record<string, { threadRootId: number; noTimeline: number; listenerLeak: number }>
    > = {};

    for (const engine of engines) {
      const launch = launchers[engine];
      if (!launch) throw new Error(`Unknown engine ${engine}`);
      const browser = await launch();
      const sitesFile = `${OUT_DIR}/${engine}-sites.txt`;
      writeFileSync(sitesFile, '');
      try {
        const context = await browser.newContext({
          baseURL,
          viewport: { width: 1440, height: 900 },
          locale: 'en-US',
        });
        await context.addInitScript(recordWarningSites);
        const page = await context.newPage();
        const counts = { threadRootId: 0, noTimeline: 0, listenerLeak: 0 };
        page.on('console', (message) => {
          const text = message.text();
          if (text.includes(THREAD_ROOT_WARNING)) counts.threadRootId += 1;
          else if (NO_TIMELINE_WARNING.test(text)) counts.noTimeline += 1;
          else if (LISTENER_LEAK_WARNING.test(text)) counts.listenerLeak += 1;
        });
        const phases: Record<
          string,
          { threadRootId: number; noTimeline: number; listenerLeak: number }
        > = {};
        // The page's call sites, kept before it navigates away.
        const keepSites = async (phase: string) => {
          const sites = await page.evaluate(
            () => (window as unknown as { __warningSites?: Record<string, number> }).__warningSites
          );
          Object.entries(sites ?? {}).forEach(([site, count]) => {
            appendFileSync(sitesFile, `${phase}: ${count}x ${site}\n\n`);
          });
          phases[phase] = { ...counts };
        };
        const view = page.locator('[data-compact-room-view="true"]');
        const openRoom = async () => {
          await page.goto(`/home/${encodeURIComponent(roomId)}`);
          await expect(view).toBeVisible({ timeout: 120_000 });
          await expect
            .poll(() => view.locator('[data-thread-root-id]').count(), { timeout: 120_000 })
            .toBeGreaterThanOrEqual(HISTORY_THREADS);
        };

        await loginWithPassword(page, { homeserver, username, password });
        await seedRoomOverviewState({
          page,
          roomId,
          userId: reader.userId,
          viewMode: 'compact',
          filterState: createDefaultThreadFilterState(),
        });
        await openRoom();
        await wait(3_000);

        // Agents stream in new threads while the Compact view shows.
        await Promise.all(
          [0, 1, 2, 3].map(async (index) => {
            const agent = agents[index % agents.length];
            if (!agent) throw new Error('no agent');
            const rootId = await send(homeserver, poster, roomId, 'm.room.message', {
              msgtype: 'm.text',
              body: `${engine} live question ${index}`,
            });
            await streamAgentReply(homeserver, agent, roomId, rootId, 6, 500);
          })
        );
        await wait(3_000);
        await keepSites('compact');

        // A reload starts from the saved sync.
        await openRoom();
        await wait(3_000);
        await keepSites('reload');

        // One thread open while an agent streams into it and the reader answers.
        const openRoot = roots[0];
        const agent = agents[0];
        if (!openRoot || !agent) throw new Error('no thread');
        await page.goto(
          `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(openRoot)}`
        );
        await expect(page.locator(`[data-message-id="${openRoot}"]`).first()).toBeVisible({
          timeout: 60_000,
        });
        await streamAgentReply(homeserver, agent, roomId, openRoot, 6, 500);
        await send(homeserver, reader, roomId, 'm.room.message', {
          msgtype: 'm.text',
          body: `${engine}: thanks, that answers it.`,
          'm.relates_to': threadRelation(openRoot, openRoot),
        });
        await wait(3_000);
        await keepSites('thread');

        await openRoom();
        await wait(3_000);
        await keepSites('back');
        results[engine] = phases;
      } finally {
        await browser.close();
      }
    }

    // eslint-disable-next-line no-console
    console.log(`HYGIENE ${JSON.stringify(results)}`);
    Object.entries(results).forEach(([engine, phases]) => {
      expect(phases.back, `${engine}: warnings over the session`).toEqual({
        threadRootId: 0,
        noTimeline: 0,
        listenerLeak: 0,
      });
    });
  });
});
