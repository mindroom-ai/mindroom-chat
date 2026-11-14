import type { Locator, Page } from '@playwright/test';
import {
  expect,
  openLobby,
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
// in the thread, mentioning them; Chat shows it as the slim snooze-ended row, and the thread is
// back in Activity. The backend learns of the snooze from the live state event alone. Until
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
  await waitForAgentReply(stack, rootId, () => true, { timeout: 120_000 });
  await showThread(page, stack, rootId);

  const stateKey = JSON.stringify([rootId, 'snoozed']);
  const until = new Date(Date.now() + 5_000).toISOString();
  await sendStateEvent(
    stack.homeserver,
    stack.tester.accessToken,
    stack.rooms.lobby,
    TAGS_EVENT,
    stateKey,
    { set_by: stack.tester.userId, set_at: new Date().toISOString(), data: { until } }
  );
  const sentAt = Date.now();

  // Within 30 seconds of the snooze being set, its end is in the thread.
  await expect(page.locator('[data-thread-snooze-ended]')).toBeVisible({
    timeout: Math.max(1_000, sentAt + 30_000 - Date.now()),
  });
  await expect(page.locator('[data-thread-snooze-ended]')).toHaveText('Snooze ended');
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
  await expect(page.locator('[data-thread-context-banner] [data-thread-snoozed]')).toHaveCount(0);

  const popover = await openActivity(page);
  await expect(popover.locator('[data-activity-row]').filter({ hasText: word })).toBeVisible({
    timeout: 30_000,
  });
});
