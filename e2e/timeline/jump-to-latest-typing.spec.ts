import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import {
  allowActiveRunsState,
  joinRoom,
  matrixFetch,
  publishActiveRuns,
  registerAgentAccount,
  sendRoomMessage,
  setAccountData,
} from '../helpers/matrix';

// When an agent starts typing in a thread, the typing strip appears in the dock above the composer.
// Jump to Latest reserves a one-row dock floor above the composer so appearing or clearing a
// single-row typing strip never shifts Jump to Latest vertically while keeping S400 clearance
// above the strip. Runs against the disposable homeserver of `just hs-up` or `scripts/e2e-slot.sh`.
// Set JUMP_TO_LATEST_TYPING_SHOTS=<directory> to save before/during screenshots.
const PASSWORD = 'jump-to-latest-typing-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.JUMP_TO_LATEST_TYPING_SHOTS;
const TURN_COUNT = 15;

type ViewportCase = {
  label: 'desktop' | 'phone';
  useOptions: Parameters<typeof test.use>[0];
};

const CASES: readonly ViewportCase[] = [
  {
    label: 'desktop',
    useOptions: { viewport: { width: 1280, height: 800 } },
  },
  {
    label: 'phone',
    useOptions: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  },
];

type VerticalBounds = { top: number; bottom: number };

const verticalBounds = async (locator: Locator, name: string): Promise<VerticalBounds> => {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${name} has no bounding box`);
  return { top: box.y, bottom: box.y + box.height };
};

const readThreadInsets = (page: Page) =>
  page.evaluate(() => {
    const footer = document.querySelector<HTMLElement>('[data-footer-of="thread"]');
    if (!footer) return null;
    const style = getComputedStyle(footer);
    const composer = Number.parseFloat(style.getPropertyValue('--room-composer-height'));
    const footerHeight = Number.parseFloat(style.getPropertyValue('--room-footer-height'));
    if (!Number.isFinite(composer) || !Number.isFinite(footerHeight)) return null;
    return { composer, footerHeight, dock: footerHeight - composer };
  });

const saveShot = async (page: Page, name: string): Promise<void> => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
};

const verifyJumpToLatestStableWithTyping = async (page: Page, label: string): Promise<void> => {
  const viewer = await registerDisposableUser(`jtl_viewer_${label}_${RUN}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, `helper_${label}`);
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(viewer.userId)}/displayname`, {
    method: 'PUT',
    accessToken: viewer.accessToken,
    body: JSON.stringify({ displayname: 'Avery' }),
  });
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(agent.userId)}/displayname`, {
    method: 'PUT',
    accessToken: agent.accessToken,
    body: JSON.stringify({ displayname: 'Helper' }),
  });
  await setAccountData(HOMESERVER, viewer.accessToken, viewer.userId, 'io.mindroom.settings', {
    tourOffered: true,
  });

  const roomId = await createRoom(HOMESERVER, viewer.accessToken, {
    name: `Placeholder room ${label}`,
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  await allowActiveRunsState(HOMESERVER, viewer.accessToken, roomId);

  const rootId = await sendRoomMessage(HOMESERVER, viewer.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Placeholder thread message 1: starting the check.',
  });
  let previousEventId = rootId;
  let latestReplyBody = '';
  for (let turn = 1; turn <= TURN_COUNT; turn += 1) {
    if (turn > 1) {
      previousEventId = await sendRoomMessage(HOMESERVER, viewer.accessToken, roomId, {
        msgtype: 'm.text',
        body: `Placeholder thread message ${turn}: checking item ${turn}.`,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: previousEventId },
        },
      });
    }
    latestReplyBody = `Placeholder thread reply ${turn}: item ${turn} is ready.`;
    previousEventId = await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: latestReplyBody,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: previousEventId },
      },
    });
  }

  const setTyping = (typing: boolean) =>
    matrixFetch(
      HOMESERVER,
      `/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(agent.userId)}`,
      {
        method: 'PUT',
        accessToken: agent.accessToken,
        body: JSON.stringify({ typing, timeout: 120_000 }),
      }
    );

  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: viewer.username,
    password: PASSWORD,
    showToolCalls: false,
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);

  const threadArea = page.locator('[data-footer-of="thread"]').locator('xpath=../..');
  const scroller = threadArea.locator('[data-thread-count]').locator('xpath=../..');
  const jumpToLatest = threadArea.getByRole('button', { name: 'Jump to Latest', exact: true });
  const typingStrip = threadArea.getByRole('status').filter({ hasText: 'Helper is typing...' });

  await expect(threadArea.getByText(latestReplyBody).first()).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight), {
      timeout: 30_000,
    })
    .toBeGreaterThan(400);

  const scrollBox = await scroller.boundingBox();
  if (!scrollBox) throw new Error('Thread scroll container has no bounding box');
  await page.mouse.move(scrollBox.x + scrollBox.width / 2, scrollBox.y + scrollBox.height / 2);
  await expect
    .poll(
      async () => {
        await page.mouse.wheel(0, -10_000);
        await scroller.evaluate((element) => {
          element.scrollTop = 0;
        });
        return jumpToLatest.isVisible();
      },
      { timeout: 15_000 }
    )
    .toBe(true);

  await expect(typingStrip).toHaveCount(0);
  await expect
    .poll(async () => {
      const insets = await readThreadInsets(page);
      return insets !== null && insets.composer > 0 && insets.dock === 0;
    })
    .toBe(true);
  await page.mouse.move(0, 0);

  const emptyBox = await verticalBounds(jumpToLatest, 'Jump to Latest (empty dock)');
  await saveShot(page, `empty-dock-${label}`);

  await publishActiveRuns(HOMESERVER, agent, roomId, [rootId]);
  await setTyping(true);
  await expect(typingStrip).toBeVisible({ timeout: 30_000 });
  await typingStrip.evaluate((element) =>
    Promise.all(
      element
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished)
    )
  );
  await expect
    .poll(async () => (await readThreadInsets(page))?.dock ?? 0)
    .toBeGreaterThanOrEqual(35);
  await saveShot(page, `typing-visible-${label}`);

  const typingJumpBox = await verticalBounds(jumpToLatest, 'Jump to Latest (typing visible)');
  const stripBox = await verticalBounds(typingStrip, 'Typing strip');
  expect(Math.abs(typingJumpBox.top - emptyBox.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(typingJumpBox.bottom - emptyBox.bottom)).toBeLessThanOrEqual(1);
  expect(stripBox.top - typingJumpBox.bottom).toBeGreaterThanOrEqual(15);

  await setTyping(false);
  await publishActiveRuns(HOMESERVER, agent, roomId, []);
  await expect(typingStrip).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(async () => (await readThreadInsets(page))?.dock).toBe(0);

  const clearedBox = await verticalBounds(jumpToLatest, 'Jump to Latest (typing cleared)');
  expect(Math.abs(clearedBox.top - emptyBox.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(clearedBox.bottom - emptyBox.bottom)).toBeLessThanOrEqual(1);

  await jumpToLatest.click();
  await expect(jumpToLatest).toBeHidden({ timeout: 15_000 });
  await expect
    .poll(
      () =>
        scroller.evaluate(
          (element) => element.scrollHeight - element.scrollTop - element.clientHeight
        ),
      { timeout: 15_000 }
    )
    .toBeLessThanOrEqual(2);
  await expect(threadArea.getByText(latestReplyBody).first()).toBeVisible({ timeout: 15_000 });
};

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

for (const { label, useOptions } of CASES) {
  test.describe(label, () => {
    test.use(useOptions);

    test(`Jump to Latest stays still when typing appears in a thread (${label})`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await verifyJumpToLatestStableWithTyping(page, label);
    });
  });
}
