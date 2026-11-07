import type { Locator, Page } from '@playwright/test';
import { sendRoomMessage } from '../helpers/matrix';
import {
  composer,
  expect,
  messageRow,
  openLobby,
  routerToken,
  test,
  uniqueWord,
} from '../helpers/agentStack';
import { setRoomCompact } from '../helpers/roomViewSwitch';

// An agent can start a conversation with a notice, such as a card or a report, by putting
// `io.mindroom.conversation: true` in its content. The thread list shows such a notice from a
// MindRoom agent on the reader's homeserver as a conversation, and leaves out a notice the agent
// did not mark and a marked notice from a person. Runs against the agent stack
// (scripts/agent-stack/stack.py) with the stub model, where the router is that agent; MindRoom's
// agents never answer a notice, so each notice stays a conversation without replies. Skips without
// a MindRoom checkout.

const card = (page: Page, rootId: string): Locator =>
  page.locator(`button[data-thread-root-id="${rootId}"]`);

test("an agent's marked notice lists as a conversation", async ({ page, stack }) => {
  test.setTimeout(300_000);
  const word = uniqueWord('notice');
  const report = `${word} weekly report`;
  await openLobby(page, stack);
  await setRoomCompact(page, true);

  const send = (accessToken: string, body: string, marked: boolean) =>
    sendRoomMessage(stack.homeserver, accessToken, stack.rooms.lobby, {
      msgtype: 'm.notice',
      body,
      ...(marked ? { 'io.mindroom.conversation': true } : {}),
    });
  const agent = routerToken(stack);
  const notices = {
    unmarked: await send(agent, `${word} indexing finished`, false),
    fromPerson: await send(stack.tester.accessToken, `${word} a card from a person`, true),
    marked: await send(agent, report, true),
  };
  // The notices that stay out were sent first, so the client holds them once the marked one shows.
  const expectListed = async () => {
    await expect(card(page, notices.marked)).toBeVisible({ timeout: 90_000 });
    await expect(card(page, notices.marked)).toContainText(report);
    await expect(card(page, notices.unmarked)).toHaveCount(0);
    await expect(card(page, notices.fromPerson)).toHaveCount(0);
  };

  // Arriving live, and again from the stored timeline after a reload.
  await expectListed();
  await page.screenshot({ path: test.info().outputPath('conversation-notice-live.png') });
  await page.reload({ timeout: 180_000 });
  await expect(composer(page)).toBeVisible({ timeout: 90_000 });
  await expectListed();
  await page.screenshot({ path: test.info().outputPath('conversation-notice-reload.png') });

  // Its card opens it as a conversation: the thread, with the notice as its root.
  await card(page, notices.marked).click();
  await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 60_000 });
  await expect(messageRow(page, notices.marked)).toContainText(report, { timeout: 60_000 });
  await page.screenshot({ path: test.info().outputPath('conversation-notice-thread.png') });
});
