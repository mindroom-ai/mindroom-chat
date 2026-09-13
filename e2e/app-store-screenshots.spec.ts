import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getHomeserver, getPrimaryCredentials } from './env';
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
  process.env.E2E_FIXTURE_ROOM_ALIAS ?? '#mindroom-app-store-personal-showcase:matrix.localhost';
const FIXTURE_ROOM_NAME = 'Personal';
const MINDROOM_THREAD_TITLE =
  'MindRoom overview: chat-native personal agents, tools, memory, and scheduled follow-ups.';
const CAMPGROUND_THREAD_TITLE =
  'Campground monitor: daily watcher healthy, no matching openings yet, next scan scheduled.';
const CAR_THREAD_TITLE =
  'Car search: shortlist updated with two promising options and one negotiation checklist.';
const PNG_MAGIC_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

const sceneById = (id: AppStoreScreenshotScene['id']): AppStoreScreenshotScene => {
  const scene = APP_STORE_SCREENSHOT_SCENES.find((candidate) => candidate.id === id);
  if (!scene) throw new Error(`Unknown App Store screenshot scene: ${id}`);
  return scene;
};

const readPngSize = async (path: string) => {
  const bytes = await readFile(path);
  const signature = bytes.subarray(0, PNG_MAGIC_SIGNATURE.length);
  const hasPngSignature = PNG_MAGIC_SIGNATURE.every((byte, index) => signature[index] === byte);
  if (!hasPngSignature) {
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

const waitForNextPaint = async (page: Page) => {
  await page.evaluate(
    () =>
      new Promise<void>((resolvePaint) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolvePaint());
        });
      })
  );
};

const captureScene = async (
  page: Page,
  device: AppStoreScreenshotDevice,
  scene: AppStoreScreenshotScene
) => {
  const outputPath = resolve(process.cwd(), getAppStoreScreenshotRelativePath(device, scene));
  await mkdir(dirname(outputPath), { recursive: true });
  await installAppStoreScreenshotStyles(page);
  await page.mouse.move(1, 1);
  await page
    .getByRole('button', { name: /jump to latest/i })
    .evaluateAll((buttons) => {
      buttons.forEach((button) => {
        (button as HTMLElement).style.display = 'none';
      });
    })
    .catch(() => undefined);
  await page
    .getByRole('button', { name: /show less/i })
    .evaluateAll((buttons) => {
      buttons.forEach((button) => {
        (button as HTMLElement).style.display = 'none';
      });
    })
    .catch(() => undefined);
  await expect(page.getByText('Catching up...', { exact: true })).toBeHidden({ timeout: 10_000 });
  await waitForNextPaint(page);
  await page.screenshot({
    path: outputPath,
    fullPage: false,
    animations: 'disabled',
    scale: 'device',
  });

  await expect(readPngSize(outputPath)).resolves.toEqual(device.expectedPixels);
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getThreadEntry = (page: Page, title: string) =>
  page
    .getByRole('button', {
      name: new RegExp(`Open thread:[\\s\\S]*${escapeRegExp(title)}`, 'i'),
    })
    .first();

const expectFixtureRoomOverview = async (page: Page) => {
  await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
  await expect(page.getByText(FIXTURE_ROOM_NAME).first()).toBeVisible({ timeout: 30_000 });

  await expect(getThreadEntry(page, MINDROOM_THREAD_TITLE)).toBeVisible({ timeout: 30_000 });
  await expect(getThreadEntry(page, CAMPGROUND_THREAD_TITLE)).toBeVisible({ timeout: 30_000 });
  await expect(getThreadEntry(page, CAR_THREAD_TITLE)).toBeVisible({ timeout: 30_000 });
};

const openFixtureRoom = async (page: Page, roomId: string) => {
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  await expectFixtureRoomOverview(page);
};

const returnToFixtureRoomOverview = async (page: Page) => {
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await expectFixtureRoomOverview(page);
};

const expandFirstCollapsedMessage = async (page: Page) => {
  const showMoreButton = page.getByRole('button', { name: /show more/i }).first();
  if (await showMoreButton.isVisible().catch(() => false)) {
    await showMoreButton.click();
  }
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

      await loginWithPassword(page, { homeserver, username, password });
      await seedRoomOverviewState({
        page,
        roomId: fixtureRoomId,
        userId: matrixSession.userId,
        viewMode: 'compact',
        filterState: createDefaultThreadFilterState(),
      });

      await openFixtureRoom(page, fixtureRoomId);
      await expect(page.getByText('Today: campground watcher is healthy')).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        page.getByText('RouterAgent: I grouped the active personal-agent work')
      ).toBeVisible();
      await captureScene(page, device, sceneById('personal-workspace'));

      await getThreadEntry(page, MINDROOM_THREAD_TITLE).click();
      await expect(page.getByText('Thread View')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('MindRoom is a personal AI agent platform')).toBeVisible({
        timeout: 30_000,
      });
      await expandFirstCollapsedMessage(page);
      await expect(page.getByText('Everyday examples')).toBeVisible();
      await captureScene(page, device, sceneById('mindroom-explained'));

      await returnToFixtureRoomOverview(page);
      await getThreadEntry(page, CAMPGROUND_THREAD_TITLE).click();
      await expect(page.getByText('Thread View')).toBeVisible({ timeout: 30_000 });
      await expandFirstCollapsedMessage(page);
      const toolCallsButton = page.getByRole('button', { name: /3 tool calls/i }).first();
      await expect(toolCallsButton).toBeVisible({ timeout: 30_000 });
      await toolCallsButton.click();
      await expect(page.getByText('Tool #1: check campground availability')).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText('The monitor is healthy')).toBeVisible();
      await captureScene(page, device, sceneById('campground-monitor'));
    });
  });
}
