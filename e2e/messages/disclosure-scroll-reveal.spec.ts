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

// Clamped reveal-on-open for timeline disclosures: opening a disclosure near the floating composer
// lifts its expanded content into view while keeping the toggle below the top header inset, never
// jumping when content already fits, and cancelling immediately on user wheel input.
// Set DISCLOSURE_REVEAL_SHOTS=<dir> to save verification screenshots.
const PASSWORD = 'disclosure-scroll-reveal-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.DISCLOSURE_REVEAL_SHOTS;

type Tool = { name: string; args: string; result: string };
const READ_CACHE: Tool = {
  name: 'read_file',
  args: 'path=src/weather/cache.ts',
  result: '96 lines',
};
const GREP_CACHE: Tool = {
  name: 'grep',
  args: 'pattern=cacheKey src/weather/',
  result: '4 matches in 2 files',
};
const RUN_PARSER_TESTS: Tool = {
  name: 'shell',
  args: 'npm test -- parser-refactor',
  result: '28 passed in 0.4s',
};

const marker = (tool: Tool, index: number) => `🔧 \`${tool.name}\` [${index}]`;

const agentReply = (paragraphs: string[], tools: Tool[]) => {
  const body = paragraphs.join('\n\n');
  return {
    msgtype: 'm.text',
    body,
    format: 'org.matrix.custom.html',
    formatted_body: paragraphs
      .map((paragraph) => `<p>${paragraph.replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`)
      .join('\n'),
    'io.mindroom.tool_trace': {
      version: 2,
      events: tools.map((tool) => ({
        type: 'tool_call_completed',
        tool_name: tool.name,
        args_preview: tool.args,
        result_preview: tool.result,
      })),
    },
  };
};

const threadContent = (rootId: string, content: Record<string, unknown>) => ({
  ...content,
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

const readThreadScroller = (page: Page) =>
  page.evaluate(() => {
    const inner = document.querySelector<HTMLElement>('[data-timeline-rows][data-thread-count]');
    let scroller = inner?.parentElement ?? null;
    while (scroller) {
      const { overflowY } = getComputedStyle(scroller);
      if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') break;
      scroller = scroller.parentElement;
    }
    if (!scroller) return null;
    const style = getComputedStyle(scroller);
    const rect = scroller.getBoundingClientRect();
    const topInset = Number.parseFloat(style.scrollPaddingTop) || 0;
    const bottomInset = Number.parseFloat(style.scrollPaddingBottom) || 0;
    return {
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      visibleTop: rect.top + topInset,
      visibleBottom: rect.bottom - bottomInset,
      bottomInset,
    };
  });

const setThreadScrollTop = (page: Page, top: number) =>
  page.evaluate((nextTop) => {
    const inner = document.querySelector<HTMLElement>('[data-timeline-rows][data-thread-count]');
    let scroller = inner?.parentElement ?? null;
    while (scroller) {
      const { overflowY } = getComputedStyle(scroller);
      if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') break;
      scroller = scroller.parentElement;
    }
    if (scroller) scroller.scrollTop = nextTop;
  }, top);

const replyWith = (page: Page, text: string) =>
  page.locator('[data-message-item]').filter({ hasText: text });

const waitForThreadAtBottom = async (page: Page, answerText: string): Promise<Locator> => {
  const reply = replyWith(page, answerText);
  await expect(reply).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(
      async () => {
        const metrics = await readThreadScroller(page);
        const box = await reply.boundingBox();
        if (!metrics || !box) return false;
        return (
          metrics.scrollHeight > metrics.clientHeight + 150 &&
          metrics.bottomInset > 0 &&
          metrics.scrollTop > 100 &&
          box.y + box.height <= metrics.visibleBottom + 4
        );
      },
      { timeout: 30_000 }
    )
    .toBe(true);
  await page.waitForTimeout(150);
  return reply;
};

const waitForFrames = (page: Page, count = 3) =>
  page.evaluate(
    (remaining) =>
      new Promise<void>((resolve) => {
        const tick = (left: number) => {
          if (left <= 0) resolve();
          else requestAnimationFrame(() => tick(left - 1));
        };
        tick(remaining);
      }),
    count
  );

const seedFillerTurns = async (
  readerToken: string,
  agentToken: string,
  roomId: string,
  rootId: string,
  topic: string,
  count: number
) => {
  for (let index = 1; index <= count; index += 1) {
    await sendRoomMessage(
      HOMESERVER,
      readerToken,
      roomId,
      threadContent(rootId, {
        msgtype: 'm.text',
        body: `${topic} check ${index}: confirm module boundary and fixture snapshot.`,
      })
    );
    await sendRoomMessage(
      HOMESERVER,
      agentToken,
      roomId,
      threadContent(rootId, {
        msgtype: 'm.text',
        body: `${topic} note ${index}: boundary looks clean and all local fixtures agree.`,
      })
    );
  }
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

  // Thread 1: short tool calls (cog + ThreadActivity), short reasoning, and an earlier message
  // used to verify zero scroll jump when a disclosure already fits in the upper viewport.
  const weatherRoot = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Audit the weather cache TTL and region key layout.',
  });
  await seedFillerTurns(
    reader.accessToken,
    agent.accessToken,
    roomId,
    weatherRoot,
    'Weather cache',
    2
  );
  const UPPER_ANSWER = 'Region codes are normalized before hashing the cache key.';
  await sendRoomMessage(
    HOMESERVER,
    agent.accessToken,
    roomId,
    threadContent(weatherRoot, {
      msgtype: 'm.text',
      body: UPPER_ANSWER,
      'io.mindroom.stream_status': 'completed',
      'io.mindroom.reasoning': {
        text: 'Verify region normalization before changing TTL defaults.',
        duration_ms: 5000,
      },
    })
  );
  await seedFillerTurns(
    reader.accessToken,
    agent.accessToken,
    roomId,
    weatherRoot,
    'Weather cache',
    6
  );
  const SHORT_ANSWER =
    'Weather cache keys now include the region prefix and expire after 300 seconds.';
  await sendRoomMessage(
    HOMESERVER,
    agent.accessToken,
    roomId,
    threadContent(weatherRoot, {
      ...agentReply(
        [SHORT_ANSWER, marker(READ_CACHE, 1), marker(GREP_CACHE, 2)],
        [READ_CACHE, GREP_CACHE]
      ),
      'io.mindroom.stream_status': 'completed',
      'io.mindroom.reasoning': {
        text: 'Inspect weather cache readers first.\n\nAll callers pass the region code already.',
        duration_ms: 8000,
      },
    })
  );

  // Thread 2: huge 80-paragraph Thought for ... on the last message.
  const hugeRoot = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Walk through every parser refactor lookahead state.',
  });
  await seedFillerTurns(
    reader.accessToken,
    agent.accessToken,
    roomId,
    hugeRoot,
    'Parser refactor',
    7
  );
  const HUGE_ANSWER = 'Parser lookahead table refactored with zero regressions.';
  const hugeParagraphs = Array.from(
    { length: 80 },
    (_, index) =>
      `Paragraph ${index + 1}: trace token lookahead transition ${index + 1} in the parser table.`
  ).join('\n\n');
  await sendRoomMessage(
    HOMESERVER,
    agent.accessToken,
    roomId,
    threadContent(hugeRoot, {
      msgtype: 'm.text',
      body: HUGE_ANSWER,
      'io.mindroom.stream_status': 'completed',
      'io.mindroom.reasoning': {
        text: hugeParagraphs,
        duration_ms: 42_000,
      },
    })
  );

  // Thread 3: FinishedWorkFold (Worked for ...) on the last message.
  const workRoot = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Refactor the weather cache parser and run its unit suite.',
  });
  await seedFillerTurns(reader.accessToken, agent.accessToken, roomId, workRoot, 'Parser suite', 7);
  const WORK_ANSWER = 'Weather cache parser refactor is complete and all 28 suite checks pass.';
  const workInitialId = await sendRoomMessage(
    HOMESERVER,
    agent.accessToken,
    roomId,
    threadContent(workRoot, {
      msgtype: 'm.text',
      body: 'Checking weather cache parser modules...',
      'io.mindroom.stream_status': 'streaming',
    })
  );
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const workFinalContent = {
    ...agentReply(
      [
        'Checked cache key tokenization across forecast and alert payloads.',
        marker(READ_CACHE, 1),
        'Updated the parser grammar to reject empty region prefixes before cache lookup.',
        'Verified stale-while-revalidate eviction timestamps under timezone offsets.',
        'Confirmed serialized snapshot format stays backwards compatible with older keys.',
        marker(RUN_PARSER_TESTS, 2),
        WORK_ANSWER,
      ],
      [READ_CACHE, RUN_PARSER_TESTS]
    ),
    'io.mindroom.ai_run': { version: 1, status: 'completed' },
    'io.mindroom.stream_status': 'completed',
  };
  await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    ...workFinalContent,
    body: `* ${workFinalContent.body}`,
    'm.new_content': workFinalContent,
    'm.relates_to': { rel_type: 'm.replace', event_id: workInitialId },
  });

  return {
    username,
    roomId,
    weatherRoot,
    hugeRoot,
    workRoot,
    UPPER_ANSWER,
    SHORT_ANSWER,
    HUGE_ANSWER,
    WORK_ANSWER,
  };
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('reveals timeline disclosures above the composer, clamps tall ones, and cancels on wheel', async ({
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

  const openThread = async (rootId: string) => {
    await page.goto(
      `/home/${encodeURIComponent(world.roomId)}?threadId=${encodeURIComponent(rootId)}`
    );
  };

  // 1. Short tool calls via cog + ThreadActivity row + short Thought for ... on the last message.
  await openThread(world.weatherRoot);
  const shortReply = await waitForThreadAtBottom(page, world.SHORT_ANSWER);
  const cogButton = shortReply.locator('[data-tool-calls-fold] > button');
  await expect(cogButton).toBeVisible();
  await shot(page, 'cog-closed');

  const beforeCog = (await readThreadScroller(page))!;
  await cogButton.click();
  const toolRowButton = shortReply
    .locator('[data-message-disclosure]:not([data-tool-calls-fold]) > button')
    .first();
  await expect(toolRowButton).toBeVisible();
  await expect
    .poll(async () => {
      const m = await readThreadScroller(page);
      const box = await toolRowButton.boundingBox();
      return m && box
        ? box.y + box.height <= m.visibleBottom + 2 && m.scrollTop > beforeCog.scrollTop
        : false;
    })
    .toBe(true);
  await shot(page, 'cog-open');

  // Expand the tool-call row (ThreadActivity) and check its panel lifts above the composer.
  const beforeRow = (await readThreadScroller(page))!;
  await toolRowButton.click();
  const toolPanel = shortReply
    .locator('[data-message-disclosure]:not([data-tool-calls-fold])')
    .first()
    .locator(':scope > [id]');
  await expect(toolPanel).toBeVisible();
  await expect
    .poll(async () => {
      const m = await readThreadScroller(page);
      const box = await toolPanel.boundingBox();
      return m && box
        ? box.y + box.height <= m.visibleBottom + 2 && m.scrollTop > beforeRow.scrollTop
        : false;
    })
    .toBe(true);
  await shot(page, 'tool-row-open');

  // Collapse tool row and cog: no downward jump and toggle remains visible.
  const beforeRowCollapse = (await readThreadScroller(page))!;
  await toolRowButton.click();
  await expect(toolPanel).toHaveCount(0);
  await waitForFrames(page, 4);
  const afterRowCollapse = (await readThreadScroller(page))!;
  expect(afterRowCollapse.scrollTop).toBeLessThanOrEqual(beforeRowCollapse.scrollTop + 1);
  await cogButton.click();
  await expect(toolRowButton).toHaveCount(0);

  // Short Thought for ... on the last message lifts completely above the composer.
  const shortThoughtToggle = shortReply.getByRole('button', { name: 'Thought for 8 s' });
  const beforeShortThought = (await readThreadScroller(page))!;
  await shortThoughtToggle.click();
  const shortThoughtEnd = shortReply
    .getByRole('button', { name: 'Hide thinking' })
    .filter({ hasText: 'Hide thinking' })
    .last();
  await expect(shortThoughtEnd).toBeVisible();
  await expect
    .poll(async () => {
      const m = await readThreadScroller(page);
      const endBox = await shortThoughtEnd.boundingBox();
      const toggleBox = await shortThoughtToggle.boundingBox();
      return m && endBox && toggleBox
        ? endBox.y + endBox.height <= m.visibleBottom + 2 &&
            toggleBox.y >= m.visibleTop + 6 &&
            m.scrollTop > beforeShortThought.scrollTop
        : false;
    })
    .toBe(true);
  await shortThoughtToggle.click();
  await expect(shortThoughtEnd).toHaveCount(0);

  // 4. Disclosure that already fits in the upper half of the viewport: 0px scrollTop change.
  const upperReply = replyWith(page, world.UPPER_ANSWER);
  const upperThoughtToggle = upperReply.getByRole('button', { name: 'Thought for 5 s' });
  await setThreadScrollTop(page, 0);
  await expect(upperThoughtToggle).toBeVisible();
  const atTop = (await readThreadScroller(page))!;
  const boxAtTop = (await upperThoughtToggle.boundingBox())!;
  await setThreadScrollTop(page, Math.max(0, atTop.scrollTop + boxAtTop.y - atTop.visibleTop - 60));
  await waitForFrames(page, 4);
  const beforeAlreadyFits = (await readThreadScroller(page))!;
  const upperBoxBefore = (await upperThoughtToggle.boundingBox())!;
  expect(upperBoxBefore.y).toBeLessThan(
    (beforeAlreadyFits.visibleTop + beforeAlreadyFits.visibleBottom) / 2
  );

  await upperThoughtToggle.click();
  await expect(
    upperReply.getByText('Verify region normalization before changing TTL defaults.')
  ).toBeVisible();
  await page.waitForTimeout(200);
  const afterAlreadyFits = (await readThreadScroller(page))!;
  expect(afterAlreadyFits.scrollTop).toBe(beforeAlreadyFits.scrollTop);
  await upperThoughtToggle.click();
  await page.waitForTimeout(100);
  expect((await readThreadScroller(page))!.scrollTop).toBe(beforeAlreadyFits.scrollTop);

  // 2. Huge 80-paragraph Thought for ... on the last message: clamps toggle near visibleTop + 8.
  await openThread(world.hugeRoot);
  const hugeReply = await waitForThreadAtBottom(page, world.HUGE_ANSWER);
  const hugeToggle = hugeReply.getByRole('button', { name: 'Thought for 42 s' });
  const beforeHuge = (await readThreadScroller(page))!;
  await hugeToggle.click();
  await expect(hugeReply.getByText('Paragraph 1:')).toBeVisible();
  await expect
    .poll(async () => {
      const m = await readThreadScroller(page);
      const toggleBox = await hugeToggle.boundingBox();
      if (!m || !toggleBox) return false;
      return (
        m.scrollTop > beforeHuge.scrollTop + 50 && Math.abs(toggleBox.y - (m.visibleTop + 8)) <= 6
      );
    })
    .toBe(true);
  const hugeMetrics = (await readThreadScroller(page))!;
  const lastParagraphBox = await hugeReply.getByText('Paragraph 80:').boundingBox();
  expect(lastParagraphBox).not.toBeNull();
  expect(lastParagraphBox!.y).toBeGreaterThan(hugeMetrics.visibleBottom + 300);
  await shot(page, 'long-thinking-open');

  await hugeToggle.click();
  await expect(hugeReply.getByText('Paragraph 1:')).toHaveCount(0);
  await waitForFrames(page, 4);
  const collapsedHugeBox = (await hugeToggle.boundingBox())!;
  const afterHugeCollapse = (await readThreadScroller(page))!;
  expect(collapsedHugeBox.y).toBeGreaterThanOrEqual(afterHugeCollapse.visibleTop - 2);
  expect(collapsedHugeBox.y + collapsedHugeBox.height).toBeLessThanOrEqual(
    afterHugeCollapse.visibleBottom + 2
  );

  // 3. Worked for ... (FinishedWorkFold) with 280ms animation enabled + mid-animation wheel cancel.
  await openThread(world.workRoot);
  const workReply = await waitForThreadAtBottom(page, world.WORK_ANSWER);
  const workToggle = workReply.locator('button[data-work-fold]');
  const workPanel = workToggle.locator('xpath=following-sibling::div[1]');
  await expect(workToggle).toBeVisible();

  const beforeWork = (await readThreadScroller(page))!;
  await workToggle.click();
  await expect(workPanel).toBeVisible();
  // Wait for the 280ms opening animation to settle.
  await expect(workReply.locator('[data-motion]')).toHaveCount(0, { timeout: 5000 });
  await expect
    .poll(async () => {
      const m = await readThreadScroller(page);
      const panelBox = await workPanel.boundingBox();
      const toggleBox = await workToggle.boundingBox();
      if (!m || !panelBox || !toggleBox) return false;
      const fitsAboveComposer = panelBox.y + panelBox.height <= m.visibleBottom + 2;
      const clampedAtTop = Math.abs(toggleBox.y - (m.visibleTop + 8)) <= 6;
      return m.scrollTop > beforeWork.scrollTop && (fitsAboveComposer || clampedAtTop);
    })
    .toBe(true);
  await shot(page, 'worked-for-open');

  // Collapse and wait for the closing animation to finish, then re-open and wheel mid-animation.
  await workToggle.click();
  await expect(workPanel).toHaveCount(0, { timeout: 5000 });
  const scrollerAfterClose = (await readThreadScroller(page))!;
  await setThreadScrollTop(page, scrollerAfterClose.scrollHeight);
  await waitForFrames(page, 4);

  const toggleBox = (await workToggle.boundingBox())!;
  const beforeWheelTest = (await readThreadScroller(page))!;
  await page.mouse.move(toggleBox.x + toggleBox.width / 2, toggleBox.y + toggleBox.height / 2);
  await workToggle.click();
  await expect(workReply.locator('[data-motion="opening"]')).toHaveCount(1);
  await page.mouse.wheel(0, -240);
  await waitForFrames(page, 4);
  const duringAnimAfterWheel = (await readThreadScroller(page))!;
  await expect(workReply.locator('[data-motion]')).toHaveCount(0, { timeout: 5000 });
  await page.waitForTimeout(120);
  const afterAnimAfterWheel = (await readThreadScroller(page))!;

  expect(afterAnimAfterWheel.scrollTop).toBeLessThan(beforeWheelTest.scrollTop - 40);
  expect(afterAnimAfterWheel.scrollTop).toBeLessThanOrEqual(duringAnimAfterWheel.scrollTop + 4);
});
