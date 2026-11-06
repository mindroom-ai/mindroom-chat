import {
  expect,
  openLobby,
  showThread,
  startThread,
  streamStatus,
  test,
  uniqueWord,
  waitForAgentReply,
  waitForThreadEvent,
} from '../helpers/agentStack';

// Typing notices are room-wide, but an agent types for the reply it streams in one thread. A thread
// names the agent as typing only while that agent streams there, so a finished thread stays quiet
// while the agent answers in another one.
test.describe.configure({ timeout: 300_000 });

test(
  'an agent streaming in one thread shows as typing there, not in another thread',
  { tag: '@webkit' },
  async ({ page, stack }) => {
    await openLobby(page, stack);
    const word = uniqueWord('typing');
    const finishedId = await startThread(stack, `${word} finished question`);
    await waitForAgentReply(stack, finishedId, (body) => body.includes('finished question'));

    // A long reply streams in another thread.
    const streamingId = await startThread(stack, `${word} long question #stopme`);
    await waitForThreadEvent(
      stack,
      streamingId,
      (event) => event.sender === stack.agents.helper && streamStatus(event) === 'streaming',
      { description: 'the long reply streaming' }
    );
    const typing = page.getByText('Helper is typing...', { exact: true });

    await showThread(page, stack, streamingId);
    await expect(typing).toBeVisible({ timeout: 30_000 });

    await showThread(page, stack, finishedId);
    // Long enough for a typing strip to show, as it did at once in the streaming thread.
    await page.waitForTimeout(3_000);
    await expect(typing).toHaveCount(0);

    await showThread(page, stack, streamingId);
    await expect(typing).toBeVisible({ timeout: 30_000 });
  }
);
