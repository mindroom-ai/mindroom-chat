import { mkdirSync } from 'node:fs';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  joinRoom,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
  sendStateEvent,
} from '../helpers/matrix';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// Consecutive room membership events fold behind a centered divider pill, keeping room state
// changes such as topic updates visible outside the fold. Set MEMBERSHIP_FOLD_SHOTS=<dir> to
// save desktop and phone screenshots in collapsed and expanded states.

const PASSWORD = 'membership-fold-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.MEMBERSHIP_FOLD_SHOTS;

const FIRST_MESSAGE = 'Harbor log opened for the morning shift.';
const TOPIC_TEXT = 'Morning ferry schedule and pier assignments';
const LAST_MESSAGE = 'All piers reported clear for departure.';
const EXPECTED_COLLAPSED = '8 room events · 3 joined, 1 left, 3 invited, 1 banned';
const EXPECTED_EXPANDED = 'Hide 8 room events';

const DESKTOP: BrowserContextOptions = {
  viewport: { width: 1280, height: 800 },
  colorScheme: 'dark',
};

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  colorScheme: 'dark',
};

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const inviteUser = (accessToken: string, roomId: string, userId: string) =>
  matrixFetch<unknown>(HOMESERVER, `/rooms/${encodeURIComponent(roomId)}/invite`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify({ user_id: userId }),
  });

const seedMembershipRun = async (form: string) => {
  const host = await registerDisposableUser(`mfold_${form}_host_${RUN}`, PASSWORD);
  const ada = await registerDisposableUser(`mfold_${form}_ada_${RUN}`, PASSWORD);
  const ben = await registerDisposableUser(`mfold_${form}_ben_${RUN}`, PASSWORD);
  const cora = await registerDisposableUser(`mfold_${form}_cora_${RUN}`, PASSWORD);

  const roomId = await createRoom(HOMESERVER, host.accessToken, {
    name: `Harbor dispatch ${form} ${RUN}`,
  });

  const firstId = await sendRoomMessage(HOMESERVER, host.accessToken, roomId, {
    msgtype: 'm.text',
    body: FIRST_MESSAGE,
  });

  // 8 consecutive m.room.member events: 3 invites, 3 joins, 1 leave, 1 ban.
  for (const guest of [ada, ben, cora]) {
    await inviteUser(host.accessToken, roomId, guest.userId);
    await joinRoom(HOMESERVER, guest.accessToken, roomId);
  }
  await matrixFetch<unknown>(HOMESERVER, `/rooms/${encodeURIComponent(roomId)}/leave`, {
    method: 'POST',
    accessToken: ben.accessToken,
    body: JSON.stringify({}),
  });
  await matrixFetch<unknown>(HOMESERVER, `/rooms/${encodeURIComponent(roomId)}/ban`, {
    method: 'POST',
    accessToken: host.accessToken,
    body: JSON.stringify({ user_id: cora.userId, reason: 'Moved to archive crew' }),
  });

  // A room topic change breaks the membership run and stays visible outside the fold.
  await sendStateEvent(HOMESERVER, host.accessToken, roomId, 'm.room.topic', '', {
    topic: TOPIC_TEXT,
  });

  const lastId = await sendRoomMessage(HOMESERVER, host.accessToken, roomId, {
    msgtype: 'm.text',
    body: LAST_MESSAGE,
  });

  return { host, roomId, firstId, lastId };
};

const verifyMembershipFolding = async (
  browser: Browser,
  options: BrowserContextOptions,
  baseURL: string | undefined,
  form: 'desktop' | 'phone'
) => {
  const { host, roomId, firstId, lastId } = await seedMembershipRun(form);
  const context = await browser.newContext({ ...options, baseURL, serviceWorkers: 'block' });
  const page = await context.newPage();
  try {
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: host.username,
      password: PASSWORD,
    });
    await seedRoomOverviewState({ page, roomId, userId: host.userId, viewMode: 'classic' });
    await page.goto(`/home/${encodeURIComponent(roomId)}`);

    await expect(page.locator(`[data-message-id="${lastId}"]`)).toContainText(LAST_MESSAGE, {
      timeout: 60_000,
    });
    await expect(page.locator(`[data-message-id="${firstId}"]`)).toContainText(FIRST_MESSAGE);

    // Topic state event remains visible outside the membership fold.
    const topicRow = page.locator('[data-message-id]', { hasText: 'changed the topic' });
    await expect(topicRow).toBeVisible();

    // The 8 consecutive membership events fold behind one centered divider pill.
    const breaks = page.locator('[data-membership-break]');
    await expect(breaks).toHaveCount(1);
    const pill = breaks.getByRole('button');
    await expect(pill).toHaveAttribute('aria-expanded', 'false');
    await expect(pill).toContainText(EXPECTED_COLLAPSED);

    // Individual folded membership rows are hidden while collapsed.
    const leftRow = page.locator('[data-message-id]', { hasText: 'left the room' });
    const bannedRow = page.locator('[data-message-id]', { hasText: 'banned' });
    await expect(leftRow).toHaveCount(0);
    await expect(bannedRow).toHaveCount(0);

    // The pill fits inside the viewport width and wraps without clipping text on narrow screens.
    const viewportWidth = options.viewport?.width ?? 1280;
    const pillBox = await pill.boundingBox();
    expect(pillBox).not.toBeNull();
    if (pillBox) {
      expect(pillBox.x).toBeGreaterThanOrEqual(0);
      expect(pillBox.x + pillBox.width).toBeLessThanOrEqual(viewportWidth);
    }
    expect(await pill.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

    await pill.scrollIntoViewIfNeeded();
    await shot(page, `${form}-collapsed`);

    // Clicking the pill expands all verbatim membership rows below it while keeping focus.
    await pill.click();
    await expect(pill).toHaveAttribute('aria-expanded', 'true');
    await expect(pill).toContainText(EXPECTED_EXPANDED);
    await expect(pill).toBeFocused();
    await expect(leftRow).toBeVisible();
    await expect(bannedRow).toBeVisible();

    const breakBox = await breaks.boundingBox();
    const bannedBox = await bannedRow.boundingBox();
    expect(breakBox && bannedBox && breakBox.y < bannedBox.y).toBe(true);

    await breaks.scrollIntoViewIfNeeded();
    await shot(page, `${form}-expanded`);

    // Clicking again collapses the run back behind the pill.
    await pill.click();
    await expect(pill).toHaveAttribute('aria-expanded', 'false');
    await expect(pill).toContainText(EXPECTED_COLLAPSED);
    await expect(leftRow).toHaveCount(0);
    await expect(bannedRow).toHaveCount(0);
    await expect(topicRow).toBeVisible();
  } finally {
    await context.close();
  }
};

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS, video: 'off', trace: 'off' });

test.beforeAll(() => {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.setTimeout(180_000);
});

for (const [form, options] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test(`consecutive room membership events fold behind a divider pill (Chromium, ${form})`, async ({
    browser,
    baseURL,
  }) => {
    await verifyMembershipFolding(browser, options, baseURL, form);
  });
}
