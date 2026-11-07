import {
  composer,
  createEncryptedAgentRoom,
  expect,
  mentionHelper,
  openNewSession,
  test,
} from '../helpers/agentStack';
import { setRoomCompact } from '../helpers/roomViewSwitch';
import { openThreadsCategory } from '../helpers/threadsCategory';

// Regression (L1-F015, L5-F010): a new device without key backup cannot decrypt a thread an earlier
// device of the account started. Its Compact card and the sidebar's THREADS row showed the SDK's
// fallback body, "** Unable to decrypt: DecryptionError: This message was sent before this device
// logged in, and there is no key backup on the server. **", as the thread's title. Both read
// "Encrypted message" instead. Set E2EE_ROOT_SHOTS=<directory> to save the new session's room.
test.describe.configure({ timeout: 420_000 });

const SHOTS = process.env.E2EE_ROOT_SHOTS;
const RAW_ERROR = /Unable to decrypt|DecryptionError/;

test('a new device titles a thread it cannot decrypt "Encrypted message"', async ({
  page,
  stack,
  browser,
  baseURL,
}) => {
  const roomId = await createEncryptedAgentRoom(stack, 'Secure planning');
  await page.goto(`/home/${encodeURIComponent(roomId)}`, { timeout: 180_000 });
  await expect(composer(page)).toBeVisible({ timeout: 90_000 });
  await mentionHelper(page, stack, 'draft the launch checklist');
  await expect(page.getByText('You said:').first()).toBeVisible({ timeout: 90_000 });

  // A device signed in afterwards, with no key backup on the server.
  const fresh = await openNewSession(browser, stack, {
    baseURL,
    viewport: { width: 1440, height: 900 },
  });
  try {
    await fresh.goto(`/home/${encodeURIComponent(roomId)}`, { timeout: 180_000 });
    await setRoomCompact(fresh, true);
    const overview = fresh.locator('[data-room-thread-overview="true"]');
    await expect(overview).toContainText('Encrypted message', { timeout: 90_000 });
    await openThreadsCategory(fresh);
    const threadsList = fresh.getByTestId('thread-nav-list');
    await expect(threadsList).toContainText('Encrypted message', { timeout: 60_000 });
    if (SHOTS) await fresh.screenshot({ path: `${SHOTS}/new-device-compact.png` });
    await expect(overview).not.toContainText(RAW_ERROR);
    await expect(threadsList).not.toContainText(RAW_ERROR);
    await expect(fresh.locator('body')).not.toContainText(RAW_ERROR);
  } finally {
    await fresh.context().close();
  }
});
