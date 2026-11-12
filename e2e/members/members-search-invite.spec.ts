import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, joinRoom, matrixFetch } from '../helpers/matrix';

// The members panel's search also invites: under the members it matches, the people outside the
// room it finds in the user directory, each with an Invite button. One click invites; the row
// stays where it was, marked Invited, and the header counts the invitation.
// Set MEMBERS_INVITE_SHOTS=<directory> to also save screenshots of the panel before and after.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const SHOTS = process.env.MEMBERS_INVITE_SHOTS;
const PASSWORD = 'members-search-invite-spec-password';
const ROOM_NAME = 'Launch War Room';

test.use({ viewport: { width: 1440, height: 900 } });

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
});

const register = async (username: string, displayName: string) => {
  const account = await matrixFetch<{ user_id: string; access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  await matrixFetch<unknown>(
    HOMESERVER,
    `/profile/${encodeURIComponent(account.user_id)}/displayname`,
    {
      method: 'PUT',
      accessToken: account.access_token,
      body: JSON.stringify({ displayname: displayName }),
    }
  );
  return { userId: account.user_id, accessToken: account.access_token };
};

/**
 * A reader and Maya in the room, and Marco and Mara, who share another room with the reader, so
 * the user directory lists them. "ma" matches all three and the reader's own name.
 */
const seed = async () => {
  const run = Date.now().toString(36).slice(-6);
  const username = `members_invite_${run}`;
  const reader = await register(username, 'Priya Raman');
  const [maya, marco, mara] = await Promise.all([
    register(`maya_${run}`, 'Maya Chen'),
    register(`marco_${run}`, 'Marco Rossi'),
    register(`mara_${run}`, 'Mara Lind'),
  ]);
  const shared = await createPrivateRoom(HOMESERVER, reader.accessToken, {
    name: 'Company',
    topic: '',
    invite: [marco.userId, mara.userId],
  });
  await Promise.all(
    [marco, mara].map((person) => joinRoom(HOMESERVER, person.accessToken, shared))
  );
  const roomId = await createPrivateRoom(HOMESERVER, reader.accessToken, {
    name: ROOM_NAME,
    topic: 'Everything for the Q4 instrument launch',
    invite: [maya.userId],
  });
  await joinRoom(HOMESERVER, maya.accessToken, roomId);
  return { run, username, reader, maya, marco, mara, roomId };
};

/** Searches the directory for this run's accounts only, whatever else the homeserver holds. */
const scopeDirectory = (page: Page, run: string) =>
  page.route('**/user_directory/search', (route) =>
    route.continue({
      postData: JSON.stringify({
        ...(route.request().postDataJSON() as Record<string, unknown>),
        search_term: run,
      }),
    })
  );

const shoot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.mouse.move(1, 1);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, scale: 'css' });
};

test('the members search invites people outside the room', async ({ page }) => {
  test.setTimeout(180_000);
  const seeded = await seed();
  await scopeDirectory(page, seeded.run);
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seeded.username,
    password: PASSWORD,
  });

  const entry = page.locator('a[href^="/home/"]').filter({ hasText: ROOM_NAME }).first();
  await expect(entry).toBeVisible({ timeout: 60_000 });
  await entry.click();
  const showMembers = page.getByRole('button', { name: 'Members', exact: true });
  await expect(showMembers.or(page.getByRole('button', { name: 'Hide Members' }))).toBeVisible();
  if (await showMembers.isVisible()) await showMembers.click();

  const search = page.getByRole('textbox', { name: 'Search or invite people...' });
  await expect(search).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(`button[data-user-id="${seeded.maya.userId}"]`)).toBeVisible({
    timeout: 20_000,
  });
  await shoot(page, 'members-idle');

  await search.fill('ma');
  // The member who matches stays in the members list; the others are offered under it.
  await expect(page.locator(`button[data-user-id="${seeded.maya.userId}"]`)).toBeVisible();
  const outside = page.getByRole('group', { name: 'Not in this room' });
  const rows = outside.getByRole('listitem');
  await expect(rows).toHaveCount(2, { timeout: 30_000 });
  await expect(rows.filter({ hasText: 'Marco Rossi' })).toContainText(seeded.marco.userId);
  await expect(rows.filter({ hasText: 'Mara Lind' })).toContainText(seeded.mara.userId);
  await expect(outside).not.toContainText('Maya Chen');
  await expect(outside).not.toContainText('Priya Raman');
  await shoot(page, 'members-search');

  const order = await rows.allTextContents();
  await outside.getByRole('button', { name: 'Invite Marco Rossi' }).click();
  await expect(rows.filter({ hasText: 'Marco Rossi' })).toContainText('Invited');
  await expect(outside.getByRole('button', { name: 'Invite Marco Rossi' })).toHaveCount(0);
  // The row keeps its place although the directory search now leaves Marco out.
  await expect(rows).toHaveCount(2);
  expect((await rows.allTextContents()).map((text) => text.slice(0, 8))).toEqual(
    order.map((text) => text.slice(0, 8))
  );
  await expect(page.getByRole('button', { name: '1 Invited' })).toBeVisible();
  const membership = await matrixFetch<{ membership: string }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(seeded.roomId)}/state/m.room.member/${encodeURIComponent(
      seeded.marco.userId
    )}`,
    { accessToken: seeded.reader.accessToken }
  );
  expect(membership.membership).toBe('invite');
  await shoot(page, 'members-invited');

  // A new search no longer offers the person invited.
  await search.fill('mar');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Mara Lind');
});
