import {
  expect,
  messageRow,
  openLobby,
  showThread,
  startThread,
  test,
  uniqueWord,
  waitForAgentReply,
  waitForThreadEvent,
} from '../helpers/agentStack';

// A live MindRoom backend streams its replies: live frames carry each new word between the edits that
// persist the reply, and tool calls show as rows. See agentStack.ts for the stack.
test.describe.configure({ timeout: 300_000 });

const wordCount = (text: string): number => text.match(/\bword\d+\b/g)?.length ?? 0;

test('a streamed reply grows word by word through live frames and ends without its Stop button', async ({
  page,
  stack,
}) => {
  await openLobby(page, stack);
  const rootId = await startThread(stack, `${uniqueWord('stream')} #slow`);
  await showThread(page, stack, rootId);

  const pending = await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.sender === stack.agents.helper && event.type === 'm.room.message',
    { description: "the helper's reply" }
  );
  const reply = messageRow(page, pending.event_id);
  await expect(reply).toBeVisible({ timeout: 30_000 });

  // Count words in the page itself: Playwright round trips are slow on a loaded machine.
  await reply.evaluate((element) => {
    const seen: number[] = [];
    (window as unknown as { streamSamples: number[] }).streamSamples = seen;
    const sample = () => {
      const count = element.textContent?.match(/\bword\d+\b/g)?.length ?? 0;
      if (seen[seen.length - 1] !== count) seen.push(count);
      if (count < 30) window.setTimeout(sample, 50);
    };
    sample();
  });
  await expect(reply.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await expect.poll(async () => wordCount(await reply.innerText()), { timeout: 60_000 }).toBe(30);
  await waitForAgentReply(stack, rootId, (body) => body.includes('word30'));
  await expect(reply.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  // Frames older than 12 s no longer show; the reply then stands on its last edit, which must have
  // arrived (an earlier client kept the first streaming edit, "word1", until a reload).
  await page.waitForTimeout(13_000);
  expect(wordCount(await reply.innerText())).toBe(30);
  await expect(reply.getByText(/^Thinking/)).toHaveCount(0);

  const samples = await page.evaluate(
    () => (window as unknown as { streamSamples: number[] }).streamSamples
  );
  const intermediate = samples.filter((count) => count > 0 && count < 30);
  // The backend edits the message only every few seconds; without live frames a 7 s stream shows a
  // couple of steps. Live frames add a word every quarter second.
  expect(
    intermediate.length,
    `word counts seen while streaming: ${samples.join(' ')}`
  ).toBeGreaterThan(8);
});

test('tool calls show a running row, then one row for the run that expands to each call', async ({
  page,
  stack,
}) => {
  await openLobby(page, stack);
  const rootId = await startThread(stack, `${uniqueWord('tools')} #multi`);
  await showThread(page, stack, rootId);

  // The second of three shell calls sleeps 10 s.
  await expect(page.getByRole('button', { name: /^Running \d+ tool calls?/ })).toBeVisible({
    timeout: 60_000,
  });
  const done = await waitForAgentReply(stack, rootId, (body) => /Finished \*{0,2}multi/.test(body));
  const reply = messageRow(page, done.event_id);
  const tools = reply.getByRole('button', { name: /^Ran 3 tool calls/ });
  await expect(tools).toBeVisible({ timeout: 30_000 });
  // The answer sits a paragraph's spacing (8 px) below the row: the blank line MindRoom writes
  // after each tool marker leaves no empty line, in the live frames and in the final edit.
  const answer = reply.locator('p').filter({ hasText: /^Finished/ });
  const gapBelowRow = async () => {
    const [row, text] = await Promise.all([tools.boundingBox(), answer.boundingBox()]);
    return (text?.y ?? 0) - ((row?.y ?? 0) + (row?.height ?? 0));
  };
  expect(Math.abs((await gapBelowRow()) - 8)).toBeLessThanOrEqual(2);
  // Past the live frames' freshness the row shows the final edit, not an earlier one.
  await page.waitForTimeout(13_000);
  await expect(tools).toBeVisible();
  expect(Math.abs((await gapBelowRow()) - 8)).toBeLessThanOrEqual(2);
  await expect(tools).toContainText('run_shell_command ×3');
  await expect(reply.getByText('step two', { exact: false })).toHaveCount(0);

  await tools.click();
  await expect(tools).toHaveAttribute('aria-expanded', 'true');
  for (const step of ['echo step one', 'sleep 10; echo step two', 'echo step three']) {
    await expect(reply.getByText(step, { exact: true })).toBeVisible();
  }
  await expect(reply.getByText(/workspace\]\s+step two/)).toBeVisible();
  await tools.click();
  await expect(reply.getByText('sleep 10; echo step two', { exact: true })).toHaveCount(0);
});
