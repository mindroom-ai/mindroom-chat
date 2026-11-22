import { expect, test } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom } from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// A laptop window (1280 px with the sidebar) leaves the room too narrow to read beside the
// members, so they start closed there, one click away in the header; a 1440 px window keeps them
// beside the room. Opened at 1280 px they stay open there after a reload, and a window that
// narrows never closes members already shown. Runs against the homeserver of `just hs-up` or of an
// e2e slot.
const PASSWORD = 'members-reading-width-spec-password';
const RUN = Date.now().toString(36);
const LAPTOP = { width: 1280, height: 800 };
const WIDE = { width: 1440, height: 800 };

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('the members start closed beside a room too narrow to read beside them', async ({ page }) => {
  test.setTimeout(180_000);
  const reader = await registerDisposableUser(`mrw_r_${RUN}`, PASSWORD);
  const other = await registerDisposableUser(`mrw_o_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: `Project Alpha ${RUN}`,
    invite: [other.userId],
  });
  await joinRoom(HOMESERVER, other.accessToken, roomId);
  await page.setViewportSize(WIDE);
  await loginWithPassword(page, { homeserver: HOMESERVER, ...reader });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);

  const panel = page.getByTestId('resizable-members-panel');
  const composer = page.getByRole('textbox', { name: 'Send a message...' });
  const showMembers = page.getByRole('button', { name: 'Show Members', exact: true });
  const reload = async () => {
    await page.reload();
    await expect(composer).toBeVisible({ timeout: 60_000 });
  };

  // Wide: beside the room, as before. Narrowed to a laptop, they stay.
  await expect(panel).toBeVisible({ timeout: 60_000 });
  await page.setViewportSize(LAPTOP);
  await expect(composer).toBeVisible();
  await expect(panel).toBeVisible();

  // Opened afresh on the laptop, the room has the width; the header offers the members.
  await reload();
  await expect(showMembers).toBeVisible();
  await expect(panel).toHaveCount(0);

  // Asked for there, they open beside the room and stay open after a reload.
  await showMembers.click();
  await expect(panel).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Members', exact: true })).toHaveCount(0);
  await reload();
  await expect(panel).toBeVisible();

  // Closed there, they are closed on a wide window too.
  await page.getByRole('button', { name: 'Hide Members', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.setViewportSize(WIDE);
  await reload();
  await expect(showMembers).toBeVisible();
  await expect(panel).toHaveCount(0);
});
