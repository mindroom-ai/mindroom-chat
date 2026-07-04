import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildLoginPath, getHomeserver, getPrimaryCredentials } from './env';
import { loginWithPassword } from './helpers/auth';
import {
  createDefaultThreadFilterState,
  joinRoom,
  loginToMatrix,
  seedRoomOverviewState,
} from './helpers/matrix';
import {
  APP_STORE_SCREENSHOT_DEVICES,
  APP_STORE_SCREENSHOT_SCENES,
  type AppStoreScreenshotDevice,
  type AppStoreScreenshotScene,
  getAppStoreScreenshotRelativePath,
} from '../src/app/mindroom/appstore/appStoreScreenshots';

const FIXTURE_ROOM_ALIAS =
  process.env.E2E_FIXTURE_ROOM_ALIAS ?? '#mindroom-app-store-screenshots:matrix.localhost';
const FIXTURE_ROOM_NAME = 'MindRoom Agent Lab';
const SUMMARY_TEXT =
  'iOS release plan: screenshots, TestFlight, and reviewer access are ready to review.';

const sceneById = (id: AppStoreScreenshotScene['id']): AppStoreScreenshotScene => {
  const scene = APP_STORE_SCREENSHOT_SCENES.find((candidate) => candidate.id === id);
  if (!scene) throw new Error(`Unknown App Store screenshot scene: ${id}`);
  return scene;
};

const readPngSize = async (path: string) => {
  const bytes = await readFile(path);
  if (bytes.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`${path} is not a PNG file.`);
  }

  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
};

const installAppStoreScreenshotStyles = async (page: Page) => {
  await page.addStyleTag({
    content: `
      [data-testid="client-sync-status"] {
        display: none !important;
      }
    `,
  });
};

const captureScene = async (
  page: Page,
  device: AppStoreScreenshotDevice,
  scene: AppStoreScreenshotScene
) => {
  const outputPath = resolve(process.cwd(), getAppStoreScreenshotRelativePath(device, scene));
  await mkdir(dirname(outputPath), { recursive: true });
  await installAppStoreScreenshotStyles(page);
  await expect(page.getByText('Catching up...', { exact: true })).toBeHidden({ timeout: 10_000 });
  await page.waitForTimeout(250);
  await page.screenshot({
    path: outputPath,
    fullPage: false,
    animations: 'disabled',
    scale: 'device',
  });

  await expect(readPngSize(outputPath)).resolves.toEqual(device.expectedPixels);
};

const openFixtureRoom = async (page: Page, roomId: string) => {
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
  await expect(page.getByText(FIXTURE_ROOM_NAME).first()).toBeVisible({ timeout: 30_000 });

  const threadEntry = page
    .getByRole('button', {
      name: new RegExp(`Open thread:[\\s\\S]*${SUMMARY_TEXT}`, 'i'),
    })
    .first();
  await expect(threadEntry).toBeVisible({ timeout: 30_000 });
  return threadEntry;
};

for (const device of APP_STORE_SCREENSHOT_DEVICES) {
  test.describe(`App Store screenshots - ${device.label}`, () => {
    test.use({
      viewport: device.viewport,
      deviceScaleFactor: device.deviceScaleFactor,
      isMobile: device.isMobile,
      hasTouch: device.hasTouch,
    });

    test('captures the release screenshot set', async ({ page }) => {
      test.setTimeout(180_000);

      const homeserver = getHomeserver();
      const { username, password } = getPrimaryCredentials();
      const matrixSession = await loginToMatrix(homeserver, username, password);
      const fixtureRoomId = await joinRoom(
        homeserver,
        matrixSession.accessToken,
        FIXTURE_ROOM_ALIAS
      );

      await page.goto(buildLoginPath(homeserver));
      await expect(page.locator('input[name="serverInput"]')).toBeVisible({ timeout: 30_000 });
      await captureScene(page, device, sceneById('welcome'));

      await loginWithPassword(page, { homeserver, username, password });
      await seedRoomOverviewState({
        page,
        roomId: fixtureRoomId,
        userId: matrixSession.userId,
        viewMode: 'compact',
        filterState: createDefaultThreadFilterState(),
      });

      const threadEntry = await openFixtureRoom(page, fixtureRoomId);
      await captureScene(page, device, sceneById('room-overview'));

      await threadEntry.click();
      await expect(page.getByText('Thread View')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Screenshots: capture iPhone 6.9')).toBeVisible({
        timeout: 30_000,
      });
      await captureScene(page, device, sceneById('thread-view'));
    });
  });
}
