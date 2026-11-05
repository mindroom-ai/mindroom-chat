import type { Page } from '@playwright/test';
import {
  bodyOf,
  expect,
  openLobby,
  sendFromComposer,
  showThread,
  startThread,
  test,
  uniqueWord,
  waitForThreadEvent,
  type AgentStack,
  type MatrixEvent,
} from '../helpers/agentStack';

// Tool approvals with a live MindRoom backend: the stack's approval script holds shell calls whose
// arguments say needs-approval, and untag_thread approvals expire after stack.approvalExpirySeconds.
test.describe.configure({ timeout: 300_000 });

const APPROVAL_EVENT = 'io.mindroom.tool_approval';

const approvalStatus = (event: MatrixEvent): unknown => event.content.status;

const waitForApproval = (
  stack: AgentStack,
  rootId: string,
  status: string,
  timeout = 90_000
): Promise<MatrixEvent> =>
  waitForThreadEvent(
    stack,
    rootId,
    (event) => event.type === APPROVAL_EVENT && approvalStatus(event) === status,
    { timeout, description: `a ${status} tool approval` }
  );

/** Opens the review dialog from the thread's approval bar. */
const openReview = async (page: Page) => {
  const bar = page.getByRole('region', { name: 'Thread approvals' });
  await expect(bar).toContainText('Helper is waiting for you', { timeout: 90_000 });
  await bar.getByRole('button', { name: /^Review 1/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Helper wants to do 1 thing' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('echo needs-approval: deploy the stub');
  return dialog;
};

test('approving a held shell call runs it and the thread keeps the decision', async ({
  page,
  stack,
}) => {
  await openLobby(page, stack);
  const rootId = await startThread(stack, `${uniqueWord('approve')} #approve`);
  await showThread(page, stack, rootId);
  await waitForApproval(stack, rootId, 'pending');

  const dialog = await openReview(page);
  await dialog.getByRole('button', { name: 'Approve once' }).click();
  await expect(dialog).toContainText('Approved', { timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();

  await waitForApproval(stack, rootId, 'approved');
  await expect(page.getByRole('region', { name: 'Thread approvals' })).toBeHidden();
  await expect(page.getByRole('button', { name: /^You approved run_shell_command/ })).toBeVisible({
    timeout: 60_000,
  });
  // The command ran: its output reaches the agent and the agent says so.
  await waitForThreadEvent(
    stack,
    rootId,
    (event) =>
      event.sender === stack.agents.helper &&
      event.content['io.mindroom.stream_status'] === 'completed' &&
      bodyOf(event).includes('needs-approval: deploy the stub') &&
      !bodyOf(event).includes('awaiting_approval'),
    { timeout: 120_000, description: "the helper's report of the command's output" }
  );
});

test('denying a held shell call with a reason hands the reason to the agent', async ({
  page,
  stack,
}) => {
  await openLobby(page, stack);
  const rootId = await startThread(stack, `${uniqueWord('deny')} #approve`);
  await showThread(page, stack, rootId);
  await waitForApproval(stack, rootId, 'pending');

  const dialog = await openReview(page);
  await dialog.getByRole('button', { name: 'Deny' }).click();
  await dialog.getByLabel('Reason for denying call 1 (optional)').fill('not during the freeze');
  await dialog.getByRole('button', { name: 'Confirm deny' }).click();
  await expect(dialog).toContainText('Denied', { timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Close' }).click();

  const denied = await waitForApproval(stack, rootId, 'denied');
  expect(denied.content.resolution_reason).toBe('not during the freeze');
  await expect(page.getByRole('button', { name: /^You denied run_shell_command/ })).toBeVisible({
    timeout: 60_000,
  });
  await waitForThreadEvent(
    stack,
    rootId,
    (event) =>
      event.sender === stack.agents.helper &&
      event.content['io.mindroom.stream_status'] === 'completed' &&
      bodyOf(event).includes('not during the freeze'),
    { timeout: 120_000, description: 'a helper reply that carries the reason' }
  );
});

test('an approval nobody answers expires and says so', async ({ page, stack }) => {
  await openLobby(page, stack);
  // Tag the thread first, so untag_thread has a tag to ask about.
  const rootId = await startThread(stack, `${uniqueWord('expire')} #tag`);
  await showThread(page, stack, rootId);
  await expect(page.getByRole('button', { name: 'Remove stub-tag tag' })).toBeVisible({
    timeout: 90_000,
  });
  await sendFromComposer(page, 'now untag it #expire');
  const pending = await waitForApproval(stack, rootId, 'pending');
  expect(pending.content.tool_name).toBe('untag_thread');
  await expect(page.getByRole('region', { name: 'Thread approvals' })).toContainText(
    'untag_thread',
    { timeout: 60_000 }
  );

  await waitForApproval(stack, rootId, 'expired', (stack.approvalExpirySeconds + 90) * 1000);
  await expect(page.getByRole('region', { name: 'Thread approvals' })).toBeHidden({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: /untag_thread expired|Approval expired/ })).toBeVisible(
    { timeout: 30_000 }
  );
  // The tag stays, since the call never ran.
  await expect(page.getByRole('button', { name: 'Remove stub-tag tag' })).toBeVisible();
});
