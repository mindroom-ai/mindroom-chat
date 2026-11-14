import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { joinRoom, matrixFetch, sendRoomMessage, type MatrixSession } from '../helpers/matrix';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// Notifications against the disposable homeserver of `just hs-up` (or a slot of
// scripts/e2e-slot.sh): a room's mode from the header menu, desktop notifications for messages
// from another account and where a click on one leads, and the mention's row in Activity. Each run
// registers its own two accounts.
const PASSWORD = 'notifications-spec-password';
const RUN = Date.now().toString(36);

type ShownNotification = { title: string; body?: string; tag?: string };

const registerAndLogin = (name: string): Promise<MatrixSession & { username: string }> =>
  registerDisposableUser(`f7_${name}_${RUN}`, PASSWORD);

/**
 * The browser's Notification API as a recorder: permission granted, every notification kept on
 * `window.shownNotifications`, and `window.clickNotification(i)` clicks one.
 */
const recordNotifications = (page: Page) =>
  page.addInitScript(() => {
    type Recorded = { title: string; body?: string; tag?: string; onclick: (() => void) | null };
    const shown: Recorded[] = [];
    const recorder = window as unknown as {
      shownNotifications: Recorded[];
      clickNotification: (index: number) => void;
    };
    recorder.shownNotifications = shown;
    recorder.clickNotification = (index) => shown[index]?.onclick?.();
    class RecordingNotification {
      static permission = 'granted';

      static requestPermission = async () => 'granted';

      onclick: (() => void) | null = null;

      constructor(title: string, options: NotificationOptions = {}) {
        const entry: Recorded = { title, body: options.body, tag: options.tag, onclick: null };
        shown.push(entry);
        Object.defineProperty(this, 'onclick', {
          get: () => entry.onclick,
          set: (handler: (() => void) | null) => {
            entry.onclick = handler;
          },
        });
      }

      close() {
        return undefined;
      }
    }
    Object.defineProperty(window, 'Notification', { value: RecordingNotification });
  });

/** Moves within the app without reloading it, as its own links do. */
const openPath = (page: Page, path: string) =>
  page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);

const shownNotifications = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { shownNotifications: ShownNotification[] }).shownNotifications.map(
      ({ title, body, tag }) => ({ title, body, tag })
    )
  );

const mention = (userId: string, text: string) => ({
  msgtype: 'm.text',
  body: `${userId} ${text}`,
  'm.mentions': { user_ids: [userId] },
});

const inThread = (rootId: string, content: Record<string, unknown>) => ({
  ...content,
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('the room header menu switches the room notification mode', async ({ page }) => {
  test.setTimeout(240_000);
  const owner = await registerAndLogin('mode');
  const roomId = await createRoom(HOMESERVER, owner.accessToken, { name: 'Release Train' });
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: owner.username,
    password: PASSWORD,
  });

  await page.getByRole('link', { name: /Release Train/ }).click();
  await page.getByRole('button', { name: 'More Options', exact: true }).last().click();
  await page.getByRole('menuitem', { name: 'Notifications', exact: true }).click();
  const modes = page.getByRole('menu', { name: 'Notifications' });
  await expect(modes.getByRole('menuitemradio', { name: 'Default' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await modes.getByRole('menuitemradio', { name: 'Mute' }).click();

  // A mute is an override rule named after the room that does nothing (spec, "Push Rules").
  await expect
    .poll(async () => {
      const rule = await matrixFetch<{ actions: unknown[] }>(
        HOMESERVER,
        `/pushrules/global/override/${encodeURIComponent(roomId)}`,
        { accessToken: owner.accessToken }
      ).catch(() => undefined);
      return rule?.actions;
    })
    .toEqual([]);
  await expect(page.getByRole('link', { name: /Release Train/ }).getByLabel('Muted')).toBeVisible();

  await page.getByRole('button', { name: 'More Options', exact: true }).last().click();
  await page.getByRole('menuitem', { name: 'Notifications', exact: true }).click();
  await expect(modes.getByRole('menuitemradio', { name: 'Mute' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await modes.getByRole('menuitemradio', { name: 'Mention & Keywords' }).click();
  await expect
    .poll(async () => {
      const rule = await matrixFetch<{ actions: unknown[] }>(
        HOMESERVER,
        `/pushrules/global/room/${encodeURIComponent(roomId)}`,
        { accessToken: owner.accessToken }
      ).catch(() => undefined);
      return rule?.actions;
    })
    .toEqual([]);
});

test('messages from another account notify, and a click opens their room or thread', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const reader = await registerAndLogin('reader');
  const writer = await registerAndLogin('writer');
  const quietId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Quiet Corner',
    invite: [writer.userId],
  });
  const busyId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Busy Desk',
    invite: [writer.userId],
  });
  await joinRoom(HOMESERVER, writer.accessToken, quietId);
  await joinRoom(HOMESERVER, writer.accessToken, busyId);
  const rootId = await sendRoomMessage(HOMESERVER, writer.accessToken, busyId, {
    msgtype: 'm.text',
    body: 'Planning the launch',
  });

  await recordNotifications(page);
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await page.getByRole('link', { name: /Quiet Corner/ }).click();
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(quietId)));

  // The open room's messages are on screen already; another room's mention notifies.
  await sendRoomMessage(HOMESERVER, writer.accessToken, quietId, {
    msgtype: 'm.text',
    body: 'Seen right here',
  });
  await sendRoomMessage(
    HOMESERVER,
    writer.accessToken,
    busyId,
    inThread(rootId, mention(reader.userId, 'can you check the numbers?'))
  );
  await expect
    .poll(() => shownNotifications(page), { timeout: 30_000 })
    .toEqual([
      {
        title: 'Busy Desk',
        body: expect.stringContaining('can you check the numbers?'),
        tag: busyId,
      },
    ]);

  // Activity lists the mention as one, while it is unread.
  await openPath(page, '/activity/');
  const activity = page.getByRole('navigation', { name: 'Activity' });
  const row = activity.locator('[data-activity-row]').filter({
    hasText: 'can you check the numbers?',
  });
  await expect(row).toHaveAttribute('data-activity-row', 'mention', { timeout: 30_000 });
  await expect(row).toContainText('mentioned you');

  await openPath(page, `/home/${encodeURIComponent(quietId)}/`);
  await page.evaluate(() =>
    (window as unknown as { clickNotification: (index: number) => void }).clickNotification(0)
  );
  await expect(page).toHaveURL(
    new RegExp(`${encodeURIComponent(busyId)}.*threadId=${encodeURIComponent(rootId)}`)
  );

  // Read now, the thread keeps its row in Activity, which leads to it too, beside the list.
  await openPath(page, '/activity/');
  await row.getByRole('button').first().click();
  await expect(page).toHaveURL(
    new RegExp(`/activity/[^/?]+/?\\?threadId=${encodeURIComponent(rootId)}`)
  );
  await expect(activity).toBeVisible();
});
