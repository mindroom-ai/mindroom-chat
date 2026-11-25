import { openSettingsFromAccountRail } from '../helpers/accounts';
import {
  bodyOf,
  createAgentRoom,
  expect,
  messageRow,
  openLobby,
  showThread,
  startThread,
  test,
  uniqueWord,
  waitForAgentReply,
  waitForThreadEvent,
  type MatrixEvent,
} from '../helpers/agentStack';
import { matrixFetch } from '../helpers/matrix';
import { panelLocator } from '../helpers/sidePanels';

// Real-backend contract specs under production discovery (`computers: { apiUrl: "" }`, default
// `clientApiUrl: false`, zero HTTP mocks): Settings server saving + temporary secret request
// card round trip, real subagent delegation, and real cross-room thread forking.
test.use({ agentStackArgs: ['--client-sessions', '--transcription', 'stub'] });
test.describe.configure({ timeout: 300_000 });

const COMPUTER_SERVICE_STORAGE_KEY = 'mindroomComputerService.v1';

test('saves discovered server in Settings and completes a secret request round trip', async ({
  page,
  stack,
}) => {
  await openLobby(page, stack);
  try {
    await openSettingsFromAccountRail(page);
    const settingsDialog = page.getByRole('dialog', { name: 'Settings' });
    await settingsDialog
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('button', { name: 'Agents & servers', exact: true })
      .click();

    await expect(settingsDialog.getByText('Server in use', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(settingsDialog.getByText(stack.apiUrl, { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });

    const apiHost = new URL(stack.apiUrl).host;
    const useServerButton = settingsDialog.getByRole('button', {
      name: `Use ${apiHost}`,
      exact: true,
    });
    await expect(useServerButton).toBeVisible({ timeout: 30_000 });
    await useServerButton.click();
    await expect(useServerButton).toHaveCount(0);

    await settingsDialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(settingsDialog).toHaveCount(0);

    const rootId = await startThread(stack, `${uniqueWord('secret')} #secret`);
    await showThread(page, stack, rootId);

    const card = page.locator('[aria-label="Secret request"]');
    await expect(card).toBeVisible({ timeout: 90_000 });
    await expect(card).toContainText('Stub token');
    await expect(card).toContainText('STUB_TOKEN');
    await expect(card).toContainText('Verify real secret request card round trip.');

    const field = card.getByLabel('Secret for STUB_TOKEN', { exact: true });
    await expect(field).toBeVisible({ timeout: 30_000 });
    await field.fill('stub-secret-value-123');

    const postPromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().startsWith(`${stack.apiUrl}/api/rooms/`) &&
        response.url().includes('/secret-requests/'),
      { timeout: 60_000 }
    );
    await card.getByRole('button', { name: 'Send', exact: true }).click();
    const postResponse = await postPromise;
    expect(postResponse.status()).toBe(204);

    await waitForThreadEvent(
      stack,
      rootId,
      (event) => {
        const secret = event.content['io.mindroom.secret_request'] as
          | { status?: unknown }
          | undefined;
        return secret?.status === 'saved';
      },
      { timeout: 90_000, description: 'a saved secret request event' }
    );

    const reply = await waitForAgentReply(
      stack,
      rootId,
      (body) => body.includes('Finished **secret**') && body.includes('"status": "provided"'),
      { timeout: 90_000 }
    );
    expect(bodyOf(reply)).not.toContain('stub-secret-value-123');

    const replyRow = messageRow(page, reply.event_id);
    await expect(replyRow).toContainText('Finished secret', { timeout: 60_000 });
    await expect(replyRow).toContainText('"status": "provided"');
    await expect(replyRow.locator('[data-secret-request-line="saved"]')).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    await page
      .evaluate((key) => localStorage.removeItem(key), COMPUTER_SERVICE_STORAGE_KEY)
      .catch(() => undefined);
  }
});

test('delegates to Scout via run_subagent and shows the run in reply and panel', async ({
  page,
  stack,
}) => {
  await openLobby(page, stack);
  const rootId = await startThread(stack, `${uniqueWord('delegate')} #delegate`);
  await showThread(page, stack, rootId);

  const reply = await waitForAgentReply(
    stack,
    rootId,
    (body) => body.includes('Finished **delegate**') && body.includes('delegated-ok.'),
    { timeout: 120_000 }
  );
  const replyRow = messageRow(page, reply.event_id);
  await expect(replyRow).toContainText('Finished delegate', { timeout: 60_000 });
  await expect(replyRow).toContainText('delegated-ok.');
  await expect(replyRow).toContainText('stub-deep');

  const subagentsToggle = page.locator('button[data-subagents-toggle]');
  await expect(subagentsToggle).toBeVisible({ timeout: 30_000 });
  await subagentsToggle.click();
  const subagentsPanel = panelLocator(page, 'subagents');
  await expect(subagentsPanel).toBeVisible({ timeout: 30_000 });
  const runCard = subagentsPanel
    .locator('[data-subagent]')
    .filter({ hasText: 'Check stub delegation' });
  await expect(runCard).toBeVisible({ timeout: 30_000 });
  await expect(runCard).toContainText('Scout');
  await expect(runCard).toContainText('delegated-ok.');
});

test('forks a Lobby thread into a private room and receives a Helper reply', async ({
  page,
  stack,
}) => {
  const targetName = `Fork target ${uniqueWord('room')}`;
  const targetRoomId = await createAgentRoom(stack, targetName, false);

  await openLobby(page, stack);
  const sourceToken = uniqueWord('forksrc');
  const rootId = await startThread(stack, `Source context ${sourceToken}`);
  const sourceReply = await waitForAgentReply(stack, rootId, (body) => body.includes(sourceToken));

  await showThread(page, stack, rootId);
  await expect(messageRow(page, sourceReply.event_id)).toBeVisible({ timeout: 60_000 });

  const threadColumn = page.getByTestId('thread-column');
  await threadColumn
    .locator('[data-thread-context-banner]')
    .getByRole('button', { name: 'Thread options', exact: true })
    .click();
  const forkToRoomAction = page.locator('[data-thread-action="forkToRoom"]');
  await expect(forkToRoomAction).toBeVisible({ timeout: 30_000 });
  await forkToRoomAction.click();

  const picker = page.getByRole('dialog', { name: 'Fork to room', exact: true });
  await expect(picker).toBeVisible({ timeout: 30_000 });
  await picker.locator('[data-fork-room-search]').fill(targetName);
  const targetOption = picker.locator(`[data-fork-room-id="${targetRoomId}"]`);
  await expect(targetOption).toBeVisible({ timeout: 30_000 });
  await targetOption.click();

  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 60_000 })
    .toContain(encodeURIComponent(targetRoomId));
  await expect(threadColumn.locator('[data-cross-room-fork-banner]')).toBeVisible({
    timeout: 60_000,
  });

  const followUpToken = uniqueWord('forkfollow');
  const threadComposer = threadColumn.locator('[data-editable-name="RoomInput"]');
  await threadComposer.click();
  await page.keyboard.type('@Hel');
  await expect(page.getByText(stack.agents.helper, { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await page.keyboard.press('Tab');
  await page.keyboard.type(` follow up ${followUpToken}`);
  await page.keyboard.press('Enter');

  let forkId = '';
  await expect
    .poll(
      () => {
        const threadId = new URL(page.url()).searchParams.get('threadId');
        if (threadId?.startsWith('$') && threadId !== rootId) {
          forkId = threadId;
          return true;
        }
        return false;
      },
      { timeout: 60_000, message: 'waiting for forked threadId in URL' }
    )
    .toBe(true);

  const forkRoot = await matrixFetch<{ content: Record<string, unknown> }>(
    stack.homeserver,
    `/rooms/${encodeURIComponent(targetRoomId)}/event/${encodeURIComponent(forkId)}`,
    { accessToken: stack.tester.accessToken }
  );
  expect(forkRoot.content['io.mindroom.fork']).toEqual(
    expect.objectContaining({
      room_id: stack.rooms.lobby,
      thread_id: rootId,
    })
  );

  await expect
    .poll(
      async () => {
        const { chunk } = await matrixFetch<{ chunk: MatrixEvent[] }>(
          stack.homeserver,
          `/rooms/${encodeURIComponent(targetRoomId)}/messages?dir=b&limit=50`,
          { accessToken: stack.tester.accessToken }
        );
        return chunk.some((event) => {
          if (event.sender !== stack.agents.helper || event.type !== 'm.room.message') return false;
          const content =
            (event.content['m.new_content'] as Record<string, unknown> | undefined) ??
            event.content;
          return (
            content['io.mindroom.stream_status'] === 'completed' &&
            typeof content.body === 'string' &&
            content.body.includes(followUpToken)
          );
        });
      },
      {
        timeout: 90_000,
        intervals: [500, 1000],
        message: 'waiting for Helper reply in forked thread',
      }
    )
    .toBe(true);

  await expect(
    threadColumn
      .locator('[data-message-item]')
      .filter({ hasText: 'Hello from stub-fast.' })
      .filter({ hasText: followUpToken })
  ).toBeVisible({ timeout: 60_000 });
});
