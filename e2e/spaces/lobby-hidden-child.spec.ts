import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { addRoomToSpace } from '../helpers/matrix';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A space's lobby lists the rooms a member can see. An invite-only child that the server neither
// lists in the space's hierarchy nor describes to the member got a card titled with its raw room
// ID and a warning icon (live-test finding P2-lane4-F009); it now gets no card, as in MindRoom
// Chat. Runs in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in
// WebKit, against the disposable homeserver of `just hs-up` (or a slot of scripts/e2e-slot.sh).
// Set LOBBY_HIDDEN_SHOTS=<directory> for screenshots.
const PASSWORD = 'lobby-hidden-child-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.LOBBY_HIDDEN_SHOTS;
const SERVER_NAME = 'matrix.localhost';

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const lobbyListsOnlyVisibleRooms = async (page: Page, label: string) => {
  const owner = await registerDisposableUser(`lhc_owner_${label}_${RUN}`, PASSWORD);
  const member = await registerDisposableUser(`lhc_member_${label}_${RUN}`, PASSWORD);
  const spaceId = await createRoom(HOMESERVER, owner.accessToken, {
    name: `Field team ${label}`,
    preset: 'public_chat',
    space: true,
  });
  const openId = await createRoom(HOMESERVER, owner.accessToken, {
    name: 'Site visits',
    preset: 'public_chat',
  });
  const closedId = await createRoom(HOMESERVER, owner.accessToken, {
    name: 'Leads only',
    preset: 'private_chat',
  });
  await addRoomToSpace(HOMESERVER, owner.accessToken, spaceId, openId);
  await addRoomToSpace(HOMESERVER, owner.accessToken, spaceId, closedId);

  await loginWithPassword(page, { homeserver: HOMESERVER, ...member });
  await page.goto(`/${encodeURIComponent(spaceId)}/?via=${SERVER_NAME}`);
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page).toHaveURL(/\/lobby\/?$/, { timeout: 30_000 });
  const openCard = page.locator(`[data-lobby-entry="${openId}"]`);
  await expect(openCard.getByText('Site visits', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  // Long enough for the lobby to ask the server about the closed room, and give up.
  await page.waitForTimeout(3_000);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/lobby-hidden-${label}.png` });
  await expect(page.getByText(closedId)).toHaveCount(0);
  await expect(page.locator(`[data-lobby-entry="${closedId}"]`)).toBeHidden();
};

test('a lobby lists no card for a room the member cannot see (Chromium)', async ({ page }) => {
  test.setTimeout(180_000);
  await lobbyListsOnlyVisibleRooms(page, 'chromium');
});

test('a lobby lists no card for a room the member cannot see (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  await onWebKitPage({ viewport: { width: 1280, height: 800 }, baseURL }, (page) =>
    lobbyListsOnlyVisibleRooms(page, 'webkit')
  );
});
