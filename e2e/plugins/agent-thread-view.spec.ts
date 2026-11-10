import type { Locator, Page } from '@playwright/test';
import {
  bodyOf,
  expect,
  lobbyEvents,
  messageRow,
  openLobby,
  serverUnreadCounts,
  openThread,
  routerToken,
  showPath,
  showThread,
  startThread,
  test,
  uniqueWord,
  waitForThreadEvent,
  type AgentStack,
} from '../helpers/agentStack';
import { joinRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { roomMoreOptions } from '../helpers/roomMenu';

// The client SDK's `ThreadView` end to end: a production build with the example client plugin
// (src/app/plugins/__fixtures__/example-plugin) against the agent stack. The plugin's "Example
// thread" panel shows the thread the room showed as it opened and keeps it after the room goes
// back to its timeline: the thread's root and the helper's reply, the helper's held tool call,
// which the panel approves, and a reply typed in the panel, which the room's own view of the
// thread then shows. Reply on the root in the panel drafts and sends in the panel's composer, a
// file staged there stays out of the page's send, and Up in the page's composer edits the page's
// message only. The profile card of the helper, opened from the panel's thread, closes on Escape
// alone; an Escape in the panel's composer then closes the panel. In a room where the account may
// not post, the panel shows the thread without a composer. On a phone the panel covers the page,
// its composer still completes mentions and attaches files, and the thread is read there.
//   MINDROOM_CLIENT_PLUGINS=$PWD/src/app/plugins/__fixtures__/example-plugin \
//     scripts/e2e-slot.sh <slot> --preview npx playwright test e2e/plugins/agent-thread-view.spec.ts
test.skip(
  !process.env.MINDROOM_CLIENT_PLUGINS?.includes('example-plugin'),
  'needs a build with the example client plugin in MINDROOM_CLIENT_PLUGINS'
);
test.describe.configure({ timeout: 360_000 });

const APPROVAL_EVENT = 'io.mindroom.tool_approval';

const threadPanel = (page: Page): Locator =>
  page.getByRole('region', { name: 'Example thread', exact: true });

/** The room page's own composer, not the panel's. */
const pageComposer = (page: Page): Locator =>
  page.locator('[data-room-footer] [data-editable-name="RoomInput"]');

/** Opens the "Example thread" panel from the room menu. */
const openThreadPanel = async (page: Page): Promise<Locator> => {
  await roomMoreOptions(page).click();
  await page.getByRole('menuitemcheckbox', { name: 'Example thread', exact: true }).click();
  const panel = threadPanel(page);
  await expect(panel).toBeVisible({ timeout: 30_000 });
  return panel;
};

/** A screenshot once the panel has moved in, its end at the window's. */
const shot = async (page: Page, name: string) => {
  const width = page.viewportSize()?.width ?? 0;
  await expect
    .poll(async () => {
      const box = await threadPanel(page).boundingBox();
      return box && Math.round(box.x + box.width);
    })
    .toBeLessThanOrEqual(width);
  await page.screenshot({ path: test.info().outputPath(`thread-view-${name}.png`) });
};

test("a plugin's panel shows a thread with its approvals and composer, as the room's page does", async ({
  page,
  stack,
}) => {
  await openLobby(page, stack);
  const word = uniqueWord('panel');
  const rootId = await startThread(stack, `${word} #approve`);
  await showThread(page, stack, rootId);
  await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.type === APPROVAL_EVENT && event.content.status === 'pending',
    { timeout: 90_000, description: 'a pending tool approval' }
  );
  const panel = await openThreadPanel(page);

  // The room goes back to its timeline; the panel keeps the thread.
  await showPath(page, `/home/${encodeURIComponent(stack.rooms.lobby)}`);
  await expect(page.locator('[data-thread-context-banner]')).toHaveCount(0, { timeout: 30_000 });
  await expect(messageRow(panel, rootId)).toContainText(word, { timeout: 60_000 });
  await expect(panel.locator(`[data-user-id="${stack.agents.helper}"]`).first()).toBeVisible({
    timeout: 60_000,
  });
  await shot(page, 'panel');

  // The helper's held tool call shows in the panel, which approves it.
  const bar = panel.getByRole('region', { name: 'Thread approvals' });
  await expect(bar).toContainText('Helper is waiting for you', { timeout: 90_000 });
  await bar.getByRole('button', { name: /^Review 1/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Helper wants to do 1 thing' });
  await dialog.getByRole('button', { name: 'Approve once' }).click();
  await expect(dialog).toContainText('Approved', { timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Close' }).click();
  await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.type === APPROVAL_EVENT && event.content.status === 'approved',
    { timeout: 90_000, description: 'the approved tool approval' }
  );
  await expect(bar).toBeHidden({ timeout: 60_000 });

  // A reply typed in the panel goes to the thread, and the room's own view of it shows it.
  const reply = `${word} from the panel`;
  const box = panel.getByRole('textbox');
  // Voice messages are the room page's.
  await expect(panel.getByRole('button', { name: 'Record voice message' })).toHaveCount(0);
  await box.click();
  await page.keyboard.type(reply);
  await page.keyboard.press('Enter');
  const sent = await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.sender === stack.tester.userId && event.content.body === reply,
    { timeout: 60_000, description: 'the reply sent from the panel' }
  );
  await expect(messageRow(panel, sent.event_id)).toContainText(reply, { timeout: 30_000 });

  // Reply on the root in the panel drafts in the panel's composer alone, and sends into the thread.
  const rootRow = messageRow(panel, rootId);
  await rootRow.hover();
  await rootRow.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Cancel reply' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel reply' })).toHaveCount(1);
  await expect(box).toBeFocused();
  const answer = `${word} answers the root`;
  await page.keyboard.type(answer);
  await page.keyboard.press('Enter');
  const answered = await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.sender === stack.tester.userId && event.content.body === answer,
    { timeout: 60_000, description: 'the reply to the root sent from the panel' }
  );
  expect(answered.content['m.relates_to']).toMatchObject({
    rel_type: 'm.thread',
    event_id: rootId,
    'm.in_reply_to': { event_id: rootId },
  });

  // A file staged in the panel stays out of the page's send, and goes with the panel's.
  const fileName = `${word}-panel.txt`;
  const chooser = page.waitForEvent('filechooser');
  await panel.getByRole('button', { name: 'Attach files' }).click();
  await (
    await chooser
  ).setFiles([{ name: fileName, mimeType: 'text/plain', buffer: Buffer.from('From the panel.') }]);
  await expect(panel.getByText(fileName, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(fileName, { exact: true })).toHaveCount(1);
  const pageText = `${word} on the page`;
  await pageComposer(page).click();
  await page.keyboard.type(pageText);
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await lobbyEvents(stack)).some((event) => bodyOf(event) === pageText), {
      timeout: 60_000,
    })
    .toBe(true);
  expect((await lobbyEvents(stack)).some((event) => bodyOf(event) === fileName)).toBe(false);
  await expect(panel.getByText(fileName, { exact: true })).toBeVisible();
  await box.click();
  await page.keyboard.press('Enter');
  await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.sender === stack.tester.userId && event.content.body === fileName,
    { timeout: 60_000, description: 'the file sent from the panel' }
  );

  // Up in the page's empty composer edits the page's own message, and nothing in the panel.
  await pageComposer(page).click();
  await page.keyboard.press('ArrowUp');
  const editBoxes = (scope: Page | Locator) =>
    scope.locator('[contenteditable="true"]:not([data-editable-name="RoomInput"])');
  await expect(editBoxes(page)).toHaveCount(1);
  await expect(editBoxes(page)).toContainText(pageText);
  await expect(editBoxes(panel)).toHaveCount(0);
  await shot(page, 'page-edit');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editBoxes(page)).toHaveCount(0);

  // The helper's profile card, opened from the panel's thread, closes on Escape alone.
  await panel.locator(`[data-user-id="${stack.agents.helper}"]`).first().click();
  const card = page.getByRole('dialog', { name: stack.agents.helper, exact: true });
  await expect(card).toBeVisible();
  await shot(page, 'profile-card');
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(panel).toBeVisible();

  // An Escape the composer leaves reaches the plugin, which closes its panel.
  await box.click();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  // The room's own view of the thread shows the reply.
  await showThread(page, stack, rootId);
  await expect(messageRow(page, sent.event_id)).toContainText(reply, { timeout: 30_000 });
});

/** A room the router made, where the tester has joined but may not post. */
const readOnlyRoom = async (stack: AgentStack) => {
  const router = routerToken(stack);
  const { room_id: roomId } = await matrixFetch<{ room_id: string }>(
    stack.homeserver,
    '/createRoom',
    {
      method: 'POST',
      accessToken: router,
      body: JSON.stringify({
        name: uniqueWord('Read only '),
        preset: 'private_chat',
        invite: [stack.tester.userId],
        power_level_content_override: { events_default: 50 },
      }),
    }
  );
  await joinRoom(stack.homeserver, stack.tester.accessToken, roomId);
  const word = uniqueWord('readonly');
  const rootId = await sendRoomMessage(stack.homeserver, router, roomId, {
    msgtype: 'm.text',
    body: `${word} root`,
  });
  return { roomId, rootId, word };
};

test("a plugin's panel shows a thread without a composer where the account may not post", async ({
  page,
  stack,
}) => {
  const { roomId, rootId, word } = await readOnlyRoom(stack);
  await openThread(page, { ...stack, rooms: { ...stack.rooms, lobby: roomId } }, rootId);
  const panel = await openThreadPanel(page);
  await expect(messageRow(panel, rootId)).toContainText(`${word} root`, { timeout: 60_000 });
  await expect(panel.getByRole('textbox')).toHaveCount(0);
  await shot(page, 'read-only');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("a plugin's panel over the page takes mentions, attachments and the thread's read marker", async ({
    page,
    stack,
  }) => {
    await openLobby(page, stack);
    const word = uniqueWord('phone');
    const rootId = await startThread(stack, word);
    await showThread(page, stack, rootId);
    const panel = await openThreadPanel(page);
    await expect(messageRow(panel, rootId)).toContainText(word, { timeout: 60_000 });

    // A message in the thread while the panel covers the page is read there.
    const later = `${word} later`;
    await sendRoomMessage(stack.homeserver, routerToken(stack), stack.rooms.lobby, {
      msgtype: 'm.text',
      body: later,
      'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
    });
    await expect(panel.getByText(later, { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => (await serverUnreadCounts(stack, stack.rooms.lobby)).threads[rootId] ?? 0, {
        timeout: 60_000,
      })
      .toBe(0);

    // Mentions complete in the panel's composer.
    const box = panel.getByRole('textbox');
    await box.click();
    await page.keyboard.type('@Hel');
    await expect(panel.getByText(stack.agents.helper, { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await shot(page, 'phone-mention');
    // Escape closes the suggestions alone: the panel stays.
    await page.keyboard.press('Escape');
    await expect(panel.getByText(stack.agents.helper, { exact: true })).toHaveCount(0);
    await expect(panel).toBeVisible();

    // Attach, in the composer's More actions menu, stages a file in the panel.
    const fileName = `${word}-phone.txt`;
    await panel.getByRole('button', { name: 'More actions' }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: 'Attach files' }).click();
    await (
      await chooser
    ).setFiles([{ name: fileName, mimeType: 'text/plain', buffer: Buffer.from('From a phone.') }]);
    await expect(panel.getByText(fileName, { exact: true })).toBeVisible({ timeout: 20_000 });
  });
});
