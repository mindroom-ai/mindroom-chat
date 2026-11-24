import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, registerAgentAccount, sendRoomMessage } from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// Clamped reveal-on-open for timeline disclosures across default (cog) and shown tool-call modes.
// Set DISCLOSURE_REVEAL_SHOTS=<dir> to save verification screenshots.
const PASSWORD = 'disclosure-scroll-reveal-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.DISCLOSURE_REVEAL_SHOTS;

const UPPER_ANSWER = 'Region codes are normalized before hashing the cache key.';
const SHORT_ANSWER = 'Weather cache keys now include the region prefix and expire after 300 s.';
const HUGE_ANSWER = 'Parser lookahead table refactored with zero regressions.';
const WORK_ANSWER = 'Weather cache parser refactor is complete and all 28 suite checks pass.';

type Tool = { name: string; args: string; result: string };
const READ: Tool = { name: 'read_file', args: 'path=src/weather/cache.ts', result: '96 lines' };
const GREP: Tool = { name: 'grep', args: 'pattern=cacheKey src/weather/', result: '4 matches' };
const SHELL: Tool = { name: 'shell', args: 'npm test -- parser-refactor', result: '28 passed' };
const mark = (t: Tool, i: number) => `🔧 \`${t.name}\` [${i}]`;

const agentReply = (paragraphs: string[], tools: Tool[], extra?: Record<string, unknown>) => ({
  msgtype: 'm.text',
  body: paragraphs.join('\n\n'),
  format: 'org.matrix.custom.html',
  formatted_body: paragraphs
    .map((p) => `<p>${p.replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`)
    .join('\n'),
  'io.mindroom.stream_status': 'completed',
  'io.mindroom.tool_trace': {
    version: 2,
    events: tools.map(({ name, args, result }) => ({
      type: 'tool_call_completed',
      tool_name: name,
      args_preview: args,
      result_preview: result,
    })),
  },
  ...extra,
});

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

const threadScroller = (page: Page, scrollTo?: number) =>
  page.evaluate((nextTop) => {
    const inner = document.querySelector<HTMLElement>('[data-timeline-rows][data-thread-count]');
    let node = inner?.parentElement ?? null;
    while (node && !['auto', 'scroll', 'overlay'].includes(getComputedStyle(node).overflowY)) {
      node = node.parentElement;
    }
    if (!node) return null;
    if (nextTop !== undefined) node.scrollTop = nextTop;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const bottomInset = Number.parseFloat(style.scrollPaddingBottom) || 0;
    return {
      scrollTop: node.scrollTop,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      visibleTop: rect.top + (Number.parseFloat(style.scrollPaddingTop) || 0),
      visibleBottom: rect.bottom - bottomInset,
      bottomInset,
    };
  }, scrollTo);

const waitFrames = (page: Page, count = 4) =>
  page.evaluate(
    (n) =>
      new Promise<void>((done) => {
        const tick = (k: number) => (k <= 0 ? done() : requestAnimationFrame(() => tick(k - 1)));
        tick(n);
      }),
    count
  );

const waitStable = async (page: Page) => {
  let prev = (await threadScroller(page))?.scrollTop ?? Number.NaN;
  await expect
    .poll(async () => {
      await waitFrames(page, 2);
      const curr = (await threadScroller(page))?.scrollTop ?? Number.NaN;
      const stable = Number.isFinite(curr) && Math.abs(curr - prev) < 0.5;
      prev = curr;
      return stable;
    })
    .toBe(true);
};

const replyWith = (page: Page, text: string) =>
  page.locator('[data-message-item]').filter({ hasText: text });

const waitAtBottom = async (page: Page, answerText: string): Promise<Locator> => {
  const reply = replyWith(page, answerText);
  await expect(reply).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(
      async () => {
        const m = await threadScroller(page);
        const box = await reply.boundingBox();
        if (!m || !box) return false;
        const ok = m.scrollHeight > m.clientHeight + 150 && m.bottomInset > 0 && m.scrollTop > 100;
        return ok && box.y + box.height <= m.visibleBottom + 4;
      },
      { timeout: 30_000 }
    )
    .toBe(true);
  await waitStable(page);
  return reply;
};

const openAndExpectRevealed = async (
  page: Page,
  trigger: Locator,
  revealed: Locator,
  shotName?: string
) => {
  const before = (await threadScroller(page))!;
  await trigger.click();
  await expect(revealed).toBeVisible();
  await expect
    .poll(async () => {
      const m = await threadScroller(page);
      const box = await revealed.boundingBox();
      if (!m || !box) return false;
      return box.y + box.height <= m.visibleBottom + 2 && m.scrollTop > before.scrollTop;
    })
    .toBe(true);
  if (shotName) await shot(page, shotName);
};

const seedThreads = async () => {
  const username = `dsr_reader_${RUN}`;
  const reader = await registerDisposableUser(username, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, 'coder');
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Weather cache & parser refactor',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);

  const inThread = (rootId: string, content: Record<string, unknown>) => ({
    ...content,
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });
  const ask = (body: string) =>
    sendRoomMessage(HOMESERVER, reader.accessToken, roomId, { msgtype: 'm.text', body });
  const reply = (rootId: string, content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, agent.accessToken, roomId, inThread(rootId, content));
  const thought = (body: string, text: string, durationMs: number) => ({
    msgtype: 'm.text',
    body,
    'io.mindroom.stream_status': 'completed',
    'io.mindroom.reasoning': { text, duration_ms: durationMs },
  });
  const fill = async (rootId: string, topic: string, count: number) => {
    for (let i = 1; i <= count; i += 1) {
      const q = { msgtype: 'm.text', body: `${topic} check ${i}: confirm fixture.` };
      await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, inThread(rootId, q));
      await reply(rootId, { msgtype: 'm.text', body: `${topic} note ${i}: boundary is clean.` });
    }
  };

  // Start Thread 3 early so seeding Threads 1 & 2 separates its initial event from its edit.
  const workRoot = await ask('Refactor weather cache parser.');
  await fill(workRoot, 'Parser suite', 7);
  const workInitId = await reply(workRoot, {
    msgtype: 'm.text',
    body: 'Checking weather cache parser...',
    'io.mindroom.stream_status': 'streaming',
  });

  // Thread 1: cog + ThreadActivity + short reasoning + upper-viewport zero-jump message.
  const weatherRoot = await ask('Audit weather cache TTL layout.');
  await fill(weatherRoot, 'Weather cache', 2);
  await reply(weatherRoot, thought(UPPER_ANSWER, 'Verify region normalization before TTL.', 5000));
  await fill(weatherRoot, 'Weather cache', 6);
  const shortBody = [SHORT_ANSWER, mark(READ, 1), mark(GREP, 2)];
  const shortReason = {
    text: 'Inspect cache readers.\n\nCheck region prefix.\n\nConfirm 300 s TTL.',
    duration_ms: 8000,
  };
  await reply(
    weatherRoot,
    agentReply(shortBody, [READ, GREP], { 'io.mindroom.reasoning': shortReason })
  );

  // Thread 2: huge 80-paragraph Thought for ... on the last message.
  const hugeRoot = await ask('Walk through parser lookahead.');
  await fill(hugeRoot, 'Parser refactor', 7);
  const hugeLines = Array.from(
    { length: 80 },
    (_, i) => `Paragraph ${i + 1}: trace lookahead state ${i + 1} in the parser table.`
  );
  await reply(hugeRoot, thought(HUGE_ANSWER, hugeLines.join('\n\n'), 42_000));

  // Finalize Thread 3 FinishedWorkFold via m.replace.
  const workFinal = agentReply(
    [
      'Checked cache key tokenization across forecast and alert payloads.',
      mark(READ, 1),
      'Updated parser grammar to reject empty region prefixes before cache lookup.',
      'Verified stale-while-revalidate eviction timestamps under timezone offsets.',
      'Confirmed serialized snapshot format stays backwards compatible with older keys.',
      mark(SHELL, 2),
      WORK_ANSWER,
    ],
    [READ, SHELL],
    { 'io.mindroom.ai_run': { version: 1, status: 'completed' } }
  );
  await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    ...workFinal,
    body: `* ${workFinal.body}`,
    'm.new_content': workFinal,
    'm.relates_to': { rel_type: 'm.replace', event_id: workInitId },
  });

  return { username, roomId, weatherRoot, hugeRoot, workRoot };
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('reveals disclosures above composer, clamps tall ones, and cancels on wheel', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1280, height: 720 });
  const world = await seedThreads();
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: world.username,
    password: PASSWORD,
    showToolCalls: false,
  });
  const scroller = (top?: number) => threadScroller(page, top);
  const openThread = (rootId: string) =>
    page.goto(`/home/${encodeURIComponent(world.roomId)}?threadId=${encodeURIComponent(rootId)}`);

  // 1. Default mode (showToolCalls: false): cog + ThreadActivity + short Thought for ...
  await openThread(world.weatherRoot);
  const shortReply = await waitAtBottom(page, SHORT_ANSWER);
  const cogButton = shortReply.locator('[data-tool-calls-fold] > button');
  const toolBox = shortReply
    .locator('[data-message-disclosure]:not([data-tool-calls-fold])')
    .first();
  const toolRow = toolBox.locator(':scope > button');
  const toolPanel = toolBox.locator(':scope > [id]');
  await expect(cogButton).toBeVisible();
  await shot(page, 'cog-closed');
  await openAndExpectRevealed(page, cogButton, toolRow, 'cog-open');
  await openAndExpectRevealed(page, toolRow, toolPanel, 'tool-row-open');

  const beforeCollapse = (await scroller())!;
  await toolRow.click();
  await expect(toolPanel).toHaveCount(0);
  await waitStable(page);
  expect((await scroller())!.scrollTop).toBeLessThanOrEqual(beforeCollapse.scrollTop + 1);
  await cogButton.click();
  await expect(toolRow).toHaveCount(0);

  const shortThought = shortReply.getByRole('button', { name: 'Thought for 8 s' });
  const shortThoughtEnd = shortReply.getByRole('button', { name: 'Hide thinking' }).last();
  await openAndExpectRevealed(page, shortThought, shortThoughtEnd);
  expect((await shortThought.boundingBox())!.y).toBeGreaterThanOrEqual(
    (await scroller())!.visibleTop + 6
  );
  await shortThought.click();
  await expect(shortThoughtEnd).toHaveCount(0);

  // Tool calls shown mode (showToolCalls: true): direct ThreadActivity row lifts its panel.
  await page.getByRole('button', { name: 'Thread options' }).first().click();
  await page.getByRole('menuitemcheckbox', { name: 'Show tool calls' }).click();
  await expect(cogButton).toHaveCount(0);
  await expect(toolRow).toBeVisible();
  await scroller((await scroller())!.scrollHeight);
  await waitStable(page);
  await openAndExpectRevealed(page, toolRow, toolPanel, 'tool-row-shown-open');
  await toolRow.click();
  await expect(toolPanel).toHaveCount(0);

  // 4. Disclosure already in upper viewport: 0px scrollTop change on open and collapse.
  const upperReply = replyWith(page, UPPER_ANSWER);
  const upperToggle = upperReply.getByRole('button', { name: 'Thought for 5 s' });
  await scroller(0);
  await expect(upperToggle).toBeVisible();
  const atTop = (await scroller())!;
  const upperY = (await upperToggle.boundingBox())!.y;
  await scroller(Math.max(0, atTop.scrollTop + upperY - atTop.visibleTop - 60));
  await waitStable(page);
  const beforeFits = (await scroller())!;
  const midY = (beforeFits.visibleTop + beforeFits.visibleBottom) / 2;
  expect((await upperToggle.boundingBox())!.y).toBeLessThan(midY);
  await upperToggle.click();
  await expect(upperReply.getByText('Verify region normalization before TTL.')).toBeVisible();
  await waitFrames(page, 6);
  expect((await scroller())!.scrollTop).toBe(beforeFits.scrollTop);
  await upperToggle.click();
  await waitFrames(page, 4);
  expect((await scroller())!.scrollTop).toBe(beforeFits.scrollTop);

  // 2. Huge 80-paragraph Thought for ... clamps toggle near visibleTop + 8.
  await openThread(world.hugeRoot);
  const hugeReply = await waitAtBottom(page, HUGE_ANSWER);
  const hugeToggle = hugeReply.getByRole('button', { name: 'Thought for 42 s' });
  const beforeHuge = (await scroller())!;
  await hugeToggle.click();
  await expect(hugeReply.getByText('Paragraph 1:')).toBeVisible();
  await expect
    .poll(async () => {
      const m = await scroller();
      const box = await hugeToggle.boundingBox();
      if (!m || !box) return false;
      return m.scrollTop > beforeHuge.scrollTop + 50 && Math.abs(box.y - (m.visibleTop + 8)) <= 6;
    })
    .toBe(true);
  const lastLineY = (await hugeReply.getByText('Paragraph 80:').boundingBox())!.y;
  expect(lastLineY).toBeGreaterThan((await scroller())!.visibleBottom + 300);
  await shot(page, 'long-thinking-open');
  await hugeToggle.click();
  await expect(hugeReply.getByText('Paragraph 1:')).toHaveCount(0);
  await waitStable(page);
  const collapsed = (await hugeToggle.boundingBox())!;
  const afterHuge = (await scroller())!;
  expect(collapsed.y).toBeGreaterThanOrEqual(afterHuge.visibleTop - 2);
  expect(collapsed.y + collapsed.height).toBeLessThanOrEqual(afterHuge.visibleBottom + 2);

  // 3. Worked for ... (FinishedWorkFold) 280ms animation + mid-animation wheel cancel.
  await openThread(world.workRoot);
  const workReply = await waitAtBottom(page, WORK_ANSWER);
  const workToggle = workReply.locator('button[data-work-fold]');
  const workPanel = workToggle.locator('xpath=following-sibling::div[1]');
  const beforeWork = (await scroller())!;
  await workToggle.click();
  await expect(workPanel).toBeVisible();
  await expect(workReply.locator('[data-motion]')).toHaveCount(0, { timeout: 5000 });
  await expect
    .poll(async () => {
      const m = await scroller();
      const p = await workPanel.boundingBox();
      const t = await workToggle.boundingBox();
      if (!m || !p || !t || m.scrollTop <= beforeWork.scrollTop) return false;
      return p.y + p.height <= m.visibleBottom + 2 || Math.abs(t.y - (m.visibleTop + 8)) <= 6;
    })
    .toBe(true);
  await shot(page, 'worked-for-open');

  await workToggle.click();
  await expect(workPanel).toHaveCount(0, { timeout: 5000 });
  await scroller((await scroller())!.scrollHeight);
  await waitStable(page);
  const tBox = (await workToggle.boundingBox())!;
  const beforeWheel = (await scroller())!;
  await page.mouse.move(tBox.x + tBox.width / 2, tBox.y + tBox.height / 2);
  await workToggle.click();
  await expect(workReply.locator('[data-motion="opening"]')).toHaveCount(1);
  await page.mouse.wheel(0, -240);
  await waitFrames(page, 4);
  const duringAnim = (await scroller())!;
  await expect(workReply.locator('[data-motion]')).toHaveCount(0, { timeout: 5000 });
  await waitStable(page);
  const afterAnim = (await scroller())!;
  expect(afterAnim.scrollTop).toBeLessThan(beforeWheel.scrollTop - 40);
  expect(afterAnim.scrollTop).toBeLessThanOrEqual(duringAnim.scrollTop + 4);
});
