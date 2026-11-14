import { expect, test, type Locator } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// The members panel's header buttons (Invite people, Close) answer the pointer as the room
// header's buttons beside them do: no fill at rest, a fill while hovered. Runs in Chromium against
// the homeserver of `just hs-up` or of an e2e slot.
const PASSWORD = 'members-header-hover-spec-password';
const RUN = Date.now().toString(36);

test.use({
  viewport: { width: 1280, height: 800 },
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const fill = (button: Locator) =>
  button.evaluate((element) => getComputedStyle(element).backgroundColor);

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('the members header buttons fill while hovered, as the room header buttons do', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const username = `mhh_host_${RUN}`;
  const host = await registerDisposableUser(username, PASSWORD);
  const roomId = await createRoom(HOMESERVER, host.accessToken, { name: `Hover room ${RUN}` });
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);

  const invite = page.getByRole('button', { name: 'Invite people' });
  await expect(invite).toBeVisible({ timeout: 60_000 });
  const close = invite.locator('xpath=..').getByRole('button', { name: 'Close', exact: true });
  const hideMembers = page.getByRole('button', { name: 'Hide Members' });

  for (const [name, button] of [
    ['Hide Members', hideMembers],
    ['Invite people', invite],
    ['Close', close],
  ] as const) {
    await page.mouse.move(0, 0);
    await expect.poll(() => fill(button), { message: `${name} at rest` }).toBe(TRANSPARENT);
    await button.hover();
    await expect.poll(() => fill(button), { message: `${name} hovered` }).not.toBe(TRANSPARENT);
  }
});
