import type { Page } from '@playwright/test';
import {
  bodyOf,
  expect,
  messageRow,
  openLobby,
  showThread,
  startThread,
  streamStatus,
  test,
  uniqueWord,
  waitForThreadEvent,
  type AgentStack,
  type MatrixEvent,
} from '../helpers/agentStack';

// What a reply shows about a gated call that runs as a background job, with a live MindRoom backend:
// the stack's approval script holds shell calls whose arguments say needs-approval, the call becomes a
// job whose first phase is its approval, and the reply waits background_tool_jobs.approval_wait_timeout
// (20 s here) for the decision before it goes on while the job waits.
test.describe.configure({ timeout: 300_000 });

const APPROVAL_EVENT = 'io.mindroom.tool_approval';
const RAN = /^Ran \d+ tool calls?$/;

const waitForApproval = (
  stack: AgentStack,
  rootId: string,
  status: string,
  timeout = 90_000
): Promise<MatrixEvent> =>
  waitForThreadEvent(
    stack,
    rootId,
    (event) => event.type === APPROVAL_EVENT && event.content.status === status,
    { timeout, description: `a ${status} tool approval` }
  );

/** The helper's reply in the thread that made the shell call, once its call shows in the reply. */
const waitForShellReply = (stack: AgentStack, rootId: string): Promise<MatrixEvent> =>
  waitForThreadEvent(
    stack,
    rootId,
    (event) =>
      event.sender === stack.agents.helper &&
      event.type === 'm.room.message' &&
      bodyOf(event).includes('run_shell_command'),
    { description: "the helper's reply with its shell call" }
  );

/** The title of a reply's tool row, as "Ran 1 tool call" or "Denied 1 tool call". */
const toolRowTitle = (page: Page, replyId: string) =>
  messageRow(page, replyId).getByText(/tool calls?/).first();

const openReview = async (page: Page) => {
  const bar = page.getByRole('region', { name: 'Thread approvals' });
  await expect(bar).toContainText('Helper is waiting for you', { timeout: 90_000 });
  await bar.getByRole('button', { name: /^Review 1/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Helper wants to do 1 thing' });
  await expect(dialog).toBeVisible();
  return dialog;
};

test('a call denied while its reply waits says denied, not ran', async ({ page, stack }) => {
  await openLobby(page, stack);
  const rootId = await startThread(stack, `${uniqueWord('deny')} #approve`);
  await showThread(page, stack, rootId);
  await waitForApproval(stack, rootId, 'pending');
  const reply = await waitForShellReply(stack, rootId);

  const dialog = await openReview(page);
  await dialog.getByRole('button', { name: 'Deny' }).click();
  await dialog.getByRole('button', { name: 'Confirm deny' }).click();
  await expect(dialog).toContainText('Denied', { timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Close' }).click();
  await waitForApproval(stack, rootId, 'denied');
  await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.event_id === reply.event_id && streamStatus(event) === 'completed',
    { description: 'the finished reply' }
  );

  await expect(toolRowTitle(page, reply.event_id)).toHaveText('Denied 1 tool call', {
    timeout: 30_000,
  });
  await expect(messageRow(page, reply.event_id).getByText(RAN)).toHaveCount(0);
});

test('a call the reply stopped waiting for shows as waiting until it is approved, then as ran', async ({
  page,
  stack,
}) => {
  await openLobby(page, stack);
  const rootId = await startThread(stack, `${uniqueWord('late')} #approve`);
  await showThread(page, stack, rootId);
  await waitForApproval(stack, rootId, 'pending');
  const reply = await waitForShellReply(stack, rootId);

  // After the wait the reply finishes with the job's handle while the job still waits.
  const finished = await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.event_id === reply.event_id && streamStatus(event) === 'completed',
    { timeout: 120_000, description: 'the reply that went on without the decision' }
  );
  expect(bodyOf(finished)).toContain('awaiting_approval');
  await expect(toolRowTitle(page, reply.event_id)).toHaveText(
    '1 tool call waiting for approval',
    { timeout: 30_000 }
  );

  const dialog = await openReview(page);
  await dialog.getByRole('button', { name: 'Approve once' }).click();
  await expect(dialog).toContainText('Approved', { timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Close' }).click();
  await waitForApproval(stack, rootId, 'approved');
  await expect(toolRowTitle(page, reply.event_id)).toHaveText('Ran 1 tool call', {
    timeout: 30_000,
  });
});

test('Stop on a reply that waits for approval never says the call ran, and stopping the job clears it', async ({
  page,
  stack,
}) => {
  await openLobby(page, stack);
  const rootId = await startThread(stack, `${uniqueWord('halt')} #approve`);
  await showThread(page, stack, rootId);
  await waitForApproval(stack, rootId, 'pending');
  const reply = await waitForShellReply(stack, rootId);

  const stop = messageRow(page, reply.event_id).getByRole('button', { name: 'Stop', exact: true });
  await expect(stop).toBeVisible({ timeout: 30_000 });
  await stop.click();
  await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.event_id === reply.event_id && streamStatus(event) === 'cancelled',
    { description: 'the cancelled reply' }
  );

  // Stop ends only the reply: the job stays and still waits for the decision (MindRoom's
  // docs/architecture/background-tool-jobs.md). The row follows the card, whatever it says.
  const card = await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.type === APPROVAL_EVENT,
    { description: 'the approval card' }
  );
  const expected = {
    pending: '1 tool call waiting for approval',
    denied: 'Denied 1 tool call',
    expired: '1 tool call expired',
  }[String(card.content.status)];
  expect(expected, `card status ${String(card.content.status)}`).toBeDefined();
  await expect(toolRowTitle(page, reply.event_id)).toHaveText(expected as string, {
    timeout: 30_000,
  });
  await expect(messageRow(page, reply.event_id).getByText(RAN)).toHaveCount(0);

  if (card.content.status === 'pending') {
    // Stopping the job denies its card, and nothing says the agent still waits.
    const jobs = page.getByRole('region', { name: 'Waiting for approval: run_shell_command' });
    await jobs.getByRole('button', { name: 'Stop run_shell_command' }).click();
    await waitForApproval(stack, rootId, 'denied');
    await expect(page.getByRole('region', { name: 'Thread approvals' })).toBeHidden({
      timeout: 30_000,
    });
    await expect(jobs).toBeHidden({ timeout: 30_000 });
    await expect(toolRowTitle(page, reply.event_id)).toHaveText('Denied 1 tool call', {
      timeout: 30_000,
    });
  }
});

test('an agent that waits for approval is not shown typing', async ({ page, stack }) => {
  await openLobby(page, stack);
  const rootId = await startThread(stack, `${uniqueWord('quiet')} #approve`);
  await showThread(page, stack, rootId);
  await waitForApproval(stack, rootId, 'pending');
  await expect(page.getByRole('region', { name: 'Thread approvals' })).toContainText(
    'Helper is waiting for you',
    { timeout: 60_000 }
  );

  // MindRoom keeps its typing notice up while the reply waits (up to 20 s here), so sample a while.
  const typing = page.getByRole('status').filter({ hasText: 'Helper is typing' });
  for (let sample = 0; sample < 12; sample += 1) {
    await expect(typing).toHaveCount(0);
    await page.waitForTimeout(500);
  }
});
