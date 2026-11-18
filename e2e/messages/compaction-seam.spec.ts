import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, registerAgentAccount, sendRoomMessage } from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// Each history compaction is a quiet seam row in the agent reply, at the spot where it ran
// (`io.mindroom.compactions`, placed by `after_tool`): it splits a run of tool calls in two,
// stays between the texts while the cog hides the calls, folds into the work of a long finished
// reply, sits at the top of a reply compacted before its first model request (also while the
// reply is still the pending placeholder), and shows its state. Old and manual
// `io.mindroom.compaction` notices are the same row, on their own. A hover opens the card.
// Set E2E_SCREENSHOT_DIR=<directory> to save desktop and 390 px phone shots, dark and light.
const PASSWORD = 'compaction-seam-spec-password';
const RUN = Date.now().toString(36);
const SCREENSHOT = process.env.E2E_SCREENSHOT_DIR;

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

const CHECK = 'I’ll check what is merged and what is live before I answer.';
const CHECKING = 'All four client PRs and both backend PRs are merged. Checking what is live now.';
const TLDR = 'TL;DR: All fixes are merged. The backend ones need your prod restart.';
const TWO = 'Yes. #503 merged as cd4613d6f and releases automatically.';
const STATES = 'The summary did not finish, so I kept going.';
const PRE = 'Yes. #503 merged and releases automatically.';
const WORKED = 'Every caller now passes the offset through.';
const WORKED_BETWEEN = 'The first half of the callers is fixed; now the rest.';

type Tool = { name: string; args: string; result: string };
const tool = (name: string, args: string, result: string): Tool => ({ name, args, result });
const BASH_503 = tool(
  'bash',
  'gh pr view 503 --repo mindroom-ai/mindroom-chat --json state,mergeCommit',
  '{"state":"MERGED","mergeCommit":{"oid":"cd4613d6f"}}'
);
const BASH_4075 = tool(
  'bash',
  'gh pr view 4075 --repo mindroom-ai/mindroom --json state',
  '{"state":"MERGED"}'
);
const READ = tool('read_file', 'perf/mem/SUMMARY.md', '# Memory probe, 2026-11-16');
const CURL = tool('bash', 'curl -s https://chat.mindroom.chat/version.json', '{"version":250}');
const GREP = tool('grep', 'pattern=parseDate', '3 matches');

/**
 * MindRoom's content for a reply of paragraphs, tool markers among them (`🔧 \`name\` [n]`), as
 * its Markdown renderer writes it, with the completed tool trace of `tools` in marker order.
 */
const agentReply = (paragraphs: string[], tools: Tool[]) => ({
  msgtype: 'm.text',
  body: paragraphs.join('\n\n'),
  format: 'org.matrix.custom.html',
  formatted_body: paragraphs
    .map((paragraph) => `<p>${paragraph.replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`)
    .join('\n'),
  'io.mindroom.tool_trace': {
    version: 2,
    events: tools.map((call) => ({
      type: 'tool_call_completed',
      tool_name: call.name,
      args_preview: call.args,
      result_preview: call.result,
    })),
  },
});

/** The marker lines of `tools`, numbered from `from`. */
const markers = (tools: Tool[], from = 1) =>
  tools.map((call, index) => `🔧 \`${call.name}\` [${from + index}]`);

const finished = { 'io.mindroom.stream_status': 'completed' };
const thought = (seconds: number) => ({
  'io.mindroom.reasoning': {
    text: 'Check the PRs, then what is live.',
    duration_ms: seconds * 1000,
  },
});

const STARTED = Date.now() - 10 * 60_000;

/** A compaction entry as the backend writes it, successful unless `fields` say otherwise. */
const compaction = (id: string, afterTool: number, fields: Record<string, unknown> = {}) => ({
  id,
  phase: afterTool === 0 ? 'pre_turn' : 'mid_turn',
  after_tool: afterTool,
  status: 'success',
  started_at: STARTED,
  duration_ms: 8400,
  summary_model: 'haiku',
  before_tokens: 366_804,
  after_tokens: 6336,
  history_budget_tokens: 351_792,
  runs_before: 24,
  compacted_run_count: 24,
  ...fields,
});

/** What a compaction that did not finish keeps: no tokens after it, no runs folded. */
const unfinished = (status: string, reason: string, durationMs: number) => ({
  status,
  failure_reason: reason,
  duration_ms: durationMs,
  after_tokens: undefined,
  compacted_run_count: undefined,
});

/** A thread the reader starts in a room with an agent: `reply` and `say` send in it. */
const ROOT = 'Okay, so is everything now addressed from this thread?';

/** Scene 1: a finished reply compacted mid-turn, after tool call 3 of a run of three. */
const midTurnReply = () => ({
  ...agentReply(
    [CHECK, ...markers([BASH_503, BASH_4075, READ]), CHECKING, ...markers([CURL, CURL], 4), TLDR],
    [BASH_503, BASH_4075, READ, CURL, CURL]
  ),
  ...finished,
  ...thought(7),
  'io.mindroom.compactions': [compaction('mid', 3)],
});

/** The screenshots' themes and sizes, in the order they are taken. */
const SHOTS = [
  ['desktop-dark', 'dark-theme', DESKTOP],
  ['phone-dark', 'dark-theme', PHONE],
  ['desktop-light', 'light-theme', DESKTOP],
  ['phone-light', 'light-theme', PHONE],
] as const;

const startThread = async (name: string, rootBody: string) => {
  const username = `cs_${name}_${RUN}`;
  const reader = await registerDisposableUser(username, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, 'devagent');
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Memory leak follow-up',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: rootBody,
  });
  const inThread = {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  };
  const send = (token: string, content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, token, roomId, { ...content, 'm.relates_to': inThread });
  return {
    username,
    url: `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`,
    reply: (content: Record<string, unknown>) => send(agent.accessToken, content),
    say: (body: string) => send(reader.accessToken, { msgtype: 'm.text', body }),
  };
};

const replyWith = (page: Page, text: string) =>
  page.locator('[data-message-item]').filter({ hasText: text });

// The lines of the runs of tool calls; the cog is a disclosure too.
const toolRows = (reply: Locator) =>
  reply.locator('[data-message-disclosure]:not([data-tool-calls-fold]) > button');

const seamsIn = (scope: Locator) => scope.locator('[data-compaction-seam]');

const top = async (locator: Locator) => (await locator.boundingBox())?.y ?? Number.NaN;

/** Each locator starts below the one before it, once the reply has laid out what it shows. */
const expectInOrder = (locators: Locator[], names: string[]) =>
  expect(async () => {
    const tops = await Promise.all(locators.map(top));
    tops.slice(1).forEach((y, index) => {
      expect(y, `${names[index + 1]} below ${names[index]}`).toBeGreaterThan(tops[index]!);
    });
  }).toPass({ timeout: 10_000 });

/** Stores the theme and the tool call setting, then loads the page again with them. */
const applySettings = async (page: Page, themeId: string, showToolCalls: boolean) => {
  await page.evaluate(
    ([theme, show]) => {
      const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
      localStorage.setItem(
        'settings',
        JSON.stringify({ ...settings, useSystemTheme: false, themeId: theme, showToolCalls: show })
      );
    },
    [themeId, showToolCalls] as const
  );
  await page.reload();
};

/** Brings `target` to the middle of the timeline, once the client has caught up with the server. */
const centre = async (page: Page, target: Locator) => {
  await expect(page.getByText('Catching up...')).toHaveCount(0, { timeout: 60_000 });
  await target.evaluate((element) => element.scrollIntoView({ block: 'center' }));
};

/** Waits until `target` shows in the window and stays put between two readings of its position. */
const expectSettled = async (target: Locator) => {
  await expect(target).toBeInViewport();
  let last: number | undefined;
  await expect
    .poll(
      async () => {
        const y = await top(target);
        const settled = y === last;
        last = y;
        return settled;
      },
      { intervals: [100, 100, 200], timeout: 10_000 }
    )
    .toBe(true);
};

/**
 * The WCAG contrast of `target`'s color on the first opaque background behind it, faded by the
 * opacity of every layer between them, once its transition ends.
 */
const expectContrast = (target: Locator, least: number) =>
  expect
    .poll(() =>
      target.evaluate((element) => {
        // `rgb(…)`/`rgba(…)` in 0-255, or `color(srgb …)` (a color-mix) in 0-1.
        const rgba = (value: string) => {
          const parts = (value.match(/[\d.]+/g) ?? []).map(Number);
          const scale = value.startsWith('color(') ? 255 : 1;
          return [parts[0]! * scale, parts[1]! * scale, parts[2]! * scale, parts[3] ?? 1];
        };
        const fg = rgba(getComputedStyle(element).color);
        let alpha = fg[3]!;
        let behind: Element | null = element;
        let bg = rgba(getComputedStyle(element).backgroundColor);
        while (bg[3] === 0 && behind?.parentElement) {
          alpha *= Number(getComputedStyle(behind).opacity);
          behind = behind.parentElement;
          bg = rgba(getComputedStyle(behind).backgroundColor);
        }
        const shown = [0, 1, 2].map((i) => fg[i]! * alpha + bg[i]! * (1 - alpha));
        const luminance = (channels: number[]) => {
          const [r, g, b] = channels.map((channel) => {
            const v = channel / 255;
            return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
        };
        const [high, low] = [luminance(shown), luminance(bg)].sort((x, y) => y - x);
        return (high! + 0.05) / (low! + 0.05);
      })
    )
    .toBeGreaterThanOrEqual(least);

/** The color an element shows its text in, and the opacity of it and every layer above it. */
const shownColor = (target: Locator) =>
  target.evaluate((element) => {
    let opacity = 1;
    for (let layer: Element | null = element; layer; layer = layer.parentElement) {
      opacity *= Number(getComputedStyle(layer).opacity);
    }
    return { color: getComputedStyle(element).color, opacity };
  });

/** Saves the window, `target` at the middle of the timeline once the timeline stopped moving. */
const shot = async (page: Page, target: Locator, name: string) => {
  if (!SCREENSHOT) return;
  await centre(page, target);
  await expectSettled(target);
  await page.screenshot({ path: `${SCREENSHOT}/compaction-seam-${name}.png` });
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('each compaction is a seam at its spot in the reply, in each of its states', async ({
  page,
}) => {
  test.setTimeout(600_000);
  await page.setViewportSize(DESKTOP);
  const thread = await startThread('scenes', ROOT);
  // (1) Mid-turn, after tool call 3 of a run of three.
  await thread.reply(midTurnReply());
  // (5) Two compactions in one run of eleven calls: after calls 4 and 9.
  const eleven = Array.from({ length: 11 }, (_, index) => (index % 3 === 2 ? READ : BASH_503));
  await thread.reply({
    ...agentReply([...markers(eleven), TWO], eleven),
    ...finished,
    ...thought(21),
    'io.mindroom.compactions': [
      compaction('first', 4),
      compaction('second', 9, { before_tokens: 351_920, after_tokens: 9870 }),
    ],
  });
  // (7) The compact command's notice, and an old automatic notice from before statuses.
  await thread.say('compact this thread');
  const manualId = await thread.reply({
    msgtype: 'm.notice',
    body: '📦 Compacted 18 runs: 212,431 → 5,120 / 351,792 history budget',
    'io.mindroom.compaction': {
      version: 3,
      mode: 'manual',
      status: 'success',
      before_tokens: 212_431,
      after_tokens: 5120,
      history_budget_tokens: 351_792,
      runs_before: 18,
      compacted_run_count: 18,
      summary_model: 'haiku',
      duration_ms: 6100,
    },
  });
  const oldId = await thread.reply({
    msgtype: 'm.notice',
    body: '📦 Compacted 12 runs: 301,002 → 7,340 / 351,792 history budget',
    'io.mindroom.compaction': {
      version: 2,
      before_tokens: 301_002,
      after_tokens: 7340,
      history_budget_tokens: 351_792,
    },
  });
  // (6) The states that did not finish: failed, timed out, and one still running on a reply that
  // ended, which reads as interrupted.
  await thread.reply({
    ...agentReply([...markers([GREP, GREP, GREP]), STATES], [GREP, GREP, GREP]),
    ...finished,
    'io.mindroom.compactions': [
      compaction(
        'failed',
        1,
        unfinished('failed', 'The summary model returned an error (529 overloaded).', 31_200)
      ),
      compaction('timeout', 2, unfinished('timeout', 'No summary after 120 s.', 120_000)),
      compaction('cut', 3, {
        status: 'running',
        after_tokens: undefined,
        duration_ms: undefined,
        compacted_run_count: undefined,
      }),
    ],
  });
  // (4) Compacted before the reply's first model request.
  await thread.reply({
    ...agentReply([...markers([BASH_503, CURL]), PRE], [BASH_503, CURL]),
    ...finished,
    ...thought(4),
    'io.mindroom.compactions': [
      compaction('pre', 0, { before_tokens: 348_112, after_tokens: 42_016 }),
    ],
  });
  // (3) A long finished reply: its work, the seam with it, folds behind "Worked".
  const firstHalf = Array.from({ length: 40 }, () => GREP);
  const secondHalf = Array.from({ length: 36 }, () => READ);
  await thread.reply({
    ...agentReply(
      [...markers(firstHalf), WORKED_BETWEEN, ...markers(secondHalf, 41), WORKED],
      [...firstHalf, ...secondHalf]
    ),
    ...finished,
    'io.mindroom.ai_run': { version: 1, status: 'completed' },
    'io.mindroom.compactions': [compaction('worked', 20)],
  });
  // (4) Still the pending placeholder while the summary is written: running, ticking.
  await thread.reply({
    msgtype: 'm.text',
    body: 'Thinking...',
    'io.mindroom.stream_status': 'pending',
    'io.mindroom.compactions': [
      compaction('pending', 0, {
        status: 'running',
        started_at: Date.now() - 12_000,
        after_tokens: undefined,
        duration_ms: undefined,
        compacted_run_count: 9,
        runs_remaining: 15,
      }),
    ],
  });

  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: thread.username,
    password: PASSWORD,
  });
  await page.goto(thread.url);
  await page.mouse.move(0, 0);

  // (1) The seam splits the reply's runs at tool call 3 and stays above the text after it.
  const mid = replyWith(page, CHECKING);
  await expect(mid).toHaveCount(1, { timeout: 60_000 });
  const midSeam = seamsIn(mid);
  await expect(midSeam).toHaveAttribute('data-state', 'success');
  await expect(midSeam).toHaveText('Compacted context · 367k → 6k tokens');
  await expect(toolRows(mid)).toHaveCount(2);
  await expectInOrder(
    [
      mid.getByText(CHECK),
      toolRows(mid).nth(0),
      midSeam,
      mid.getByText(CHECKING),
      toolRows(mid).nth(1),
    ],
    ['text', 'first run', 'seam', 'next text', 'second run']
  );
  await expect(toolRows(mid).nth(0)).toContainText('3');

  // The card, on a hover: what the compaction did, in full numbers.
  const card = page.getByRole('tooltip');
  await midSeam.getByRole('button').hover();
  await expect(card).toContainText('Context compacted');
  await expect(card).toContainText('mid-turn');
  await expect(card).toContainText('Between two model requests, after tool call 3.');
  await expect(card).toContainText('366,804 → 6,336 tokens');
  await expect(card).toContainText('360,468 tokens (98%)');
  await expect(card).toContainText('24 runs into 1 summary');
  await expect(card).toContainText('haiku in 8.4 s');
  await page.mouse.move(0, 0);
  await expect(card).toHaveCount(0);

  // (5) Two seams, each at its own spot: runs of 4, 5 and 2 calls.
  const two = replyWith(page, TWO);
  await expect(seamsIn(two)).toHaveCount(2);
  for (const index of [0, 1]) {
    await expect(seamsIn(two).nth(index)).toHaveAttribute('data-state', 'success');
  }
  await expect(seamsIn(two).nth(1)).toHaveText('Compacted context · 352k → 10k tokens');
  await expect(toolRows(two)).toHaveCount(3);
  await expectInOrder(
    [
      toolRows(two).nth(0),
      seamsIn(two).nth(0),
      toolRows(two).nth(1),
      seamsIn(two).nth(1),
      toolRows(two).nth(2),
    ],
    ['4 calls', 'seam', '5 calls', 'seam', '2 calls']
  );

  // (7) The notices: a seam row each, without the agent's avatar or name.
  for (const [id, label] of [
    [manualId, 'Compacted on request · 212k → 5k tokens'],
    [oldId, 'Compacted context · 301k → 7k tokens'],
  ] as const) {
    const row = page.locator(`[data-message-id="${id}"]`);
    await expect(seamsIn(row)).toHaveText(label);
    await expect(seamsIn(row)).toHaveAttribute('data-state', 'success');
    await expect(row.locator('[data-message-sender-line], img')).toHaveCount(0);
    await expect(row).not.toContainText('📦');
  }

  // (6) Failed, timed out, and interrupted, each after its own call.
  const states = replyWith(page, STATES);
  await expect(seamsIn(states)).toHaveCount(3);
  await expect(seamsIn(states).nth(0)).toHaveAttribute('data-state', 'failed');
  await expect(seamsIn(states).nth(1)).toHaveAttribute('data-state', 'timeout');
  await expect(seamsIn(states).nth(2)).toHaveAttribute('data-state', 'interrupted');
  await expect(seamsIn(states).nth(0)).toHaveText('Compaction failed');
  await expect(seamsIn(states).nth(1)).toHaveText('Compaction timed out');
  await expect(seamsIn(states).nth(2)).toHaveText('Compaction interrupted');
  // In a reply that reads the other way the row keeps the interface's direction, as tool rows do.
  expect(
    await seamsIn(states)
      .nth(0)
      .evaluate((row) => {
        const reply = row.parentElement!;
        reply.setAttribute('dir', 'rtl');
        const shown = [getComputedStyle(reply).direction, getComputedStyle(row).direction];
        reply.removeAttribute('dir');
        return shown;
      })
  ).toEqual(['rtl', 'ltr']);
  await expectInOrder(
    [
      toolRows(states).nth(0),
      seamsIn(states).nth(0),
      toolRows(states).nth(1),
      seamsIn(states).nth(1),
      toolRows(states).nth(2),
      seamsIn(states).nth(2),
      states.getByText(STATES),
    ],
    ['call 1', 'failed', 'call 2', 'timed out', 'call 3', 'interrupted', 'answer']
  );

  // (4) Before the reply: the seam at its top, above its calls.
  const pre = replyWith(page, PRE);
  await expect(seamsIn(pre)).toHaveText('Compacted before replying · 348k → 42k tokens');
  await expect(seamsIn(pre)).toHaveAttribute('data-state', 'success');
  await expectInOrder([seamsIn(pre), toolRows(pre).nth(0)], ['seam', 'calls']);

  // (3) Folded behind "Worked": no seam until the fold opens, then inside the work.
  const worked = replyWith(page, WORKED);
  const workedRow = worked.getByRole('button', { name: /^Worked/ });
  await expect(workedRow).toHaveAttribute('aria-expanded', 'false');
  await expect(seamsIn(worked)).toHaveCount(0);
  await workedRow.click();
  await expect(seamsIn(worked)).toHaveCount(1);
  await expect(seamsIn(worked)).toHaveAttribute('data-state', 'success');
  await expectInOrder(
    [
      workedRow,
      toolRows(worked).nth(0),
      seamsIn(worked),
      toolRows(worked).nth(1),
      worked.getByText(WORKED_BETWEEN),
      worked.getByText(WORKED, { exact: true }),
    ],
    ['worked', '20 calls', 'seam', '20 calls', 'text', 'answer']
  );
  await workedRow.click();
  await expect(seamsIn(worked)).toHaveCount(0);

  // (4) The pending placeholder: running at its top, the seconds ticking.
  const pending = page
    .locator('[data-message-item]')
    .filter({ has: page.locator('[data-compaction-seam][data-state="running"]') });
  await expect(pending).toHaveCount(1);
  const running = seamsIn(pending);
  await expect(running).toContainText(/Compacting context… \d+ s/);
  const before = await running.textContent();
  await expect(running).not.toHaveText(before ?? '', { timeout: 5000 });
  await running.getByRole('button').hover();
  await expect(card).toContainText('24 runs, 9 done');
  await expect(card).toContainText('before the reply');
  await page.mouse.move(0, 0);

  // A row's words read as its reply's text does, in every state: its color, faded as the text is.
  // Its state shows on the icon, which stays visible (3:1) at rest, highlighted and in the card,
  // in the themes where the state colors come closest to their background.
  for (const themeId of ['catppuccinLatte-theme', 'silver-theme', 'orange-theme', 'dark-theme']) {
    await applySettings(page, themeId, true);
    await expect(replyWith(page, CHECKING)).toHaveCount(1, { timeout: 60_000 });
    for (const text of [CHECKING, STATES]) {
      const answer = replyWith(page, text);
      const words = seamsIn(answer).first().getByRole('button');
      await centre(page, words);
      expect(await shownColor(words)).toEqual(await shownColor(answer.getByText(text)));
    }
    const rows = [CHECKING, STATES].map((text) => seamsIn(replyWith(page, text)).first());
    for (const row of [...rows, seamsIn(pending)]) {
      await centre(page, row);
      const icon = row.locator('svg').first();
      await expectContrast(icon, 3);
      await row.getByRole('button').hover();
      await expect(card).toBeVisible();
      await expectContrast(icon, 3);
      await expectContrast(card.locator('svg').first(), 3);
      await page.mouse.move(0, 0);
    }
  }

  // A short window with large text: the card stays inside it, and its rest scrolls. The latest
  // reply's seam, as the timeline keeps only the rows near the window.
  await page.setViewportSize({ width: 640, height: 300 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  const latestRow = seamsIn(page.locator('[data-message-item]').last());
  await centre(page, latestRow);
  await latestRow.getByRole('button').hover();
  await expect(card).toContainText('History');
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(300);
  expect(await card.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await page.mouse.move(0, 0);
  await expect(card).toHaveCount(0);
  // From the keyboard the card takes focus, so its keys scroll it to its last row; Escape gives
  // focus back to the row.
  const latestWords = latestRow.getByRole('button');
  await latestWords.focus();
  await page.keyboard.press('Enter');
  await expect(card).toBeFocused();
  const lastRow = card.locator('dd').last();
  await expect(lastRow).not.toBeInViewport();
  await page.keyboard.press('PageDown');
  await page.keyboard.press('End');
  await expect(lastRow).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(latestWords).toBeFocused();
  // Tab in the card, which lives in the body, goes on from the row in timeline order.
  await page.keyboard.press('Enter');
  await expect(card).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(card).toHaveCount(0);
  expect(
    await latestWords.evaluate((row) => {
      const next = document.activeElement;
      return (
        !!next &&
        next !== row &&
        !!next.closest('[data-message-item]') &&
        !!(row.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
    })
  ).toBe(true);
  await page.keyboard.press('Shift+Tab');
  await expect(latestWords).toBeFocused();
  await latestWords.blur();
  await expect(card).toHaveCount(0);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  await page.setViewportSize(DESKTOP);

  if (!SCREENSHOT) return;
  for (const [name, themeId, size] of SHOTS) {
    await page.setViewportSize(size);
    await applySettings(page, themeId, true);
    await expect(replyWith(page, CHECKING)).toHaveCount(1, { timeout: 60_000 });
    const seam = seamsIn(replyWith(page, CHECKING));
    await centre(page, seam);
    await seam.getByRole('button').hover();
    await expect(card).toBeVisible();
    await shot(page, seam, `${name}-1-mid-card`);
    await page.mouse.move(0, 0);
    await shot(page, seamsIn(replyWith(page, TWO)).nth(1), `${name}-5-two`);
    await shot(page, seamsIn(page.locator(`[data-message-id="${oldId}"]`)), `${name}-7-notices`);
    await shot(page, seamsIn(replyWith(page, STATES)).nth(2), `${name}-6-states`);
    const failedSeam = seamsIn(replyWith(page, STATES)).nth(0);
    await centre(page, failedSeam);
    await failedSeam.getByRole('button').hover();
    await expect(card).toContainText('529 overloaded');
    await shot(page, failedSeam, `${name}-6-failed-card`);
    await page.mouse.move(0, 0);
    await shot(page, seamsIn(page.locator('[data-message-item]').last()), `${name}-4-pre-turn`);
    const fold = replyWith(page, WORKED).getByRole('button', { name: /^Worked/ });
    await fold.click();
    await shot(page, seamsIn(replyWith(page, WORKED)), `${name}-3-worked-open`);
    await fold.click();
  }
});

test('a seam stays between the texts while the cog hides the tool calls', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(DESKTOP);
  const thread = await startThread('cog', ROOT);
  await thread.reply(midTurnReply());

  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: thread.username,
    password: PASSWORD,
    showToolCalls: false,
  });
  await page.goto(thread.url);
  await page.mouse.move(0, 0);
  const reply = replyWith(page, CHECKING);
  await expect(reply).toHaveCount(1, { timeout: 60_000 });
  const seam = seamsIn(reply);
  await expect(seam).toHaveAttribute('data-state', 'success');
  const cog = reply.locator('[data-tool-calls-fold]').getByRole('button');
  await expect(cog).toHaveText('5');
  await expect(toolRows(reply)).toHaveCount(0);
  await expect(seam).toHaveText('Compacted context · 367k → 6k tokens');
  await expectInOrder(
    [reply.getByText(CHECK), seam, reply.getByText(CHECKING)],
    ['text', 'seam', 'next text']
  );

  // The cog shows the runs, split at the seam, and hides them again; the seam stays.
  await cog.click();
  await expect(toolRows(reply)).toHaveCount(2);
  await expectInOrder(
    [toolRows(reply).nth(0), seam, toolRows(reply).nth(1)],
    ['run', 'seam', 'run']
  );
  await cog.click();
  await expect(toolRows(reply)).toHaveCount(0);
  await expect(seam).toBeVisible();

  if (!SCREENSHOT) return;
  for (const [name, themeId, size] of SHOTS) {
    await page.setViewportSize(size);
    await applySettings(page, themeId, false);
    await expect(seamsIn(replyWith(page, CHECKING))).toBeVisible({ timeout: 60_000 });
    await page.mouse.move(0, 0);
    await shot(page, seamsIn(replyWith(page, CHECKING)), `${name}-2-cog-hidden`);
  }
});
