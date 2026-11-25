import fs from 'node:fs/promises';
import path from 'node:path';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import {
  addRoomToSpace,
  createPrivateSpace,
  createThreadFixture,
  joinRoom,
  matrixFetch,
  sendStateEvent,
  sendThreadInRoom,
} from '../helpers/matrix';

const PASSWORD = 'space-threads-e2e-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS_DIR =
  process.env.CAPTURE_SHOTS === '1'
    ? (process.env.SPACE_THREADS_SHOTS ?? path.resolve(process.cwd(), 'tmp/space-threads-shots'))
    : undefined;

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

// A 48 px solid square PNG for synthetic room and user avatars.
const AVATAR_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAAQklEQVR4nO3OQQ0AIAwAsQlDBLKRhQuOR5MK6Jy9vjL5QEhISKgeCAkJCdUDISEhoXogJCQkVA+EhISE6oGQkNBjF21V9KbVaAsfAAAAAElFTkSuQmCC',
  'base64'
);

const uploadAvatar = async (accessToken: string): Promise<string> => {
  const response = await fetch(`${HOMESERVER}/_matrix/media/v3/upload?filename=avatar.png`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'image/png' },
    body: AVATAR_PNG,
  });
  if (!response.ok) throw new Error(`Avatar upload failed (${response.status})`);
  return ((await response.json()) as { content_uri: string }).content_uri;
};

const setUserProfile = async (
  user: DisposableUser,
  displayName: string,
  avatarUrl: string
): Promise<void> => {
  const base = `/profile/${encodeURIComponent(user.userId)}`;
  await matrixFetch(HOMESERVER, `${base}/displayname`, {
    method: 'PUT',
    accessToken: user.accessToken,
    body: JSON.stringify({ displayname: displayName }),
  });
  await matrixFetch(HOMESERVER, `${base}/avatar_url`, {
    method: 'PUT',
    accessToken: user.accessToken,
    body: JSON.stringify({ avatar_url: avatarUrl }),
  });
};

const expectAvatarImageLoaded = async (image: Locator) => {
  await expect(image).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      () =>
        image.evaluate((node) => {
          const el = node as HTMLImageElement;
          return el.complete && el.naturalWidth > 0;
        }),
      { timeout: 20_000 }
    )
    .toBe(true);
};

type SeededWorkspace = {
  user: DisposableUser;
  peer: DisposableUser;
  spaceId: string;
  platformSpaceId: string;
  designSpaceId: string;
  rooms: Record<'backend-api' | 'web-client' | 'infra-ops' | 'ci-runners', string>;
};

const seedWorkspace = async (): Promise<SeededWorkspace> => {
  const user = await registerDisposableUser(`spthreads_${RUN}`, PASSWORD);
  const peer = await registerDisposableUser(`spthreads_peer_${RUN}`, PASSWORD);
  const [userAvatarUrl, peerAvatarUrl, roomAvatarUrl] = await Promise.all([
    uploadAvatar(user.accessToken),
    uploadAvatar(peer.accessToken),
    uploadAvatar(user.accessToken),
  ]);
  await Promise.all([
    setUserProfile(user, 'Lead Engineer', userAvatarUrl),
    setUserProfile(peer, 'Peer Engineer', peerAvatarUrl),
  ]);

  const spaceId = await createPrivateSpace(HOMESERVER, user.accessToken, {
    name: 'Dev Workspace',
    topic: 'Shared engineering rooms and active threads',
  });
  const platformSpaceId = await createPrivateSpace(HOMESERVER, user.accessToken, {
    name: 'Platform',
    topic: 'Infrastructure and build pipelines',
  });
  await addRoomToSpace(HOMESERVER, user.accessToken, spaceId, platformSpaceId);

  const designSpaceId = await createPrivateSpace(HOMESERVER, user.accessToken, {
    name: 'Design Studio',
    topic: 'Design systems and visual specs',
  });
  const brand = await createThreadFixture(HOMESERVER, user.accessToken, {
    name: 'brand-kit',
    topic: 'Tokens and typography',
    rootBody: 'Typography scale adjustments',
    replyBody: 'Updated heading weights for compact views.',
    txnPrefix: 'space-threads',
  });
  await addRoomToSpace(HOMESERVER, user.accessToken, designSpaceId, brand.roomId);

  const backend = await createThreadFixture(HOMESERVER, user.accessToken, {
    name: 'backend-api',
    topic: 'API services and storage',
    rootBody: 'Migrate session cache to Redis cluster',
    replyBody: 'Benchmark shows 35% lower p99 latency on staging.',
    txnPrefix: 'space-threads',
  });
  await sendStateEvent(HOMESERVER, user.accessToken, backend.roomId, 'm.room.avatar', '', {
    url: roomAvatarUrl,
  });
  await sendThreadInRoom(HOMESERVER, user.accessToken, backend.roomId, {
    rootBody: 'Rate limit middleware retry headers',
    replyBody: 'Added Retry-After header and unit tests.',
    txnPrefix: 'space-threads',
  });
  await addRoomToSpace(HOMESERVER, user.accessToken, spaceId, backend.roomId);

  const web = await createThreadFixture(HOMESERVER, user.accessToken, {
    name: 'web-client',
    topic: 'Frontend UI and accessibility',
    rootBody: 'Keyboard navigation for command menu',
    replyBody: 'Arrow keys and Escape focus return are wired up.',
    invite: [peer.userId],
    txnPrefix: 'space-threads',
  });
  await joinRoom(HOMESERVER, peer.accessToken, web.roomId);
  await sendThreadInRoom(HOMESERVER, peer.accessToken, web.roomId, {
    rootBody: 'Compact card spacing audit',
    replyBody: 'Aligned chip heights across dark and light themes.',
    txnPrefix: 'space-threads',
  });
  await addRoomToSpace(HOMESERVER, user.accessToken, spaceId, web.roomId);

  const infra = await createThreadFixture(HOMESERVER, user.accessToken, {
    name: 'infra-ops',
    topic: 'Deployments and reliability',
    rootBody: 'Blue-green deploy rollback checklist',
    replyBody: 'Verified automated health check gate on staging.',
    txnPrefix: 'space-threads',
  });
  await addRoomToSpace(HOMESERVER, user.accessToken, platformSpaceId, infra.roomId);

  const ci = await createThreadFixture(HOMESERVER, user.accessToken, {
    name: 'ci-runners',
    topic: 'Build cache and CI jobs',
    rootBody: 'Cache build artifacts across runners',
    replyBody: 'Cut median CI job runtime by 40%.',
    txnPrefix: 'space-threads',
  });
  await addRoomToSpace(HOMESERVER, user.accessToken, platformSpaceId, ci.roomId);

  return {
    user,
    peer,
    spaceId,
    platformSpaceId,
    designSpaceId,
    rooms: {
      'backend-api': backend.roomId,
      'web-client': web.roomId,
      'infra-ops': infra.roomId,
      'ci-runners': ci.roomId,
    },
  };
};

const configureTheme = async (page: Page, themeId: 'dark-theme' | 'light-theme') => {
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await page.addInitScript((selectedTheme) => {
    const settings = JSON.parse(localStorage.getItem('settings') ?? '{}');
    localStorage.setItem(
      'settings',
      JSON.stringify({ ...settings, useSystemTheme: false, themeId: selectedTheme })
    );
  }, themeId);
};

const saveShot = async (page: Page, filename: string) => {
  if (!SHOTS_DIR) return;
  await expect(page.getByText('Catching up...'))
    .toBeHidden({ timeout: 10_000 })
    .catch(() => {});
  await fs.mkdir(SHOTS_DIR, { recursive: true });
  await page.evaluate(() => document.fonts?.ready);
  await page.screenshot({ path: path.join(SHOTS_DIR, filename) });
};

const openInContext = async (
  browser: Browser,
  options: BrowserContextOptions,
  themeId: 'dark-theme' | 'light-theme',
  user: DisposableUser
) => {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await configureTheme(page, themeId);
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: user.username,
    password: user.password,
  });
  return { context, page };
};

test.describe.serial('Space Threads overview', () => {
  let workspace: SeededWorkspace;

  test.beforeAll(async () => {
    test.skip(!(await disposableHomeserverIsUp()), 'Disposable Matrix homeserver is not running');
    workspace = await seedWorkspace();
  });

  test('merges space threads, filters via Rooms dropdown, and starts a new thread in a chosen room', async ({
    browser,
  }) => {
    const { context, page } = await openInContext(browser, DESKTOP, 'dark-theme', workspace.user);
    try {
      await page.goto(`/${encodeURIComponent(workspace.spaceId)}/lobby`);
      await expect(page.getByText('backend-api').first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('web-client').first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('infra-ops').first()).toBeVisible({ timeout: 20_000 });
      await saveShot(page, 'before-space-lobby.png');

      // Open Space Threads from the Space sidebar.
      await page.getByRole('link', { name: 'All threads' }).click();
      await expect(page.locator('[data-space-threads-page]')).toBeVisible({ timeout: 20_000 });

      // All 4 rooms' threads (including Platform subspace) appear with room badges and Rooms dropdown.
      await expect(page.getByText('Migrate session cache to Redis cluster')).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText('Keyboard navigation for command menu')).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText('Blue-green deploy rollback checklist')).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText('Cache build artifacts across runners')).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.locator('[data-space-rooms-badge="true"]')).toHaveText('4 rooms');
      await expect(page.locator('[data-space-thread-room-badge]')).toHaveCount(6);
      const roomsTrigger = page.locator('[data-room-filter-button]');
      await expect(roomsTrigger).toHaveText('Rooms');
      await saveShot(page, 'after-space-threads-dark.png');

      // Open Rooms dropdown to verify room avatar image, icon fallbacks, and Platform subspace group.
      const backendRoomId = workspace.rooms['backend-api'];
      const webRoomId = workspace.rooms['web-client'];
      const infraRoomId = workspace.rooms['infra-ops'];
      const ciRoomId = workspace.rooms['ci-runners'];
      const platformOption = page.locator(`[data-subspace-option="${workspace.platformSpaceId}"]`);
      const platformCheckbox = platformOption.locator('input[type="checkbox"]');
      await roomsTrigger.click();
      await expect(page.locator('[data-room-filter-panel]')).toBeVisible();
      await expect(page.locator('[data-room-option]')).toHaveCount(4);
      await expect(platformOption).toBeVisible();
      await expectAvatarImageLoaded(page.locator(`[data-room-option="${backendRoomId}"] img`));
      await expect(page.locator(`[data-room-option="${webRoomId}"] img`)).toHaveCount(0);
      await expect(
        page.locator(
          `[data-room-option="${webRoomId}"] [data-avatar-fallback-id="${webRoomId}"] svg`
        )
      ).toBeVisible();
      await expect(page.locator(`[data-room-option="${infraRoomId}"] img`)).toHaveCount(0);
      await expect(
        page.locator(
          `[data-room-option="${infraRoomId}"] [data-avatar-fallback-id="${infraRoomId}"] svg`
        )
      ).toBeVisible();
      await saveShot(page, 'after-space-threads-dropdown.png');

      // Toggle Platform subspace group: checked -> partial (indeterminate) -> re-checked -> Clear.
      await platformOption.click();
      await expect(roomsTrigger).toHaveText('Platform');
      await expect(page.locator('[data-space-rooms-badge="true"]')).toHaveText('2 of 4 rooms');
      await expect(platformCheckbox).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByText('Blue-green deploy rollback checklist')).toBeVisible();
      await expect(page.getByText('Cache build artifacts across runners')).toBeVisible();
      await expect(page.getByText('Migrate session cache to Redis cluster')).toBeHidden();

      await page.locator(`[data-room-option="${ciRoomId}"]`).click();
      await expect(roomsTrigger).toHaveText('infra-ops');
      await expect(platformCheckbox).toHaveAttribute('aria-checked', 'mixed');
      await expect(page.getByText('Cache build artifacts across runners')).toBeHidden();

      await platformOption.click();
      await expect(roomsTrigger).toHaveText('Platform');
      await expect(platformCheckbox).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByText('Cache build artifacts across runners')).toBeVisible();

      await page.locator('[data-room-filter-clear]').click();
      await expect(roomsTrigger).toHaveText('Rooms');
      await expect(page.locator('[data-space-rooms-badge="true"]')).toHaveText('4 rooms');

      // Checking web-client downselects to 1 room, hides room badges, and retargets the composer.
      await page.locator(`[data-room-option="${webRoomId}"]`).click();
      await roomsTrigger.click();
      await expect(page.locator('[data-room-filter-panel]')).toBeHidden();
      await expect(roomsTrigger).toHaveText('web-client');
      await expect(page.locator('[data-space-rooms-badge="true"]')).toHaveText('1 of 4 rooms');
      await expect(page.getByText('Keyboard navigation for command menu')).toBeVisible();
      await expect(page.getByText('Compact card spacing audit')).toBeVisible();
      await expect(page.getByText('Migrate session cache to Redis cluster')).toBeHidden();
      await expect(page.getByText('Blue-green deploy rollback checklist')).toBeHidden();
      await expect(page.locator('[data-space-thread-room-badge]')).toHaveCount(0);
      await expect(page.locator('[data-space-composer="true"]')).toHaveAttribute(
        'data-space-composer-active-target',
        webRoomId
      );
      await saveShot(page, 'after-space-threads-only.png');

      // Navigating out of All threads and back preserves the selected room.
      await page.getByRole('link', { name: 'Space overview' }).click();
      await expect(page.locator('[data-space-threads-page]')).toBeHidden();
      await page.getByRole('link', { name: 'All threads' }).click();
      await expect(page.locator('[data-space-threads-page]')).toBeVisible({ timeout: 20_000 });
      await expect(roomsTrigger).toHaveText('web-client');
      await expect(page.locator('[data-space-rooms-badge="true"]')).toHaveText('1 of 4 rooms');
      await expect(page.getByText('Keyboard navigation for command menu')).toBeVisible();
      await expect(page.getByText('Migrate session cache to Redis cluster')).toBeHidden();

      // Opening the Rooms dropdown and clicking Clear restores all 4 rooms and room badges.
      await roomsTrigger.click();
      await page.locator('[data-room-filter-clear]').click();
      await roomsTrigger.click();
      await expect(roomsTrigger).toHaveText('Rooms');
      await expect(page.locator('[data-space-rooms-badge="true"]')).toHaveText('4 rooms');
      await expect(page.getByText('Migrate session cache to Redis cluster')).toBeVisible();
      await expect(page.getByText('Blue-green deploy rollback checklist')).toBeVisible();
      await expect(page.locator('[data-space-thread-room-badge]')).toHaveCount(6);

      // Header space switcher lists top-level spaces and indented subspaces and navigates cleanly.
      const switcherTrigger = page.locator('[data-space-switcher-button="true"]');
      await expect(switcherTrigger).toBeVisible();
      await switcherTrigger.click();
      await expect(page.locator('[data-space-switcher-menu="true"]')).toBeVisible();
      await expect(page.locator('[data-space-switcher-option]')).toHaveCount(3);
      await expect(
        page.locator(`[data-space-switcher-option="${workspace.spaceId}"]`)
      ).toHaveAttribute('aria-checked', 'true');
      await saveShot(page, 'after-space-threads-switcher.png');

      await page.locator(`[data-space-switcher-option="${workspace.platformSpaceId}"]`).click();
      await expect(page.locator('[data-space-threads-page]')).toHaveAttribute(
        'data-space-threads-page',
        workspace.platformSpaceId
      );
      await expect(page.locator('[data-space-rooms-badge="true"]')).toHaveText('2 rooms');
      await expect(page.getByText('Blue-green deploy rollback checklist')).toBeVisible();
      await expect(page.getByText('Migrate session cache to Redis cluster')).toBeHidden();

      await switcherTrigger.click();
      await page.locator(`[data-space-switcher-option="${workspace.designSpaceId}"]`).click();
      await expect(page.getByText('Typography scale adjustments')).toBeVisible({ timeout: 20_000 });

      await switcherTrigger.click();
      await page.locator(`[data-space-switcher-option="${workspace.spaceId}"]`).click();
      await expect(page.locator('[data-space-rooms-badge="true"]')).toHaveText('4 rooms');
      await expect(page.getByText('Migrate session cache to Redis cluster')).toBeVisible({
        timeout: 20_000,
      });

      // Advanced filters reveal the People dropdown with avatars, filtering, and Clear.
      const peopleTrigger = page.locator('[data-people-filter-button]');
      await expect(peopleTrigger).toBeHidden();
      await page.locator('[data-thread-filter-mode-switch="true"]').click();
      await expect(peopleTrigger).toBeVisible();
      await peopleTrigger.click();
      await expect(page.locator('[data-people-filter-panel]')).toBeVisible();
      await expect(page.locator('[data-person-option]')).toHaveCount(2);
      const userOption = page.locator(`[data-person-option="${workspace.user.userId}"]`);
      const peerOption = page.locator(`[data-person-option="${workspace.peer.userId}"]`);
      await expect(userOption).toContainText('Lead Engineer');
      await expect(peerOption).toContainText('Peer Engineer');
      await expectAvatarImageLoaded(userOption.locator('img'));
      await expectAvatarImageLoaded(peerOption.locator('img'));
      await saveShot(page, 'after-space-threads-people-dropdown.png');

      await peerOption.click();
      await expect(page.getByText('Compact card spacing audit')).toBeVisible();
      await expect(page.getByText('Migrate session cache to Redis cluster')).toBeHidden();
      await expect(page.getByText('Keyboard navigation for command menu')).toBeHidden();
      await expect(page.getByText('Blue-green deploy rollback checklist')).toBeHidden();

      await page.locator('[data-people-filter-clear]').click();
      await peopleTrigger.click();
      await expect(page.locator('[data-people-filter-panel]')).toBeHidden();
      await expect(page.getByText('Migrate session cache to Redis cluster')).toBeVisible();
      await expect(page.getByText('Compact card spacing audit')).toBeVisible();
      await expect(page.getByText('Blue-green deploy rollback checklist')).toBeVisible();

      // Pick infra-ops in the bottom composer and send a new message/thread.
      await page.locator(`[data-space-composer-target="${infraRoomId}"]`).click();
      await expect(page.locator('[data-space-composer="true"]')).toHaveAttribute(
        'data-space-composer-active-target',
        infraRoomId
      );

      const composerInput = page.locator('[data-space-composer="true"] [contenteditable="true"]');
      await composerInput.click();
      await page.keyboard.type('Rotate staging TLS certificates');
      await page.keyboard.press('Enter');

      // Navigates into the infra-ops room thread with the sent message visible.
      await expect(page).toHaveURL(new RegExp(encodeURIComponent(infraRoomId)), {
        timeout: 20_000,
      });
      await expect(page.getByText('Rotate staging TLS certificates').first()).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await context.close();
    }
  });

  test('renders cleanly in light theme', async ({ browser }) => {
    const light = await openInContext(browser, DESKTOP, 'light-theme', workspace.user);
    try {
      await light.page.goto(`/${encodeURIComponent(workspace.spaceId)}/threads`);
      await expect(light.page.locator('[data-space-threads-page]')).toBeVisible({
        timeout: 20_000,
      });
      await expect(light.page.getByText('Migrate session cache to Redis cluster')).toBeVisible({
        timeout: 20_000,
      });
      await expect(light.page.locator('[data-space-thread-room-badge]')).not.toHaveCount(0);
      await saveShot(light.page, 'after-space-threads-light.png');
    } finally {
      await light.context.close();
    }
  });

  test('renders cleanly in phone layout', async ({ browser }) => {
    const phone = await openInContext(browser, PHONE, 'dark-theme', workspace.user);
    try {
      await phone.page.goto(`/${encodeURIComponent(workspace.spaceId)}/threads`);
      await expect(phone.page.locator('[data-space-threads-page]')).toBeVisible({
        timeout: 20_000,
      });
      await expect(phone.page.getByText('Migrate session cache to Redis cluster')).toBeVisible({
        timeout: 20_000,
      });
      await expect(phone.page.locator('[data-space-composer-picker="true"]')).toBeVisible();
      await saveShot(phone.page, 'after-space-threads-phone.png');
    } finally {
      await phone.context.close();
    }
  });

  test('returns to Space All threads with active room filter after opening a thread on desktop and phone', async ({
    browser,
  }) => {
    const ciRoomId = workspace.rooms['ci-runners'];
    const runCase = async (viewport: BrowserContextOptions, isPhone: boolean, shot: string) => {
      const { context, page } = await openInContext(
        browser,
        viewport,
        'dark-theme',
        workspace.user
      );
      try {
        await page.goto(`/${encodeURIComponent(workspace.spaceId)}/threads`);
        await expect(page.locator('[data-space-threads-page]')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText('Migrate session cache to Redis cluster')).toBeVisible({
          timeout: 20_000,
        });

        const roomsTrigger = page.locator('[data-room-filter-button]');
        await roomsTrigger.click();
        await expect(page.locator('[data-room-filter-panel]')).toBeVisible();
        await page.locator(`[data-subspace-option="${workspace.platformSpaceId}"]`).click();
        await roomsTrigger.click();
        await expect(page.locator('[data-room-filter-panel]')).toBeHidden();
        await expect(roomsTrigger).toHaveText('Platform');
        await expect(page.locator('[data-space-rooms-badge="true"]')).toHaveText('2 of 4 rooms');
        await expect(page.getByText('Blue-green deploy rollback checklist')).toBeVisible();
        await expect(page.getByText('Cache build artifacts across runners')).toBeVisible();
        await expect(page.getByText('Migrate session cache to Redis cluster')).toBeHidden();

        const threadCard = page.getByText('Cache build artifacts across runners');
        if (isPhone) await threadCard.tap();
        else await threadCard.click();

        await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(ciRoomId)}.*threadId=`), {
          timeout: 20_000,
        });
        const banner = page.locator('[data-thread-context-banner="true"]');
        await expect(banner).toBeVisible({ timeout: 20_000 });
        await expect(page.locator('[data-page-slide-copy]')).toHaveCount(0, { timeout: 10_000 });
        await expect(page.locator('html[data-page-slide]')).toHaveCount(0, { timeout: 10_000 });

        const backButton = banner.getByRole('button', { name: 'Back', exact: true });
        if (isPhone) await backButton.tap();
        else await backButton.click();

        await expect(page.locator('[data-space-threads-page]')).toHaveAttribute(
          'data-space-threads-page',
          workspace.spaceId,
          { timeout: 20_000 }
        );
        await expect(page).toHaveURL(/\/threads\/?$/, { timeout: 20_000 });
        await expect(page.locator('[data-page-slide-copy]')).toHaveCount(0, { timeout: 10_000 });
        await expect(page.locator('html[data-page-slide]')).toHaveCount(0, { timeout: 10_000 });
        await expect(roomsTrigger).toHaveText('Platform');
        await expect(page.locator('[data-space-rooms-badge="true"]')).toHaveText('2 of 4 rooms');
        await expect(page.getByText('Blue-green deploy rollback checklist')).toBeVisible();
        await expect(page.getByText('Cache build artifacts across runners')).toBeVisible();
        await expect(page.getByText('Migrate session cache to Redis cluster')).toBeHidden();
        await expect(page.getByText('Keyboard navigation for command menu')).toBeHidden();
        await saveShot(page, shot);
      } finally {
        await context.close();
      }
    };

    await runCase(DESKTOP, false, 'after-space-threads-return-desktop.png');
    await runCase(PHONE, true, 'after-space-threads-return-phone.png');
  });
});
