import {
  expect,
  openLobby,
  showThread,
  startThread,
  test,
  uniqueWord,
  waitForThreadEvent,
} from '../helpers/agentStack';

// Room schedules with a live MindRoom backend: the agent's schedule tool makes a one-time task,
// the header's clock counts it, the thread banner counts down to it, its dialog lists it, and the
// router posts it as an automated task when it is due.
test.describe.configure({ timeout: 300_000 });

test('a reminder the agent schedules is listed, counted down and posted on time', async ({
  page,
  stack,
}) => {
  await openLobby(page, stack);
  // The stub schedules "@helper remind me to stretch" 20 s ahead.
  const rootId = await startThread(stack, `${uniqueWord('schedule')} #schedulesoon`);
  await showThread(page, stack, rootId);

  const clock = page.getByRole('button', { name: 'Scheduled tasks (1)' });
  await expect(clock).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('[data-thread-context-banner]')).toContainText(/in \d+s/);

  await clock.click();
  const dialog = page.getByRole('dialog', { name: 'Scheduled tasks' });
  await expect(dialog).toBeVisible();
  if (stack.model === 'stub') {
    await expect(dialog.getByText('Stretch reminder', { exact: true })).toBeVisible();
    await expect(dialog.getByText('@helper remind me to stretch', { exact: true })).toBeVisible();
  } else {
    // A real model words the task's title and prompt itself.
    await expect(dialog).toContainText(/stretch/i);
  }
  await expect(dialog).toContainText('One-time');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();

  const fired = await waitForThreadEvent(
    stack,
    rootId,
    (event) =>
      event.sender === stack.agents.router &&
      String(event.content.body ?? '').includes('[Automated Task]'),
    { timeout: 120_000, description: 'the automated task' }
  );
  await expect(page.locator(`[data-message-id="${fired.event_id}"]`)).toContainText(
    stack.model === 'stub' ? 'remind me to stretch' : /stretch/i,
    { timeout: 30_000 }
  );
  await expect(page.getByRole('button', { name: 'Scheduled tasks (0)' })).toBeVisible({
    timeout: 60_000,
  });
});
