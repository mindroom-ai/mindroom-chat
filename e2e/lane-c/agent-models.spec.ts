import {
  expect,
  messageRow,
  openLobby,
  openThread,
  sendFromComposer,
  showThread,
  startThread,
  test,
  uniqueWord,
  waitForAgentReply,
} from './agentStack';

// The model badge and the thread model picker with a live MindRoom backend: the picker asks the
// router for its catalog over encrypted to-device messages, sends `!model <key>`, and the next reply
// runs on that model (the stub names the model it was called as).
test.describe.configure({ timeout: 300_000 });

test('a thread switches to another model from the picker, and the choice survives a reload', async ({
  page,
  stack,
}) => {
  await openLobby(page, stack);
  const rootId = await startThread(stack, `${uniqueWord('model')} first question`);
  await showThread(page, stack, rootId);

  const first = await waitForAgentReply(stack, rootId, (body) => body.includes('stub-fast'));
  const firstRow = messageRow(page, first.event_id);
  await expect(firstRow).toContainText('Hello from stub-fast');
  // The badge under the agent's avatar names the model that answered.
  await expect(firstRow).toContainText('Stub Fast');

  const chip = page.getByRole('button', { name: 'Choose model' });
  await expect(chip).toHaveText('Room default', { timeout: 60_000 });
  await chip.click();
  const models = page.getByRole('listbox', { name: 'Models' });
  await expect(models.getByRole('option', { name: /Stub Deep/ })).toBeVisible({ timeout: 60_000 });
  await expect(models.getByRole('option', { name: /Stub Fast/ })).toBeVisible();
  await models.getByRole('option', { name: /Stub Deep/ }).click();
  await expect(chip).toHaveText('Stub Deep', { timeout: 60_000 });
  // The router confirms the switch in the thread.
  await expect(page.getByText(/This thread now uses deep/)).toBeVisible({ timeout: 60_000 });

  await sendFromComposer(page, 'second question');
  const second = await waitForAgentReply(
    stack,
    rootId,
    (body) => body.includes('stub-deep') && body.includes('second question')
  );
  const secondRow = messageRow(page, second.event_id);
  await expect(secondRow).toContainText('Hello from stub-deep', { timeout: 30_000 });
  await expect(secondRow).toContainText('Stub Deep');

  // After a reload the chip learns the thread's model from the router again. The picker collects
  // answers for its whole discovery window (MODEL_TIMEOUT, 12 s) before it shows one.
  await openThread(page, stack, rootId);
  await expect(chip).toHaveText('Stub Deep', { timeout: 45_000 });
});
