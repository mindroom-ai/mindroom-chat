import { expect, test, type Page } from '@playwright/test';
import { buildLoginPath } from '../env';
import { activeAccountButton } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import { createPrivateRoom, joinRoom, sendRoomMessage } from '../helpers/matrix';

// The Threads section: the person's threads grouped by state (an agent's new reply under Unread,
// a read thread under Recent), Mine, Following and All, the automations folded under All, and a
// row that opens its thread beside the list.
test.describe.configure({ mode: 'serial', timeout: 240_000 });

const PASSWORD = 'threads-e2e-password';
const RUN = Date.now().toString(36);

type Fixture = { person: DisposableUser; mine: string; joined: string; digest: string };

const inThread = (rootId: string) => ({
  'm.relates_to': { rel_type: 'm.thread', event_id: rootId, is_falling_back: true },
});

let fixture: Fixture;

test.beforeAll(async ({ browserName }) => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
  const person = await registerDisposableUser(`thr_p_${browserName}_${RUN}`, PASSWORD);
  const friend = await registerDisposableUser(`thr_f_${browserName}_${RUN}`, PASSWORD);
  const agent = await registerDisposableUser(`mindroom_thr_${browserName}_${RUN}`, PASSWORD);
  const roomId = await createPrivateRoom(HOMESERVER, person.accessToken, {
    name: `Threads ${RUN}`,
    topic: 'Threads grouped by state',
    invite: [agent.userId, friend.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  await joinRoom(HOMESERVER, friend.accessToken, roomId);
  const send = (user: DisposableUser, body: string, extra: object = {}) =>
    sendRoomMessage(HOMESERVER, user.accessToken, roomId, { msgtype: 'm.text', body, ...extra });

  // The person's own thread, which an agent answers.
  const mine = await send(person, `Plan the board deck ${RUN}`);
  await send(agent, 'Here is a first outline.', inThread(mine));
  // A friend's thread the person replied in.
  const joined = await send(friend, `Dinner on Friday ${RUN}?`);
  await send(person, 'Yes, count me in.', inThread(joined));
  await send(friend, 'Great, 7 pm.', inThread(joined));
  // A run an agent did on its own: nobody else wrote in it.
  const digest = await send(agent, `Daily digest ${RUN}`);
  await send(agent, 'Nothing new today.', inThread(digest));
  fixture = { person, mine, joined, digest };
});

const signIn = async (page: Page, user: DisposableUser) => {
  await page.goto(buildLoginPath(HOMESERVER));
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(HOMESERVER, {
    timeout: 60_000,
  });
  await page.locator('input[name="usernameInput"]').fill(user.username);
  await page.locator('input[name="passwordInput"]').fill(user.password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(activeAccountButton(page)).toBeVisible({ timeout: 120_000 });
};

test('groups the followed threads, switches scope and opens a thread beside the list', async ({
  page,
}) => {
  await signIn(page, fixture.person);
  // The rail's Threads button is one a person turns on in Settings; the page is there either way.
  await page.goto('/threads/');
  const list = page.getByRole('navigation', { name: 'Threads' });

  const unread = list.getByRole('region', { name: 'Unread' });
  await expect(unread.getByText(`Plan the board deck ${RUN}`)).toBeVisible({ timeout: 90_000 });
  await expect(unread).toContainText('Here is a first outline.');
  await expect(unread.getByText(`Dinner on Friday ${RUN}?`)).toBeVisible();
  await expect(list.getByText(`Daily digest ${RUN}`)).toBeHidden();

  await list.getByRole('radio', { name: 'Mine' }).click();
  await expect(list.getByText(`Dinner on Friday ${RUN}?`)).toBeHidden();
  await expect(list.getByText(`Plan the board deck ${RUN}`)).toBeVisible();

  await list.getByRole('radio', { name: 'All' }).click();
  const automations = list.getByRole('button', { name: /^Automations · 1$/ });
  await expect(automations).toBeVisible();
  await automations.click();
  await expect(list.getByText(`Daily digest ${RUN}`)).toBeVisible();

  await list.getByRole('radio', { name: 'Following' }).click();
  await list.getByText(`Plan the board deck ${RUN}`).click();
  await expect(page).toHaveURL(
    new RegExp(`/threads/[^/?]+\\?threadId=${encodeURIComponent(fixture.mine)}`)
  );
  await expect(page.getByRole('main').getByText('Here is a first outline.')).toBeVisible({
    timeout: 60_000,
  });
  await expect(list).toBeVisible();
  // Read, it moves from Unread to Recent.
  await expect(
    list.getByRole('region', { name: 'Recent' }).getByText(`Plan the board deck ${RUN}`)
  ).toBeVisible({
    timeout: 60_000,
  });
});
