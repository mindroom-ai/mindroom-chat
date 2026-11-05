import {
  expect,
  lobbyEvents,
  openLobby,
  showThread,
  startThread,
  test,
  uniqueWord,
  waitForThreadEvent,
  type AgentStack,
  type MatrixEvent,
} from '../helpers/agentStack';
import { matrixFetch } from '../helpers/matrix';

// Thread titles and tags from a live MindRoom backend: the automatic summary, a title the agent
// sets with set_thread_summary, tags the agent adds with tag_thread, and tags added and removed in
// the thread banner, which write `com.mindroom.thread.tags` state.
test.describe.configure({ timeout: 300_000 });

const TAGS_EVENT = 'com.mindroom.thread.tags';

const summaryOf = (event: MatrixEvent): unknown =>
  (event.content['io.mindroom.thread_summary'] as { summary?: unknown } | undefined)?.summary;

const threadTags = async (stack: AgentStack, rootId: string): Promise<string[]> => {
  const state = await matrixFetch<
    { type: string; state_key: string; content: Record<string, unknown> }[]
  >(stack.homeserver, `/rooms/${encodeURIComponent(stack.rooms.lobby)}/state`, {
    accessToken: stack.tester.accessToken,
  });
  return state
    .filter((event) => event.type === TAGS_EVENT && Object.keys(event.content).length > 0)
    .map((event) => JSON.parse(event.state_key) as [string, string])
    .filter(([threadId]) => threadId === rootId)
    .map(([, tag]) => tag)
    .sort();
};

test('a thread gets its summary title, then the title the agent sets', async ({ page, stack }) => {
  await openLobby(page, stack);
  const word = uniqueWord('title');
  const rootId = await startThread(stack, `${word} please #title`);
  await showThread(page, stack, rootId);

  const banner = page.locator('[data-thread-context-banner]');
  await expect(banner).toContainText('Stub picked this title from a tool call', {
    timeout: 120_000,
  });
  await expect(page.getByRole('button', { name: /^Ran 1 tool call/ })).toContainText(
    'set_thread_summary'
  );
  // The room's Compact card takes the same title.
  await page.getByRole('button', { name: 'Back to room' }).click();
  await expect(page.getByText('Stub picked this title from a tool call').first()).toBeVisible({
    timeout: 30_000,
  });
  const summaries = (await lobbyEvents(stack)).filter(
    (event) =>
      event.content['io.mindroom.thread_summary'] &&
      JSON.stringify(event.content['m.relates_to'] ?? {}).includes(rootId)
  );
  expect(summaries.length).toBeGreaterThan(0);

  // A thread without the tool call keeps the automatic summary as its title.
  const plainRoot = await startThread(stack, `${word} plain`);
  await showThread(page, stack, plainRoot);
  const summary = await waitForThreadEvent(
    stack,
    plainRoot,
    (event) => typeof summaryOf(event) === 'string',
    { timeout: 120_000, description: 'the automatic summary' }
  );
  // The stub titles a thread with its first words; a real model writes its own title.
  if (stack.model === 'stub')
    expect(String(summaryOf(summary))).toContain(`Stub title: ${word} plain`);
  await expect(banner).toContainText(String(summaryOf(summary)), { timeout: 60_000 });
  await expect(page.getByText('AI titled this thread').first()).toBeVisible();
});

test('tags come from the agent and from the banner, and leave with their ×', async ({
  page,
  stack,
}) => {
  await openLobby(page, stack);
  const rootId = await startThread(stack, `${uniqueWord('tags')} #tag`);
  await showThread(page, stack, rootId);

  const banner = page.locator('[data-thread-context-banner]');
  await expect(banner.getByRole('button', { name: 'Remove stub-tag tag' })).toBeVisible({
    timeout: 120_000,
  });
  await expect.poll(() => threadTags(stack, rootId)).toContain('stub-tag');

  await banner.getByRole('button', { name: 'Add tag' }).click();
  const input = page.getByRole('textbox', { name: 'Filter or create tag' });
  await expect(input).toBeFocused();
  await page.keyboard.type('from-banner');
  await page.keyboard.press('Enter');
  await expect(banner.getByRole('button', { name: 'Remove from-banner tag' })).toBeVisible();
  await expect.poll(() => threadTags(stack, rootId)).toContain('from-banner');

  await banner.getByRole('button', { name: 'Remove from-banner tag' }).click();
  await expect(banner.getByRole('button', { name: 'Remove from-banner tag' })).toHaveCount(0);
  await expect.poll(() => threadTags(stack, rootId)).toEqual(['stub-tag']);
});
