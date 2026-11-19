import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, registerAgentAccount, sendRoomMessage } from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// An agent reply's thinking shows where it happened: the bulb on the reasoning line shows every
// segment of `io.mindroom.reasoning.segments` after the run of tool calls it followed, beside the
// cog, which shows the runs on their own. Each open segment has a rail and a "Hide thinking"
// button, which hide them all and give the focus to the bulb. A closed bulb shows none, also while
// the model writes one; an open one labels it as being written until the reply moves past it.
// Set E2E_SCREENSHOT_DIR=<directory> to save the closed, bulb and timeline states.
const PASSWORD = 'inline-thinking-spec-password';
const RUN = Date.now().toString(36);
const SCREENSHOT = process.env.E2E_SCREENSHOT_DIR;

const SEG1 = 'The date test fails. Read the parser before touching it.';
const SEG2 = 'parseDate drops the offset before it compares. Fix that, then run the suite.';
const SEG3 = 'All 42 tests pass now. Answer briefly.';
const BETWEEN = 'parseDate drops the UTC offset; I will keep it and compare instants.';
const DONE = 'Done.';
// A thought taller than any window, whose end button is far below its bulb.
const LONG_STEPS = Array.from(
  { length: 40 },
  (_, index) => `Step ${index + 1}: check case ${index + 1} of the parser.`
);
const LONG_DONE = 'Every case checked.';

type Tool = { name: string; args: string; result: string };
const READ: Tool = { name: 'read_file', args: 'path=src/date.ts', result: '84 lines' };
const GREP: Tool = { name: 'grep', args: 'pattern=parseDate', result: '3 matches' };
const GREP_TESTS: Tool = {
  name: 'grep',
  args: 'pattern=offset src/date.test.ts',
  result: '1 match',
};
const SHELL: Tool = { name: 'shell', args: 'npm test -- date', result: '42 passed' };

/**
 * MindRoom's content for a reply of paragraphs, tool markers among them (`🔧 \`name\` [n]`), as its
 * Markdown renderer writes it, with the completed tool trace of `tools` in marker order.
 */
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

const marker = (tool: Tool, index: number) => `🔧 \`${tool.name}\` [${index}]`;

/** `io.mindroom.reasoning` text and segments for `pieces`, joined as the backend joins them. */
const reasoning = (pieces: { text: string; afterTool: number; durationMs?: number }[]) => {
  let text = '';
  const segments = pieces.map((piece) => {
    if (text) text += '\n\n';
    const start = text.length;
    text += piece.text;
    return piece.durationMs === undefined
      ? { start, after_tool: piece.afterTool }
      : { start, after_tool: piece.afterTool, duration_ms: piece.durationMs };
  });
  return { text, segments };
};

/**
 * A room with a reader and an agent, and a thread the reader starts. `reply` sends a message of
 * the agent into the thread, `edit` replaces one, and `open` signs the reader in, with tool calls
 * hidden behind the cog as by default, and shows the thread.
 */
const startAgentThread = async (page: Page, name: string, rootBody: string) => {
  const username = `it_${name}_${RUN}`;
  const reader = await registerDisposableUser(username, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, 'coder');
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Date parser fix',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: rootBody,
  });
  const thread = {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  };
  return {
    reply: (content: Record<string, unknown>) =>
      sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
        ...content,
        'm.relates_to': thread,
      }),
    edit: (eventId: string, content: Record<string, unknown>) =>
      sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
        ...content,
        body: `* ${String(content.body)}`,
        'm.new_content': content,
        'm.relates_to': { rel_type: 'm.replace', event_id: eventId },
      }),
    open: async () => {
      await loginWithPassword(page, {
        homeserver: HOMESERVER,
        username,
        password: PASSWORD,
        showToolCalls: false,
      });
      await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    },
  };
};

const replyWith = (page: Page, text: string) =>
  page.locator('[data-message-item]').filter({ hasText: text });

// The lines of the runs of tool calls; the cog is a disclosure too.
const toolRows = (reply: Locator) =>
  reply.locator('[data-message-disclosure]:not([data-tool-calls-fold]) > button');

const top = async (locator: Locator) => (await locator.boundingBox())?.y ?? Number.NaN;

/** Each locator starts below the one before it, once the reply has laid out what it now shows. */
const expectInOrder = (locators: Locator[], names: string[]) =>
  expect(async () => {
    const tops = await Promise.all(locators.map(top));
    tops.slice(1).forEach((y, index) => {
      expect(y, `${names[index + 1]} below ${names[index]}`).toBeGreaterThan(tops[index]!);
    });
  }).toPass({ timeout: 10_000 });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('the bulb shows each thought after the run it followed, beside the cog', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const { reply: sendReply, open } = await startAgentThread(
    page,
    'timeline',
    'The date test fails on main. Can you fix it?'
  );
  await sendReply({
    ...agentReply(
      [marker(READ, 1), marker(GREP, 2), marker(GREP_TESTS, 3), BETWEEN, marker(SHELL, 4), DONE],
      [READ, GREP, GREP_TESTS, SHELL]
    ),
    'io.mindroom.stream_status': 'completed',
    'io.mindroom.reasoning': {
      ...reasoning([
        { text: SEG1, afterTool: 0, durationMs: 5000 },
        { text: SEG2, afterTool: 3, durationMs: 4000 },
        { text: SEG3, afterTool: 4, durationMs: 3000 },
      ]),
      duration_ms: 12_000,
    },
  });
  await sendReply({
    ...agentReply([marker(READ, 1), LONG_DONE], [READ]),
    'io.mindroom.stream_status': 'completed',
    'io.mindroom.reasoning': {
      ...reasoning([
        { text: 'Go through every case.', afterTool: 0, durationMs: 5000 },
        { text: LONG_STEPS.join('\n\n'), afterTool: 1, durationMs: 31_000 },
      ]),
      duration_ms: 36_000,
    },
  });

  await open();
  const reply = replyWith(page, BETWEEN);
  await expect(reply).toHaveCount(1, { timeout: 60_000 });
  const bulb = reply.getByRole('button', { name: 'Thought for 12 s' });
  const cog = reply.locator('[data-tool-calls-fold]').getByRole('button');
  const segments = [SEG1, SEG2, SEG3].map((text) => reply.getByText(text));
  const done = reply.getByText(DONE, { exact: true });
  await page.mouse.move(0, 0);

  // (a) Closed: the reasoning line only, no thinking and no tool rows.
  await expect(bulb).toHaveAttribute('aria-expanded', 'false');
  await expect(cog).toHaveText('4');
  for (const segment of segments) await expect(segment).toHaveCount(0);
  await expect(toolRows(reply)).toHaveCount(0);
  if (SCREENSHOT) await reply.screenshot({ path: `${SCREENSHOT}/inline-thinking-a-closed.png` });

  // (b, e) The bulb with the cog closed: every thought in its place, with its own time, and the
  // runs it followed still hidden behind the cog, which still counts all four calls.
  await bulb.click();
  await expect(bulb).toHaveAttribute('aria-expanded', 'true');
  for (const segment of segments) await expect(segment).toBeVisible();
  await expect(toolRows(reply)).toHaveCount(0);
  await expect(cog).toHaveText('4');
  for (const label of ['Thought for 5 s', 'Thought for 4 s', 'Thought for 3 s']) {
    await expect(reply.getByText(label, { exact: true })).toBeVisible();
  }
  const between = reply.getByText(BETWEEN, { exact: true });
  await expectInOrder(
    [bulb, segments[0]!, segments[1]!, between, segments[2]!, done],
    ['bulb', 'thought 1', 'thought 2', 'text', 'thought 3', 'answer']
  );
  await page.mouse.move(0, 0);
  if (SCREENSHOT) await reply.screenshot({ path: `${SCREENSHOT}/inline-thinking-b-bulb.png` });

  // (c) Both open: thinking and runs read as a timeline.
  await cog.click();
  const rows = toolRows(reply);
  await expect(rows).toHaveCount(2);
  const [firstRun, shellRun] = [rows.nth(0), rows.nth(1)];
  await expect(shellRun).toContainText('shell');
  await firstRun.click();
  const calls = reply
    .locator('[data-message-disclosure]:not([data-tool-calls-fold])')
    .nth(0)
    .locator(':scope > [id]');
  await expect(calls).toBeVisible();
  // Its calls, in the order they ran.
  await expect(calls.getByText(/^(read_file|grep|shell)$/)).toHaveText([
    'read_file',
    'grep',
    'grep',
  ]);
  await expectInOrder(
    [segments[0]!, firstRun, calls, segments[1]!, between, shellRun, segments[2]!, done],
    ['thought 1', 'run', 'its calls', 'thought 2', 'text', 'shell', 'thought 3', 'answer']
  );
  await firstRun.click();
  await page.mouse.move(0, 0);
  if (SCREENSHOT) await reply.screenshot({ path: `${SCREENSHOT}/inline-thinking-c-timeline.png` });

  // (d) A rail hides every thought and gives the focus to the bulb; the runs stay.
  const hideButtons = reply.getByRole('button', { name: 'Hide thinking' });
  await expect(hideButtons).toHaveCount(6);
  await hideButtons.nth(2).click();
  await expect(bulb).toHaveAttribute('aria-expanded', 'false');
  await expect(bulb).toBeFocused();
  for (const segment of segments) await expect(segment).toHaveCount(0);
  await expect(hideButtons).toHaveCount(0);
  await expect(toolRows(reply)).toHaveCount(2);

  // The end button of a thought taller than the window, its bulb scrolled away far above it, does
  // the same and brings the bulb back into view.
  await page.setViewportSize({ width: 1280, height: 360 });
  const long = replyWith(page, LONG_DONE);
  const longBulb = long.getByRole('button', { name: 'Thought for 36 s' });
  await longBulb.click();
  await expect(long).toContainText('Step 40:');
  const lastEnd = long
    .getByRole('button', { name: 'Hide thinking' })
    .filter({ hasText: 'Hide thinking' })
    .last();
  await lastEnd.scrollIntoViewIfNeeded();
  await expect(lastEnd).toBeInViewport();
  await expect(longBulb).not.toBeInViewport();
  await lastEnd.click();
  await expect(longBulb).toHaveAttribute('aria-expanded', 'false');
  await expect(longBulb).toBeFocused();
  await expect(longBulb).toBeInViewport();
  await expect(long).not.toContainText('Step 40:');
});

test('thinking between two calls in a row splits their run, and old replies think at the top', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const { reply: sendReply, open } = await startAgentThread(
    page,
    'split',
    'Where is parseDate used?'
  );
  const splitAnswer = 'parseDate has three callers.';
  await sendReply({
    ...agentReply([marker(READ, 1), marker(GREP, 2), splitAnswer], [READ, GREP]),
    'io.mindroom.stream_status': 'completed',
    'io.mindroom.reasoning': {
      ...reasoning([
        { text: 'Find the file first.', afterTool: 0, durationMs: 2000 },
        { text: 'Now search for its callers.', afterTool: 1, durationMs: 2000 },
      ]),
      duration_ms: 4000,
    },
  });
  // (f) A reply from before segments: all its reasoning is one thought at the top.
  const oldAnswer = 'The old parser was fixed in March.';
  const OLD = 'Check the history of the parser.\n\nThen say when it changed.';
  await sendReply({
    ...agentReply([marker(SHELL, 1), oldAnswer], [SHELL]),
    'io.mindroom.stream_status': 'completed',
    'io.mindroom.reasoning': { text: OLD, duration_ms: 6000 },
  });

  await open();
  const split = replyWith(page, splitAnswer);
  await expect(split).toHaveCount(1, { timeout: 60_000 });
  const splitBulb = split.getByRole('button', { name: 'Thought for 4 s' });
  await split.locator('[data-tool-calls-fold]').getByRole('button').click();
  await expect(toolRows(split)).toHaveCount(1);
  await splitBulb.click();
  const second = split.getByText('Now search for its callers.');
  await expect(second).toBeVisible();
  await expect(toolRows(split)).toHaveCount(2);
  await expectInOrder(
    [
      split.getByText('Find the file first.'),
      toolRows(split).nth(0),
      second,
      toolRows(split).nth(1),
    ],
    ['thought 1', 'read_file', 'thought 2', 'grep']
  );
  await expect(toolRows(split).nth(0)).toContainText('read_file');
  await expect(toolRows(split).nth(1)).toContainText('grep');
  await splitBulb.click();
  await expect(second).toHaveCount(0);
  await expect(toolRows(split)).toHaveCount(1);

  const old = replyWith(page, oldAnswer);
  const oldBulb = old.getByRole('button', { name: 'Thought for 6 s' });
  await expect(oldBulb).toHaveAttribute('aria-expanded', 'false');
  await old.locator('[data-tool-calls-fold]').getByRole('button').click();
  await oldBulb.click();
  const oldThought = old.getByText('Check the history of the parser.');
  await expect(oldThought).toBeVisible();
  await expect(old.getByText('Then say when it changed.')).toBeVisible();
  await expect(old.getByText('Thought', { exact: true })).toHaveCount(1);
  await expect(old.getByRole('button', { name: 'Hide thinking' })).toHaveCount(2);
  await expectInOrder(
    [oldBulb, oldThought, toolRows(old), old.getByText(oldAnswer)],
    ['bulb', 'thought', 'shell', 'answer']
  );
  if (SCREENSHOT) {
    await page.mouse.move(0, 0);
    await old.screenshot({ path: `${SCREENSHOT}/inline-thinking-f-old.png` });
  }
});

test('a streaming reply shows the thought it writes only in an open bulb', async ({ page }) => {
  test.setTimeout(180_000);
  const {
    reply: sendReply,
    edit,
    open,
  } = await startAgentThread(page, 'live', 'Why does the date test fail?');
  const tools = [READ, GREP];
  const body = [marker(READ, 1), marker(GREP, 2)];
  const first = 'Read the parser, then find its callers.';
  const writing = 'Three callers, and only one passes an offset';
  const live = (reasoningText: string, paragraphs: string[], status = 'streaming') => {
    const { text, segments } = reasoning([
      { text: first, afterTool: 0 },
      { text: reasoningText, afterTool: 2 },
    ]);
    return {
      ...agentReply(paragraphs, tools),
      'io.mindroom.stream_status': status,
      'io.mindroom.live_reasoning': text,
      'io.mindroom.live_reasoning_segments': segments,
    };
  };
  const replyId = await sendReply(live('Three', body));

  await open();
  const reply = page.locator('[data-message-item]').filter({
    has: page.getByRole('button', { name: 'Thinking', exact: true }),
  });
  await expect(reply).toHaveCount(1, { timeout: 60_000 });
  const bulb = reply.getByRole('button', { name: 'Thinking', exact: true });
  await expect(bulb).toHaveAttribute('aria-expanded', 'false');

  // (g) The thought grows on screen, and the comet laps the bulb: the closed bulb shows no thought.
  await edit(replyId, live(`${writing},`, body));
  await expect(bulb.locator('[data-thinking]')).toHaveCount(1, { timeout: 30_000 });
  const thought = reply.getByText(writing);
  await expect(thought).toHaveCount(0);
  await expect(reply.getByText(first)).toHaveCount(0);
  await expect(reply.getByRole('button', { name: 'Hide thinking' })).toHaveCount(0);

  // Opened, the bulb shows the thought before it and the one being written, as such.
  await bulb.click();
  await expect(thought).toBeVisible();
  await expect(reply.getByText(first)).toBeVisible();
  const thoughtLabels = reply.getByText('Thought', { exact: true });
  await expect(thoughtLabels).toHaveCount(1);
  await page.mouse.move(0, 0);
  if (SCREENSHOT) await reply.screenshot({ path: `${SCREENSHOT}/inline-thinking-g-live.png` });

  // The model pauses longer than the bulb's comet laps: the thought is still being written.
  await page.waitForTimeout(3000);
  await expect(thoughtLabels).toHaveCount(1);

  // The answer starts: the thought is a thought now.
  const answer = 'The test passes a date with an offset.';
  await edit(replyId, live(`${writing},`, [...body, answer]));
  await expect(reply.getByText(answer)).toBeVisible({ timeout: 30_000 });
  await expect(thoughtLabels).toHaveCount(2);
  await expect(thought).toBeVisible();
});
