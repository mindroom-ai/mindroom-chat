import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { joinRoom, sendRoomMessage, sendStateEvent } from '../helpers/matrix';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// On a tablet (1024 by 768) with the members panel docked, the thread banner's title column is
// narrow. Its tag row ran on under the banner's buttons: "+ tag" sat under Thread options and the
// "+N" count was cut (live-test finding P2-lane4-F016). The tags now stay inside the title column,
// wrapping onto another line when they do not fit, and "+ tag" stays reachable. Runs in Chromium
// and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against the
// disposable homeserver of `just hs-up` (or a slot of scripts/e2e-slot.sh). Set
// BANNER_TAGS_SHOTS=<directory> for screenshots.
const PASSWORD = 'thread-banner-tablet-tags-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.BANNER_TAGS_SHOTS;
const TABLET = { width: 1024, height: 768 };
const TAGS = ['billing', 'blocked', 'bug', 'customer', 'docs', 'release', 'security', 'urgent'];

test.use({ viewport: TABLET, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  if (!found) throw new Error('no box');
  return found;
};

const tagsStayBesideTheButtons = async (page: Page, label: string) => {
  const reader = await registerDisposableUser(`btt_reader_${label}_${RUN}`, PASSWORD);
  const agent = await registerDisposableUser(`mindroom_planner_${label}_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: `Ops board ${label}`,
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'API rate limit change for the partner integrations',
  });
  await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'I drafted the new limits and a rollout plan for the partner keys.',
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });
  for (const tag of TAGS) {
    // eslint-disable-next-line no-await-in-loop
    await sendStateEvent(
      HOMESERVER,
      reader.accessToken,
      roomId,
      'com.mindroom.thread.tags',
      JSON.stringify([rootId, tag]),
      { set_by: reader.userId, set_at: new Date().toISOString() }
    );
  }

  await loginWithPassword(page, { homeserver: HOMESERVER, ...reader });
  await page.goto(`/home/${encodeURIComponent(roomId)}/${encodeURIComponent(rootId)}`);
  const banner = page.locator('[data-thread-context-banner="true"]');
  await expect(banner).toBeVisible({ timeout: 30_000 });
  const showMembers = page.getByRole('button', { name: 'Show Members', exact: true });
  if (await showMembers.isVisible()) await showMembers.click();
  await expect(page.getByRole('button', { name: 'Hide Members', exact: true })).toBeVisible();

  const addTag = banner.getByRole('button', { name: 'Add tag', exact: true }).first();
  const options = banner.getByRole('button', { name: 'Thread options', exact: true });
  const overflow = banner.getByText(`+${TAGS.length - 3}`, { exact: true }).first();
  await expect(addTag).toBeVisible({ timeout: 30_000 });
  if (SHOTS) await banner.screenshot({ path: `${SHOTS}/banner-tags-${label}.png` });
  const addBox = await box(addTag);
  const optionsBox = await box(options);
  expect(addBox.x + addBox.width, '"+ tag" ends before Thread options').toBeLessThanOrEqual(
    optionsBox.x
  );
  // "+ tag" takes taps: nothing covers its middle.
  const atMiddle = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'),
    { x: addBox.x + addBox.width / 2, y: addBox.y + addBox.height / 2 }
  );
  expect(atMiddle).toBe('Add tag');
  // The count of the other tags shows whole.
  const overflowBox = await box(overflow);
  const visibleWidth = await overflow.evaluate((chip) => {
    const row = chip.parentElement!.getBoundingClientRect();
    const own = chip.getBoundingClientRect();
    return Math.min(own.right, row.right) - Math.max(own.left, row.left);
  });
  expect(visibleWidth, 'the +N count shows whole').toBeGreaterThanOrEqual(overflowBox.width - 1);
};

test('a tablet’s thread banner keeps its tags beside the buttons (Chromium)', async ({ page }) => {
  test.setTimeout(180_000);
  await tagsStayBesideTheButtons(page, 'chromium');
});

test('a tablet’s thread banner keeps its tags beside the buttons (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  await onWebKitPage({ viewport: TABLET, baseURL }, (page) =>
    tagsStayBesideTheButtons(page, 'webkit')
  );
});
