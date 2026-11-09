import type { Locator, Page } from '@playwright/test';
import {
  expect,
  lobbyEvents,
  openLobby,
  startThread,
  test,
  uniqueWord,
  waitForAgentReply,
  waitForThreadEvent,
  type AgentStack,
  type MatrixEvent,
} from '../helpers/agentStack';

// Activity with a live MindRoom backend and its stub model: replies stream as edits, questions
// come from the backend's interactive blocks, and approvals from its approval script. The lobby
// opens in Compact, whose cards load their threads, so edits reach the client's thread timelines.
test.describe.configure({ timeout: 300_000 });

const APPROVAL_EVENT = 'io.mindroom.tool_approval';

/** Opens the rail's Activity popover and returns it. */
const openActivity = async (page: Page): Promise<Locator> => {
  await page
    .getByRole('button', { name: /^Activity/ })
    .first()
    .click();
  const popover = page.getByRole('dialog', { name: 'Activity' });
  await expect(popover).toBeVisible();
  return popover;
};

/** The popover's row of the thread whose root says `word`. */
const rowOf = (popover: Locator, word: string): Locator =>
  popover.locator('[data-activity-row]').filter({ hasText: word });

const reactionsTo = async (stack: AgentStack, eventId: string): Promise<MatrixEvent[]> =>
  (await lobbyEvents(stack)).filter((event) => {
    const relation = event.content['m.relates_to'] as
      | { rel_type?: string; event_id?: string }
      | undefined;
    return (
      event.type === 'm.reaction' &&
      relation?.rel_type === 'm.annotation' &&
      relation.event_id === eventId
    );
  });

test('a streamed reply counts once in Activity, however many edits it took', async ({
  page,
  stack,
}) => {
  await openLobby(page, stack);
  const word = uniqueWord('stream');
  const rootId = await startThread(stack, `${word} #slow`);
  // The reply streams 30 words, one edit after another, into the thread's loaded timeline.
  await waitForAgentReply(stack, rootId, (body) => body.includes('word30'), { timeout: 120_000 });

  const popover = await openActivity(page);
  const row = rowOf(popover, word);
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect(row).toHaveAttribute('data-activity-row', 'reply');
  await expect(row).toContainText('1 new');
  await expect(row).toContainText('word30');
});

test('an agent question is answered from its Activity row', async ({ page, stack }) => {
  await openLobby(page, stack);
  const word = uniqueWord('ask');
  const rootId = await startThread(stack, `${word} #ask`);
  const question = await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.sender === stack.agents.helper && 'io.mindroom.interactive' in event.content,
    { timeout: 120_000, description: "the helper's question" }
  );

  const popover = await openActivity(page);
  const row = rowOf(popover, word);
  await expect(row).toHaveAttribute('data-activity-row', 'question', { timeout: 60_000 });
  await expect(row).toContainText('Which deck should I polish for Thursday?');
  await row.getByRole('button', { name: 'v3 final' }).click();
  await expect(row).toContainText('Answered: v3 final');

  // The reaction lands on the question's own message, which MindRoom reads as the answer.
  const questionId = question.event_id;
  await expect
    .poll(
      async () =>
        (await reactionsTo(stack, questionId)).map((event) => event.content['m.relates_to']),
      {
        timeout: 30_000,
      }
    )
    .toContainEqual(expect.objectContaining({ key: '✅' }));
  await waitForThreadEvent(
    stack,
    rootId,
    (event) =>
      event.sender === stack.agents.helper &&
      event.event_id !== questionId &&
      event.type === 'm.room.message' &&
      event.content['io.mindroom.stream_status'] === 'completed',
    { timeout: 120_000, description: "the helper's answer to the selection" }
  );

  // Answered, the thread no longer waits: its row leaves Needs you.
  await popover.getByRole('tab', { name: 'Needs you' }).click();
  await expect(rowOf(popover, word)).toBeHidden({ timeout: 90_000 });
});

test('a held tool call is approved from its Activity row and then runs', async ({
  page,
  stack,
}) => {
  await openLobby(page, stack);
  const word = uniqueWord('approve');
  const rootId = await startThread(stack, `${word} #approve`);
  await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.type === APPROVAL_EVENT && event.content.status === 'pending',
    { timeout: 120_000, description: 'a pending tool approval' }
  );

  const popover = await openActivity(page);
  const row = rowOf(popover, word);
  await expect(row).toHaveAttribute('data-activity-row', 'approval', { timeout: 60_000 });
  // The router posts the card; the row names the agent that asks.
  await expect(row).toContainText('Helper needs approval');
  await expect(row).toContainText('echo needs-approval: deploy the stub');
  await row.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(row).toContainText('Approved');

  await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.type === APPROVAL_EVENT && event.content.status === 'approved',
    { timeout: 90_000, description: 'the approved tool approval' }
  );
  // The call ran once approved: the helper reports its result (whatever the host's shell said).
  await waitForAgentReply(
    stack,
    rootId,
    (body) => body.includes('Finished **approve** after 1 tool call(s)'),
    {
      timeout: 120_000,
    }
  );
});
