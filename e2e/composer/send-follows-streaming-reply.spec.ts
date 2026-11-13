import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { CHROMIUM_WITH_SCROLLBARS } from '../helpers/disposableAccounts';

// Regression: a reader at the bottom sends a message, and right away an agent starts typing and
// streams its reply as a run of edits. The view must go to the sent message and stay at the
// bottom while the reply grows under it, with nothing left behind the floating composer and no
// Jump to Latest. The same holds for a reader resting a little above the bottom, near enough
// that Jump to Latest stays hidden: the view counts as at the bottom exactly while it is hidden.
// The conditions match a real desktop: a long conversation with long agent replies (code blocks
// and the thread summary lines), a wide window, and classic scrollbars.

test.use({
  viewport: { width: 2000, height: 1100 },
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});
test.describe.configure({ timeout: 240_000 });

const HISTORY_EXCHANGES = 110;

type Fixture = {
  homeserver: string;
  roomId: string;
  rootId?: string;
  user: MatrixSession;
  agent: MatrixSession;
};

const longAgentHtml = (index: number) =>
  [
    `<p>Reply ${index}: here is what I found after reading the code and the logs.</p>`,
    '<ul>',
    '<li><strong>Small handoffs.</strong> Pass requirements and evidence, not the whole history.</li>',
    '<li><strong>Verifiable results.</strong> Return the commit, changed files and tests run.</li>',
    '<li><strong>Reliable completion.</strong> Completion or failure must wake the coordinator.</li>',
    '</ul>',
    `<pre><code class="language-ts">export const step${index} = (input: string) =&gt; {\n  const parts = input.split(':');\n  return parts.map((part) =&gt; part.trim()).filter(Boolean);\n};\n</code></pre>`,
    '<p>I would prove it with one small task before building more.</p>',
    '<hr>',
    `<p>🧵 <strong>Thread:</strong> Scroll fixture conversation ${index}<br>`,
    '📍 <strong>Now:</strong> Recommended shape: coordinator, implementer, reviewer.</p>',
  ].join('');

const longAgentBody = (index: number) =>
  [
    `Reply ${index}: here is what I found after reading the code and the logs.`,
    '- Small handoffs. Pass requirements and evidence, not the whole history.',
    '- Verifiable results. Return the commit, changed files and tests run.',
    '- Reliable completion. Completion or failure must wake the coordinator.',
    '```ts',
    `export const step${index} = (input: string) => input.split(':');`,
    '```',
    '🧵 Thread: Scroll fixture conversation',
    '📍 Now: Recommended shape: coordinator, implementer, reviewer.',
  ].join('\n');

/** The streamed reply after `step` chunks: paragraphs, then a code block that grows. */
const streamedHtml = (step: number) => {
  const paragraphs = Array.from(
    { length: Math.min(step, 4) },
    (_, line) => `<p>Streamed paragraph ${line + 1}: the reply keeps growing as tokens arrive.</p>`
  );
  const code =
    step > 4
      ? `<pre><code class="language-py">${Array.from(
          { length: (step - 4) * 3 },
          (_, line) => `value_${line} = compute(${line})`
        ).join('\n')}\n</code></pre>`
      : '';
  return `${paragraphs.join('')}${code}<p>STREAM-STEP-${step}</p>`;
};

const seedFixture = async (surface: 'thread' | 'room'): Promise<Fixture> => {
  const homeserver = getHomeserver();
  const { username, password } = getPrimaryCredentials();
  const user = await loginToMatrix(homeserver, username, password);
  const agent = await registerAgentAccount(homeserver, 'scroll');
  await matrixFetch(homeserver, `/profile/${encodeURIComponent(agent.userId)}/displayname`, {
    method: 'PUT',
    accessToken: agent.accessToken,
    body: JSON.stringify({ displayname: 'Helper' }),
  });
  const roomId = await createPrivateRoom(homeserver, user.accessToken, {
    name: `Send follow ${surface} ${Date.now()}`,
    topic: 'Sending at the bottom follows a streaming reply',
    invite: [agent.userId],
  });
  await joinRoom(homeserver, agent.accessToken, roomId);
  const rootId =
    surface === 'thread'
      ? await sendRoomMessage(homeserver, user.accessToken, roomId, {
          msgtype: 'm.text',
          body: 'How should the coordinator hand work to the implementer?',
        })
      : undefined;
  const relation = rootId
    ? {
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: rootId },
        },
      }
    : {};
  for (let index = 0; index < HISTORY_EXCHANGES; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(homeserver, user.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Question ${index}: what about the next step?`,
      ...relation,
    });
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(homeserver, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: longAgentBody(index),
      format: 'org.matrix.custom.html',
      formatted_body: longAgentHtml(index),
      'io.mindroom.stream_status': 'completed',
      ...relation,
    });
    if (rootId && index % 10 === 0) {
      // eslint-disable-next-line no-await-in-loop
      await sendRoomMessage(homeserver, agent.accessToken, roomId, {
        msgtype: 'm.notice',
        body: `Scroll fixture summary ${index}`,
        'io.mindroom.thread_summary': {
          version: 1,
          summary: `Scroll fixture summary ${index}`,
          message_count: index * 2 + 2,
          generated_at: new Date().toISOString(),
          model: 'test',
        },
        ...relation,
      });
    }
  }
  return { homeserver, roomId, rootId, user, agent };
};

const setTyping = (fixture: Fixture, typing: boolean) =>
  matrixFetch(
    fixture.homeserver,
    `/rooms/${encodeURIComponent(fixture.roomId)}/typing/${encodeURIComponent(
      fixture.agent.userId
    )}`,
    {
      method: 'PUT',
      accessToken: fixture.agent.accessToken,
      body: JSON.stringify({ typing, timeout: 30_000 }),
    }
  );

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const streamedMarkdown = (step: number) =>
  [
    ...Array.from(
      { length: Math.min(step, 4) },
      (_, line) => `Streamed paragraph ${line + 1}: the reply keeps growing as tokens arrive.`
    ),
    ...(step > 4
      ? [
          '```py',
          ...Array.from(
            { length: (step - 4) * 3 },
            (_, line) => `value_${line} = compute(${line})`
          ),
          '```',
        ]
      : []),
    `STREAM-STEP-${step}`,
  ].join('\n\n');

const sendLiveFrame = (
  fixture: Fixture,
  { reply, sid, seq, md }: { reply: string; sid: string; seq: number; md: string }
) =>
  fetch(
    `${fixture.homeserver}/_matrix/client/unstable/org.matrix.msc2477/rooms/${encodeURIComponent(
      fixture.roomId
    )}/ephemeral/io.mindroom.live/frame-${sid}-${seq}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fixture.agent.accessToken}`,
      },
      body: JSON.stringify({
        v: 1,
        reply,
        sid,
        seq,
        snapshot: { md, reasoning: '', tools: [], status: 'streaming', activity: '' },
      }),
    }
  ).then((response) => {
    if (!response.ok) throw new Error(`Live frame refused: ${response.status}`);
  });

/** The agent answers as MindRoom streams: typing, a first chunk, then edits that grow it. */
const streamAgentReply = async (
  fixture: Fixture,
  {
    typingAfterMs,
    replyAfterMs,
    frames,
  }: { typingAfterMs: number; replyAfterMs: number; frames: boolean }
) => {
  const relation = fixture.rootId
    ? {
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: fixture.rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: fixture.rootId },
        },
      }
    : {};
  const typing = wait(typingAfterMs).then(() => setTyping(fixture, true));
  await wait(replyAfterMs);
  const replyId = await sendRoomMessage(
    fixture.homeserver,
    fixture.agent.accessToken,
    fixture.roomId,
    {
      msgtype: 'm.text',
      body: 'STREAM-STEP-1',
      format: 'org.matrix.custom.html',
      formatted_body: streamedHtml(1),
      'io.mindroom.stream_status': 'streaming',
      ...relation,
    }
  );
  const sid = `${Date.now()}-${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}`;
  for (let step = 2; step <= 10; step += 1) {
    // eslint-disable-next-line no-await-in-loop
    await wait(120);
    const status = step === 10 ? 'completed' : 'streaming';
    if (frames && step < 10) {
      // MindRoom's live frames: ephemeral snapshots that grow the reply between durable edits.
      // eslint-disable-next-line no-await-in-loop
      await sendLiveFrame(fixture, { reply: replyId, sid, seq: step, md: streamedMarkdown(step) });
      // eslint-disable-next-line no-continue
      if (step % 4 !== 0) continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(fixture.homeserver, fixture.agent.accessToken, fixture.roomId, {
      msgtype: 'm.text',
      body: `* STREAM-STEP-${step}`,
      'm.new_content': {
        msgtype: 'm.text',
        body: `STREAM-STEP-${step}`,
        format: 'org.matrix.custom.html',
        formatted_body: streamedHtml(step),
        'io.mindroom.stream_status': status,
      },
      'm.relates_to': { rel_type: 'm.replace', event_id: replyId },
    });
  }
  await typing;
  await setTyping(fixture, false);
  return replyId;
};

/**
 * How far the timeline's scroll area (the scrolling ancestor of the virtual rows) is above its
 * bottom; with `place`, it first scrolls there.
 */
const scrollGap = (page: Page, place?: number) =>
  page.evaluate((distance) => {
    let element = document.querySelector<HTMLElement>(
      '[data-thread-count], [data-testid="room-virtual-inner"]'
    )?.parentElement;
    while (element && !/auto|scroll/.test(getComputedStyle(element).overflowY)) {
      element = element.parentElement;
    }
    if (!element) throw new Error('Timeline scroller missing');
    if (distance !== undefined) {
      element.scrollTop = element.scrollHeight - element.clientHeight - distance;
    }
    return Math.round(element.scrollHeight - element.clientHeight - element.scrollTop);
  }, place);

/** The bottom edge of the row is on screen and nothing (the floating composer) covers it. */
const bottomShows = (row: Locator): Promise<boolean> =>
  row.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.height === 0 || rect.bottom > window.innerHeight) return false;
    const y = Math.max(rect.top + 1, rect.bottom - 6);
    const x = rect.left + Math.min(rect.width / 2, 120);
    const hit = document.elementFromPoint(x, y);
    return !!hit && element.contains(hit);
  });

/**
 * The reader scrolls up a little with the wheel and comes back to the bottom, as anyone reading a
 * thread does. The gesture ends the pin a thread opens with, so what follows depends on the
 * timeline's own rule for a reader at the bottom.
 */
const readUpAndBack = async (page: Page) => {
  const rows = page.locator('[data-thread-count], [data-testid="room-virtual-inner"]').first();
  const box = await rows.boundingBox();
  if (!box) throw new Error('Timeline rows missing');
  await page.mouse.move(box.x + 400, 500);
  for (let step = 0; step < 3; step += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.mouse.wheel(0, -400);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(80);
  }
  await expect.poll(() => scrollGap(page)).toBeGreaterThan(800);
  for (let step = 0; step < 8; step += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.mouse.wheel(0, 400);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(80);
  }
  await expect.poll(() => scrollGap(page)).toBeLessThanOrEqual(2);
};

/**
 * The reader turns the wheel up a little and rests `gap` px above the bottom, near enough that
 * Jump to Latest stays hidden. Nothing moves them while no row arrives.
 */
const restAboveBottom = async (page: Page, gap: number) => {
  const rows = page.locator('[data-thread-count], [data-testid="room-virtual-inner"]').first();
  const box = await rows.boundingBox();
  if (!box) throw new Error('Timeline rows missing');
  await page.mouse.move(box.x + 400, 500);
  await page.mouse.wheel(0, -gap);
  await page.waitForTimeout(300);
  // The wheel's step is the browser's; the reader ends exactly `gap` px above the bottom.
  await scrollGap(page, gap);
  await page.waitForTimeout(800);
  const rested = await scrollGap(page);
  expect(rested, 'the reader rests where they scrolled').toBeGreaterThanOrEqual(gap - 2);
  expect(rested, 'the reader rests where they scrolled').toBeLessThanOrEqual(gap + 2);
};

let shared: Page;

const openShared = async (browser: Browser) => {
  const context = await browser.newContext({ viewport: { width: 2000, height: 1100 } });
  shared = await context.newPage();
  const homeserver = getHomeserver();
  await loginWithPassword(shared, { homeserver, ...getPrimaryCredentials() });
};

test.beforeAll(async ({ browser }) => {
  test.skip(!hasPrimaryCredentials(), 'E2E_USERNAME / E2E_PASSWORD not set');
  await openShared(browser);
});

test.afterAll(async () => {
  await shared?.context().close();
});

// `gap`: how far above the bottom the reader rests when they send.
const SCENARIOS = [
  { surface: 'thread', view: 'threaded', typingAfterMs: 0, replyAfterMs: 50, frames: true, gap: 0 },
  {
    surface: 'thread',
    view: 'threaded',
    typingAfterMs: 150,
    replyAfterMs: 300,
    frames: false,
    gap: 0,
  },
  {
    surface: 'thread',
    view: 'compact',
    typingAfterMs: 300,
    replyAfterMs: 100,
    frames: true,
    gap: 0,
  },
  { surface: 'thread', view: 'compact', typingAfterMs: 0, replyAfterMs: 0, frames: false, gap: 0 },
  { surface: 'room', view: 'classic', typingAfterMs: 0, replyAfterMs: 50, frames: true, gap: 0 },
  {
    surface: 'room',
    view: 'classic',
    typingAfterMs: 200,
    replyAfterMs: 300,
    frames: false,
    gap: 0,
  },
  {
    surface: 'thread',
    view: 'threaded',
    typingAfterMs: 0,
    replyAfterMs: 50,
    frames: true,
    gap: 60,
  },
  {
    surface: 'thread',
    view: 'compact',
    typingAfterMs: 150,
    replyAfterMs: 300,
    frames: false,
    gap: 60,
  },
  { surface: 'room', view: 'classic', typingAfterMs: 0, replyAfterMs: 50, frames: true, gap: 60 },
] as const;

for (const scenario of SCENARIOS) {
  const stream = scenario.frames ? 'live frames' : 'edits';
  const timing = `typing after ${scenario.typingAfterMs} ms, reply after ${scenario.replyAfterMs} ms`;
  const where = scenario.gap ? `${scenario.gap} px above the bottom` : 'at the bottom';
  test(`a send ${where} of a ${scenario.surface} (${scenario.view}) follows a reply streamed with ${stream}, ${timing}`, async () => {
    const page = shared;
    const fixture = await seedFixture(scenario.surface);
    await page.evaluate(
      ({ roomId, view }) => localStorage.setItem(`roomViewMode:${roomId}`, JSON.stringify(view)),
      { roomId: fixture.roomId, view: scenario.view }
    );
    const path = fixture.rootId
      ? `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(fixture.rootId)}`
      : `/home/${encodeURIComponent(fixture.roomId)}`;
    await page.evaluate((url) => {
      window.history.pushState(null, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, path);

    const lastHistory = page
      .locator('[data-message-id]')
      .filter({ hasText: `Reply ${HISTORY_EXCHANGES - 1}:` })
      .first();
    await expect(lastHistory).toBeVisible({ timeout: 60_000 });
    const jump = page.getByRole('button', { name: 'Jump to Latest' });
    await expect.poll(() => scrollGap(page), { timeout: 20_000 }).toBeLessThanOrEqual(2);
    await expect(jump).toBeHidden();
    // Let late measurements settle, as a reader who has been here for a while.
    await page.waitForTimeout(1_500);
    await readUpAndBack(page);
    await page.waitForTimeout(800);
    await expect.poll(() => scrollGap(page), { timeout: 10_000 }).toBeLessThanOrEqual(2);
    if (scenario.gap) {
      await restAboveBottom(page, scenario.gap);
      await expect(jump).toBeHidden();
    }

    const ownText = `Own message ${Date.now()}`;
    const composer = page.getByRole('textbox', { name: 'Send a message...' });
    await composer.click();
    await page.keyboard.type(ownText);
    await page.keyboard.press('Enter');
    const replyId = await streamAgentReply(fixture, scenario);

    const ownRow = page.locator('[data-message-id]').filter({ hasText: ownText }).first();
    const replyRow = page.locator(`[data-message-id="${replyId}"]`).first();
    await expect(replyRow).toContainText('STREAM-STEP-10', { timeout: 30_000 });
    await expect(page.getByRole('status').filter({ hasText: 'is typing' })).toHaveCount(0, {
      timeout: 10_000,
    });
    await page.waitForTimeout(1_000);
    const gap = await scrollGap(page);
    expect(gap, 'the view stays at the bottom after the reply streamed in').toBeLessThanOrEqual(2);
    await expect(jump).toBeHidden();
    expect(await bottomShows(replyRow), 'the reply ends above the composer').toBe(true);
    await expect(ownRow).toBeInViewport();
  });
}
