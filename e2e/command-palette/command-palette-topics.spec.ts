import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, joinRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { pressPaletteShortcut } from '../helpers/paletteShortcut';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Rooms often share words in their topics. In the command palette, a room whose name holds the
// typed word comes before rooms that only mention it in their topic, unread ones included, and
// the Messages section lists messages only: a topic is not a message, though the server's search
// also matches room topics. 14 rooms with the same topic, most of them unread, one with a long
// name that holds the word.
const PASSWORD = 'command-palette-topics-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const NAMED = 'Quarterly planning for the customer onboarding experience redesign';

test.use({ viewport: { width: 1280, height: 800 } });

const register = async (name: string) => {
  const username = `cpt_${name}_${RUN}`;
  const body = await matrixFetch<{ user_id: string; access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  return { username, userId: body.user_id, accessToken: body.access_token };
};

type Seed = { username: string; named: string };
let seeded: Promise<Seed> | undefined;

const seed = async (): Promise<Seed> => {
  const owner = await register('owner');
  const peer = await register('peer');
  const names = [...Array.from({ length: 13 }, (_, i) => `Team room ${i + 1}`), NAMED];
  const rooms: string[] = [];
  for (const name of names) {
    rooms.push(
      await createPrivateRoom(HOMESERVER, owner.accessToken, {
        name,
        topic: 'Talk about the plan',
        invite: [peer.userId],
      })
    );
  }
  // The other rooms are unread, which lifts them in the palette's ranking.
  await Promise.all(
    rooms.map(async (roomId, index) => {
      await joinRoom(HOMESERVER, peer.accessToken, roomId);
      if (index < 13) {
        await sendRoomMessage(HOMESERVER, peer.accessToken, roomId, {
          msgtype: 'm.text',
          body: 'The draft is ready for another look.',
        });
      }
    })
  );
  await sendRoomMessage(HOMESERVER, peer.accessToken, rooms[0]!, {
    msgtype: 'm.text',
    body: 'Here is the plan for the week.',
  });
  return { username: owner.username, named: rooms.at(-1)! };
};

const palette = (page: Page) => page.getByRole('dialog', { name: 'Command palette', exact: true });
const options = (page: Page, kind: string) =>
  palette(page).locator(`[role="option"][data-kind="${kind}"]`);

const signIn = async (page: Page) => {
  seeded ??= seed();
  const { username } = await seeded;
  // The slot has no provisioning service.
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
};

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

test('a room named after the typed word comes before rooms that only mention it', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await pressPaletteShortcut(page);
  await palette(page).getByRole('combobox').fill('plan');
  await expect(options(page, 'room').first()).toHaveText(new RegExp(NAMED));
});

test('the Messages section lists messages, not room topics', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  await pressPaletteShortcut(page);
  await palette(page).getByRole('combobox').fill('plan');
  const messages = options(page, 'message');
  await expect(messages.filter({ hasText: 'Here is the plan for the week.' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(messages).toHaveCount(1);
  await expect(palette(page)).not.toContainText('m.room.topic');
});
