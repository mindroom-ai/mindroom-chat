import type { Locator, Page } from '@playwright/test';
import {
  bodyOf,
  expect,
  openLobby,
  showPath,
  showThread,
  startThread,
  test,
  uniqueWord,
  waitForAgentReply,
  waitForThreadEvent,
} from '../helpers/agentStack';
import { getStateEvent, sendStateEvent } from '../helpers/matrix';

// A snooze ending with a live MindRoom backend: the person's own client writes the `snoozed` tag a
// few seconds ahead, and when that time comes the backend clears the tag and posts "Snooze ended"
// in the thread, mentioning them. The thread's Activity row, read before, leaves while the snooze
// runs and comes back unread, as a mention with that message as its preview; the thread shows it
// as the slim snooze-ended row. The backend learns of the snooze from the live state event alone. Until
// MindRoom's main has native snooze, run it with E2E_MINDROOM_CHECKOUT and E2E_MINDROOM_REF naming
// a checkout and branch that do.
test.describe.configure({ timeout: 300_000 });

const TAGS_EVENT = 'com.mindroom.thread.tags';
const SNOOZE_EVENT_KEY = 'io.mindroom.thread_snooze';

/** Opens the rail's Activity popover and returns it. */
const openActivity = async (page: Page): Promise<Locator> => {
  await page
    .getByRole('button', { name: /^Activity/ })
    .first()
    .click();
  const popover = page.getByRole('dialog', { name: 'Activity' });
  await expect(popover).toBeVisible();
  return popover;
};

test('a snooze set by the person ends on time: the backend clears it and Chat shows the row', async ({
  page,
  stack,
}) => {
  await openLobby(page, stack);
  const word = uniqueWord('snooze');
  const rootId = await startThread(stack, `${word} remind me later`);
  const reply = await waitForAgentReply(stack, rootId, () => true, { timeout: 120_000 });
  // The router's automatic summary follows the reply as a message of the thread; once it is in,
  // nothing else comes until the wake.
  await waitForThreadEvent(
    stack,
    rootId,
    (event) => 'io.mindroom.thread_summary' in event.content,
    {
      timeout: 120_000,
      description: 'the automatic summary',
    }
  );
  // Read the thread, then leave it once its receipt went: its Activity row is read and says
  // nothing of a snooze.
  const threadReceipt = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      request.url().includes('/receipt/m.read/') &&
      request.postDataJSON()?.thread_id === rootId,
    { timeout: 60_000 }
  );
  await showThread(page, stack, rootId);
  await threadReceipt;
  await showPath(page, `/home/${encodeURIComponent(stack.rooms.lobby)}`);
  const popover = await openActivity(page);
  const row = popover.locator('[data-activity-row]').filter({ hasText: word });
  await expect(row).toBeVisible({ timeout: 60_000 });
  // An unread row writes its sentence in bold.
  await expect(row.locator('b')).toHaveCount(0, { timeout: 30_000 });
  await expect(row).not.toHaveAttribute('data-activity-row', 'mention');
  await expect(row).not.toContainText('Snooze ended');
  expect(bodyOf(reply)).not.toContain('Snooze ended');

  const stateKey = JSON.stringify([rootId, 'snoozed']);
  const untilTs = Date.now() + 5_000;
  const until = new Date(untilTs).toISOString();
  await sendStateEvent(
    stack.homeserver,
    stack.tester.accessToken,
    stack.rooms.lobby,
    TAGS_EVENT,
    stateKey,
    { set_by: stack.tester.userId, set_at: new Date().toISOString(), data: { until } }
  );
  const sentAt = Date.now();
  const deadline = () => Math.max(1_000, sentAt + 30_000 - Date.now());

  // While the snooze runs, the thread has no row.
  await expect(row).toHaveCount(0, { timeout: Math.max(500, untilTs - Date.now()) });
  // Within 30 seconds of the snooze being set, the wake brings it back unread, as a mention, with
  // the snooze's end as its preview.
  await expect(row).toHaveAttribute('data-activity-row', 'mention', { timeout: deadline() });
  await expect(row.locator('b')).toHaveCount(1, { timeout: deadline() });
  await expect(row).toContainText('Snooze ended', { timeout: deadline() });

  const ended = await waitForThreadEvent(
    stack,
    rootId,
    (event) => SNOOZE_EVENT_KEY in event.content,
    { timeout: 10_000, description: 'the snooze-ended message' }
  );
  const marker = ended.content[SNOOZE_EVENT_KEY] as { event?: unknown; until?: unknown };
  expect(marker.event).toBe('ended');
  // The same moment, however the backend writes it.
  expect(Date.parse(String(marker.until))).toBe(Date.parse(until));
  expect(ended.content['m.mentions']).toEqual(
    expect.objectContaining({ user_ids: [stack.tester.userId] })
  );
  await expect
    .poll(
      () =>
        getStateEvent(
          stack.homeserver,
          stack.tester.accessToken,
          stack.rooms.lobby,
          TAGS_EVENT,
          stateKey
        ),
      { timeout: 10_000 }
    )
    .toEqual({});

  // The thread shows the snooze's end as its slim row, and no longer says it is snoozed.
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await showThread(page, stack, rootId);
  await expect(page.locator('[data-thread-snooze-ended]')).toHaveText('Snooze ended');
  // A marker row of its own, not an agent message: no avatar, sender name or toolbar.
  const wakeRow = page.locator('[data-message-id]', {
    has: page.locator('[data-thread-snooze-ended]'),
  });
  await expect(wakeRow).toHaveCount(1);
  await expect(wakeRow.locator('[data-message-sender-line], [data-user-id]')).toHaveCount(0);
  await expect(wakeRow).toHaveText('Snooze ended');
  await expect(page.locator('[data-thread-context-banner] [data-thread-snoozed]')).toHaveCount(0);
});
