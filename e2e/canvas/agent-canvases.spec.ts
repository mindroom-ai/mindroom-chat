import {
  expect,
  lobbyEvents,
  openLobby,
  showThread,
  startThread,
  test,
  uniqueWord,
  waitForAgentReply,
} from '../helpers/agentStack';
import { defined } from '../../src/test/utils/defined';

// An agent canvas with a live MindRoom backend: show_canvas posts a page, the panel runs it in a
// nested sandbox, a submission waits for the person's Send, and the answer reaches the agent.
test.describe.configure({ timeout: 300_000 });

test('a canvas from the agent opens in the panel and sends a confirmed answer back', async ({
  page,
  stack,
}) => {
  await openLobby(page, stack);
  const rootId = await startThread(stack, `${uniqueWord('canvas')} #canvas`);
  await showThread(page, stack, rootId);

  const open = page.getByRole('button', { name: 'Open canvas', exact: true }).first();
  await expect(open).toBeVisible({ timeout: 120_000 });
  const panel = page.getByRole('complementary', { name: 'Canvas panel' });
  if (!(await panel.isVisible())) await open.click();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Stub canvas');
  await expect(panel).toContainText('Interactive panel from Helper');

  // The panel's frame holds a wrapper; the agent's page runs in the frame inside it.
  const page2 = page.frameLocator('aside[aria-label="Canvas panel"] iframe').frameLocator('iframe');
  await page2.getByRole('button', { name: 'Blue' }).click();
  await expect(panel.getByText('Send to')).toContainText('Submitted');
  // Nothing leaves before the person presses Send.
  const responses = async () =>
    (await lobbyEvents(stack)).filter((event) => event.content['io.mindroom.canvas_response']);
  expect(await responses()).toHaveLength(0);

  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(panel.getByText(/Sent to Helper/)).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await responses()).length, { timeout: 30_000 }).toBe(1);
  const response = defined((await responses())[0], 'the canvas response');
  expect(response.sender).toBe(stack.tester.userId);
  expect(response.content['io.mindroom.canvas_response']).toMatchObject({
    agent_user_id: stack.agents.helper,
    data: { color: 'blue' },
  });

  // The agent gets the answer as a message to it, and replies.
  await waitForAgentReply(stack, rootId, (body) => body.includes('"color":"blue"'), {
    timeout: 120_000,
  });
});
