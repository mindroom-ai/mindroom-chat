import {
  composer,
  expect,
  messageRow,
  openLobby,
  showThread,
  startThread,
  streamStatus,
  test,
  uniqueWord,
  waitForAgentReply,
  waitForThreadEvent,
} from './agentStack';

// Stopping a reply and regenerating one by editing the message it answers, with a live MindRoom
// backend.
test.describe.configure({ timeout: 300_000 });

test("the reply's Stop button ends the stream and the reply says it was cancelled", async ({
  page,
  stack,
}) => {
  await openLobby(page, stack);
  // 400 words, one every quarter second.
  const rootId = await startThread(stack, `${uniqueWord('stop')} #stopme`);
  await showThread(page, stack, rootId);

  const streaming = await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.sender === stack.agents.helper && streamStatus(event) === 'streaming',
    { description: 'a streaming reply' }
  );
  const reply = messageRow(page, streaming.event_id);
  const stop = reply.getByRole('button', { name: 'Stop', exact: true });
  await expect(stop).toBeVisible({ timeout: 30_000 });
  await stop.click();

  const cancelled = await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.event_id === streaming.event_id && streamStatus(event) === 'cancelled',
    { description: 'the cancelled reply' }
  );
  expect(String(cancelled.content.body)).toContain('[Response cancelled by user]');
  await expect(reply).toContainText('[Response cancelled by user]', { timeout: 30_000 });
  await expect(stop).toHaveCount(0);
  await expect(reply).not.toContainText('word400');
});

test('editing the last message regenerates the reply in place', async ({ page, stack }) => {
  await openLobby(page, stack);
  const word = uniqueWord('regen');
  const rootId = await startThread(stack, `${word} first wording`);
  await showThread(page, stack, rootId);

  const reply = await waitForAgentReply(stack, rootId, (body) =>
    body.includes(`You said: ${word} first wording`)
  );
  const row = messageRow(page, reply.event_id);
  await expect(row).toContainText(`You said: ${word} first wording`, { timeout: 30_000 });

  // Arrow Up in an empty composer edits one's last message in the thread.
  await composer(page).click();
  await page.keyboard.press('ArrowUp');
  const editor = page.getByRole('textbox', { name: 'Edit Message' });
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText(`${word} first wording`);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(`${word} second wording`);
  await page.keyboard.press('Enter');
  await expect(messageRow(page, rootId)).toContainText(`${word} second wording`);
  await expect(messageRow(page, rootId)).toContainText('(edited)');

  // The backend answers the edit by rewriting the same reply, not by posting a new one.
  await waitForAgentReply(
    stack,
    rootId,
    (body) => body.includes(`You said: ${word} second wording`),
    { timeout: 120_000 }
  ).then((regenerated) => expect(regenerated.event_id).toBe(reply.event_id));
  await expect(row).toContainText(`You said: ${word} second wording`, { timeout: 30_000 });
  await expect(row).not.toContainText('first wording');
});
