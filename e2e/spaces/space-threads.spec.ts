import fs from 'node:fs/promises';
import path from 'node:path';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
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
  sendRoomMessage,
} from '../helpers/matrix';

const PASSWORD = 'space-threads-e2e-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS_DIR =
  process.env.CAPTURE_SHOTS === '1'
    ? process.env.SPACE_THREADS_SHOTS ?? path.resolve(process.cwd(), 'tmp/space-threads-shots')
    : undefined;

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

type SeededWorkspace = {
  user: DisposableUser;
  spaceId: string;
  rooms: Record<'backend-api' | 'web-client' | 'infra-ops', string>;
};

const addSecondThread = async (
  accessToken: string,
  roomId: string,
  rootBody: string,
  replyBody: string
) => {
  const rootId = await sendRoomMessage(
    HOMESERVER,
    accessToken,
    roomId,
    { msgtype: 'm.text', body: rootBody },
    'space-threads'
  );
  await sendRoomMessage(
    HOMESERVER,
    accessToken,
    roomId,
    {
      msgtype: 'm.text',
      body: replyBody,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    },
    'space-threads'
  );
};

const seedWorkspace = async (): Promise<SeededWorkspace> => {
  const user = await registerDisposableUser(`spthreads_${RUN}`, PASSWORD);
  const spaceId = await createPrivateSpace(HOMESERVER, user.accessToken, {
    name: 'Dev Workspace',
    topic: 'Shared engineering rooms and active threads',
  });

  const backend = await createThreadFixture(HOMESERVER, user.accessToken, {
    name: 'backend-api',
    topic: 'API services and storage',
    rootBody: 'Migrate session cache to Redis cluster',
    replyBody: 'Benchmark shows 35% lower p99 latency on staging.',
    txnPrefix: 'space-threads',
  });
  await addSecondThread(
    user.accessToken,
    backend.roomId,
    'Rate limit middleware retry headers',
    'Added Retry-After header and unit tests.'
  );
  await addRoomToSpace(HOMESERVER, user.accessToken, spaceId, backend.roomId);

  const web = await createThreadFixture(HOMESERVER, user.accessToken, {
    name: 'web-client',
    topic: 'Frontend UI and accessibility',
    rootBody: 'Keyboard navigation for command menu',
    replyBody: 'Arrow keys and Escape focus return are wired up.',
    txnPrefix: 'space-threads',
  });
  await addSecondThread(
    user.accessToken,
    web.roomId,
    'Compact card spacing audit',
    'Aligned chip heights across dark and light themes.'
  );
  await addRoomToSpace(HOMESERVER, user.accessToken, spaceId, web.roomId);

  const infra = await createThreadFixture(HOMESERVER, user.accessToken, {
    name: 'infra-ops',
    topic: 'Deployments and reliability',
    rootBody: 'Blue-green deploy rollback checklist',
    replyBody: 'Verified automated health check gate on staging.',
    txnPrefix: 'space-threads',
  });
  await addRoomToSpace(HOMESERVER, user.accessToken, spaceId, infra.roomId);

  return {
    user,
    spaceId,
    rooms: {
      'backend-api': backend.roomId,
      'web-client': web.roomId,
      'infra-ops': infra.roomId,
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

  test('merges space threads, filters with Only/All, and starts a new thread in a chosen room', async ({
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

      // All 3 rooms' threads appear with room badges.
      await expect(page.getByText('Migrate session cache to Redis cluster')).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText('Keyboard navigation for command menu')).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText('Blue-green deploy rollback checklist')).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.locator('[data-space-rooms-badge="true"]')).toHaveText('3 rooms');
      await expect(page.locator('[data-space-thread-room-badge]')).toHaveCount(5);
      await saveShot(page, 'after-space-threads-dark.png');

      // Clicking Only downselects to web-client, hides room badges, and retargets the composer.
      const webRoomId = workspace.rooms['web-client'];
      await page.locator(`[data-space-room-only="${webRoomId}"]`).click();
      await expect(page.locator('[data-space-rooms-badge="true"]')).toHaveText('1 of 3 rooms');
      await expect(page.getByText('Keyboard navigation for command menu')).toBeVisible();
      await expect(page.getByText('Migrate session cache to Redis cluster')).toBeHidden();
      await expect(page.getByText('Blue-green deploy rollback checklist')).toBeHidden();
      await expect(page.locator('[data-space-thread-room-badge]')).toHaveCount(0);
      await expect(page.locator('[data-space-composer="true"]')).toHaveAttribute(
        'data-space-composer-active-target',
        webRoomId
      );
      await saveShot(page, 'after-space-threads-only.png');

      // Clicking All restores all 3 rooms and room badges.
      await page.locator('[data-space-room-filter-all="true"]').click();
      await expect(page.locator('[data-space-rooms-badge="true"]')).toHaveText('3 rooms');
      await expect(page.getByText('Migrate session cache to Redis cluster')).toBeVisible();
      await expect(page.getByText('Blue-green deploy rollback checklist')).toBeVisible();
      await expect(page.locator('[data-space-thread-room-badge]')).toHaveCount(5);

      // Pick infra-ops in the bottom composer and send a new message/thread.
      const infraRoomId = workspace.rooms['infra-ops'];
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
});
