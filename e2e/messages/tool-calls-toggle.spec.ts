import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, loginToMatrix, registerAgentAccount, sendRoomMessage } from '../helpers/matrix';

// Agent replies hide their tool calls by default: a small chip with an icon per call sits where the
// calls ran, says "Working…" while one runs and how many tools the reply used once they finish, and
// opens the calls in place. The thread menu shows them in its thread, the room menu in the whole
// room, and each choice stays after a reload.
// Set TOOL_CALLS_SHOTS=<directory> to save the chips, the open chip, the thread and both menus.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'tool-calls-toggle-spec-password';
const RUN = Date.now().toString(36);
const ANSWER = 'Q3 monthly churn came in at 2.9%, down from 3.4% in Q2.';
const SHOTS = process.env.TOOL_CALLS_SHOTS;

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const threadReply = (rootId: string, content: Record<string, unknown>) => ({
  msgtype: 'm.text',
  format: 'org.matrix.custom.html',
  ...content,
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

/** Two threads: in one the agent answered after running two tools, in the other a tool still runs. */
const seed = async () => {
  const username = `tct_reader_${RUN}`;
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  expect(response.ok, `registering ${username}`).toBe(true);
  const reader = await loginToMatrix(HOMESERVER, username, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, 'research');
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Churn report',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);

  const doneRoot = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Compare our Q3 churn against SaaS benchmarks.',
  });
  await sendRoomMessage(
    HOMESERVER,
    agent.accessToken,
    roomId,
    threadReply(doneRoot, {
      body: `🔧 \`web_search\` [1]\n\n🔧 \`run_python_code\` [2]\n\n${ANSWER}`,
      formatted_body: `<p>🔧 <code>web_search</code> [1]</p><p>🔧 <code>run_python_code</code> [2]</p><p>${ANSWER}</p>`,
      'io.mindroom.stream_status': 'completed',
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          { type: 'tool_call_completed', tool_name: 'web_search', result_preview: '8 results' },
          { type: 'tool_call_completed', tool_name: 'run_python_code', result_preview: '0.029' },
        ],
      },
    })
  );

  const runningRoot = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Pull the latest invoices.',
  });
  await sendRoomMessage(
    HOMESERVER,
    agent.accessToken,
    roomId,
    threadReply(runningRoot, {
      body: 'Looking at the invoices.\n\n🔧 `fetch_invoices` [1] ⏳',
      formatted_body: '<p>Looking at the invoices.</p><p>🔧 <code>fetch_invoices</code> [1] ⏳</p>',
      'io.mindroom.stream_status': 'streaming',
      'io.mindroom.tool_trace': {
        version: 2,
        events: [{ type: 'tool_call_started', tool_name: 'fetch_invoices' }],
      },
    })
  );
  return { username, roomId, doneRoot, runningRoot };
};

const toolLines = (page: Page, toolName: string) =>
  page.locator('[data-message-disclosure] > button').filter({ hasText: toolName });

/** Chooses "Show tool calls" in a menu, checking that it showed `checked` before. */
const chooseShowToolCalls = async (
  page: Page,
  menuButton: string,
  checked: boolean,
  shotName?: string
) => {
  await page.getByRole('button', { name: menuButton }).first().click();
  const entry = page.getByRole('menuitemcheckbox', { name: 'Show tool calls' });
  await expect(entry).toHaveAttribute('aria-checked', String(checked));
  if (shotName) await shot(page, shotName);
  await entry.click();
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('agent replies hide their tool calls until a thread or room shows them', async ({ page }) => {
  test.setTimeout(180_000);
  const world = await seed();
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

  // A tool that still runs: a chip that says "Working…" in its place, no tool line.
  await openThread(world.runningRoot);
  await expect(page.getByText('Looking at the invoices.', { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  const chip = page.locator('[data-tool-calls-chip]');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('Working…');
  await expect(chip).toHaveAttribute('data-state', 'running');
  await expect(toolLines(page, 'fetch_invoices')).toHaveCount(0);
  await shot(page, 'thread-working');

  // A finished reply: its text and a quiet chip, which opens the calls where they ran.
  await openThread(world.doneRoot);
  const answer = page.getByText(ANSWER, { exact: true });
  await expect(answer).toBeVisible({ timeout: 60_000 });
  await expect(chip).toContainText('Used 2 tools');
  await expect(toolLines(page, 'web_search')).toHaveCount(0);
  const toolRow = page.getByText('web_search', { exact: true });
  await expect(toolRow).toHaveCount(0);
  await shot(page, 'thread-hidden');
  await chip.locator(':scope > button').click();
  await expect(toolRow).toBeVisible();
  await expect(page.getByText('run_python_code', { exact: true })).toBeVisible();
  const rowBox = await toolRow.boundingBox();
  const answerBox = await answer.boundingBox();
  expect(rowBox && answerBox && rowBox.y < answerBox.y, 'the calls open above the answer').toBe(
    true
  );
  await shot(page, 'thread-chip-open');
  await chip.locator(':scope > button').click();
  await expect(toolRow).toHaveCount(0);

  // The thread menu shows them in this thread, and the choice stays.
  await chooseShowToolCalls(page, 'Thread options', false, 'menu-thread');
  await expect(toolLines(page, 'web_search')).toHaveCount(1);
  await page.reload();
  await expect(answer).toBeVisible({ timeout: 60_000 });
  await expect(toolLines(page, 'web_search')).toHaveCount(1);
  await chooseShowToolCalls(page, 'Thread options', true);
  await expect(toolLines(page, 'web_search')).toHaveCount(0);

  // The room menu shows them in every thread of the room.
  await chooseShowToolCalls(page, 'More Options', false, 'menu-room');
  await expect(toolLines(page, 'web_search')).toHaveCount(1);
  await openThread(world.runningRoot);
  await expect(toolLines(page, 'fetch_invoices')).toHaveCount(1, { timeout: 60_000 });
  await expect(chip).toHaveCount(0);
});
