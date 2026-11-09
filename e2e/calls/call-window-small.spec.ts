import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { createPrivateRoom } from '../helpers/matrix';
import { roomHeader } from '../helpers/roomMenu';
import { defined } from '../../src/test/utils/defined';

// The floating call window when it is small. A one-to-one voice call in a short window (the
// fixture of e2e/calls/call-window-transcript.spec.ts: the app's own window and call view around a
// stand-in call) keeps the other person's face whole in sight: the face shrinks to the room the
// stage has, without the transcript and above the transcript's subtitle. And a call view whose
// code could not load keeps the window's title bar, which moves the window, and its minimized line
// with Expand and Close (against the disposable homeserver, with the call view's code dropped).

test.use({ viewport: { width: 1280, height: 800 } });

type Box = { x: number; y: number; width: number; height: number };

const boxOf = async (locator: Locator): Promise<Box> =>
  defined(await locator.boundingBox(), 'a box on the page');

/** The fixture's window at `width` by `height` px, with its live transcript on or off. */
const openVoiceCall = async (page: Page, width: number, height: number, transcript: boolean) => {
  await page.goto(`/e2e/fixtures/call-window-transcript.html?width=${width}&height=${height}`);
  await page.locator('body[data-fixture-ready]').waitFor({ state: 'attached' });
  const callWindow = page.getByTestId('call-window');
  const subtitle = callWindow.locator('[data-call-window-subtitle]');
  if (transcript) {
    await expect(subtitle).toBeVisible();
  } else {
    await callWindow.getByRole('button', { name: 'Live transcript', exact: true }).click();
    await expect(subtitle).toHaveCount(0);
  }
  return callWindow;
};

/**
 * Where the face of the other person lies against what shows of the stage: the stage's content
 * box (above the subtitle's room), the call view's body that shows it, and whether either of the
 * body and the voice stage scrolls.
 */
const faceLayout = (callWindow: Locator) =>
  callWindow.locator('[data-call-stage="voice"]').evaluate((stage) => {
    const face = stage.querySelector('[data-call-tile="@avery:matrix.localhost"] > span');
    const body = stage.closest('[data-testid="call-panel"] > div');
    const voice = stage.firstElementChild;
    if (!face || !body || !voice) throw new Error('no face, body or voice stage');
    const style = getComputedStyle(stage);
    const stageBox = stage.getBoundingClientRect();
    const faceBox = face.getBoundingClientRect();
    const bodyBox = body.getBoundingClientRect();
    return {
      size: faceBox.height,
      overTop:
        Math.max(stageBox.top + parseFloat(style.paddingBlockStart), bodyBox.top) - faceBox.top,
      overBottom:
        faceBox.bottom -
        Math.min(stageBox.bottom - parseFloat(style.paddingBlockEnd), bodyBox.bottom),
      bodyScrolls: body.scrollHeight > body.clientHeight,
      voiceScrolls: voice.scrollHeight > voice.clientHeight,
    };
  });

const expectWholeFace = async (callWindow: Locator, size: { min: number; max: number }) => {
  const layout = await faceLayout(callWindow);
  expect(layout.overTop).toBeLessThanOrEqual(0.5);
  expect(layout.overBottom).toBeLessThanOrEqual(0.5);
  expect(layout.bodyScrolls).toBe(false);
  expect(layout.voiceScrolls).toBe(false);
  expect(layout.size).toBeGreaterThanOrEqual(size.min);
  expect(layout.size).toBeLessThanOrEqual(size.max);
};

test.describe("a voice call's face in a short window", () => {
  test('stays whole, smaller, without the transcript in a 340 by 260 px window', async ({
    page,
  }) => {
    const callWindow = await openVoiceCall(page, 340, 260, false);
    await expectWholeFace(callWindow, { min: 24, max: 63 });
  });

  test("stays whole above the transcript's subtitle in a 340 by 320 px window", async ({
    page,
  }) => {
    const callWindow = await openVoiceCall(page, 340, 320, true);
    await expectWholeFace(callWindow, { min: 24, max: 63 });
  });

  test('keeps its 64 px in a window tall enough for it', async ({ page }) => {
    const callWindow = await openVoiceCall(page, 340, 300, false);
    await expectWholeFace(callWindow, { min: 64, max: 64 });
  });

  // The subtitle leaves the stage no room above it here; the face keeps its smallest size.
  test("is never smaller than 24 px, even under the subtitle's room", async ({ page }) => {
    const callWindow = await openVoiceCall(page, 340, 260, true);
    expect((await faceLayout(callWindow)).size).toBe(24);
  });
});

/** The call view's code: its chunk in the production build, its module on the dev server. */
const CALL_PANEL_CODE = /\/(assets\/CallPanel-[^/]*\.js|src\/app\/calls\/CallPanel\.tsx)(\?|$)/;

test('a call view that could not load keeps the window that moves, minimizes and expands', async ({
  context,
  page,
}) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(3 * 60_000);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const user = await registerDisposableUser(`callsmall_${suffix}`, randomUUID());
  const callRoom = `Small window ${suffix}`;
  const roomId = await createPrivateRoom(HOMESERVER, user.accessToken, {
    name: callRoom,
    topic: 'The call view that could not load',
  });
  await context.route(
    `${HOMESERVER}/_matrix/client/unstable/org.matrix.msc4143/rtc/transports`,
    (route) =>
      route.fulfill({
        json: {
          rtc_transports: [{ type: 'livekit', livekit_service_url: 'http://127.0.0.1:9/livekit' }],
        },
      })
  );
  // The network drops the call view's code the moment it is first needed.
  await context.route(CALL_PANEL_CODE, (route) => route.abort('internetdisconnected'));
  await loginWithPassword(page, { homeserver: HOMESERVER, ...user });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  await roomHeader(page)
    .getByRole('button', { name: 'Start a call', exact: true })
    .click({ timeout: 60_000 });

  const callWindow = page.getByTestId('call-window');
  await expect(callWindow.locator('[data-part-unavailable]')).toContainText("This couldn't load", {
    timeout: 60_000,
  });
  await expect(page.getByRole('region', { name: callRoom })).toBeVisible();

  // Its title bar moves the window by as much as the pointer went.
  const titleBar = callWindow.getByRole('group', { name: 'Move call window' });
  const before = await boxOf(callWindow);
  const grip = await boxOf(titleBar);
  await page.mouse.move(grip.x + 40, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 40 - 120, grip.y + grip.height / 2 - 90, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const { x, y } = await boxOf(callWindow);
      return { x: Math.round(x), y: Math.round(y) };
    })
    .toEqual({ x: Math.round(before.x - 120), y: Math.round(before.y - 90) });

  // Minimized, it is the window's line with Expand and Close; Expand gives the view back.
  await titleBar.getByRole('button', { name: 'Minimize', exact: true }).click();
  await expect(callWindow).toHaveAttribute('data-bar', 'true');
  const bar = callWindow.getByRole('group', { name: 'Move minimized call window' });
  await expect(bar.getByRole('button', { name: 'Close call view', exact: true })).toBeVisible();
  await bar.getByRole('button', { name: 'Expand', exact: true }).click();
  await expect(callWindow).not.toHaveAttribute('data-bar');
  await expect(callWindow.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();

  // Close closes the window.
  await titleBar.getByRole('button', { name: 'Close call view', exact: true }).click();
  await expect(callWindow).toHaveCount(0);
});
