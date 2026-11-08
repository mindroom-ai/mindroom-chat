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

// The call view on desktop floats in a window of its own (src/app/calls/window/), against the
// disposable homeserver: the room header's call button opens it on the call's prescreen, its title
// bar moves it and its bottom end corner sizes it, Minimize turns it into a one-line bar and Expand
// gives the height back, Dock puts the call view in the room's side column and Float brings the
// window back where it was, it stays while another room opens, and after a reload it opens again
// in the same place. The homeserver names a call service, so the app offers calls; nothing joins a
// call, so the service is never reached. A joined call in the window is e2e/calls/calls.spec.ts's.

const VIEWPORT = { width: 1440, height: 900 };
test.use({ viewport: VIEWPORT });

type Box = { x: number; y: number; width: number; height: number };

/** The element's box in whole pixels. */
const boxOf = async (locator: Locator): Promise<Box> => {
  const { x, y, width, height } = defined(await locator.boundingBox(), 'a box on the page');
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
};

/**
 * Waits until the window stands at `box`: a change that is not a drag (Minimize, Expand, Float)
 * glides there in 160 ms.
 */
const expectWindowAt = (callWindow: Locator, box: Box) =>
  expect.poll(() => boxOf(callWindow), { message: 'the call window box' }).toEqual(box);

/** Presses the mouse at the middle of `grip`, moves it by `by` in a few steps, and lets go. */
const dragBy = async (page: Page, grip: Box, by: { x: number; y: number }) => {
  const from = { x: grip.x + Math.round(grip.width / 2), y: grip.y + Math.round(grip.height / 2) };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + by.x, from.y + by.y, { steps: 10 });
  await page.mouse.up();
};

test('the call window moves, resizes, minimizes, docks and stays put', async ({
  context,
  page,
}) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(4 * 60_000);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const user = await registerDisposableUser(`callwindow_${suffix}`, randomUUID());
  const callRoom = `Call window ${suffix}`;
  const otherRoom = `Elsewhere ${suffix}`;
  const roomId = await createPrivateRoom(HOMESERVER, user.accessToken, {
    name: callRoom,
    topic: 'The call in the window',
  });
  await createPrivateRoom(HOMESERVER, user.accessToken, { name: otherRoom, topic: 'Another room' });
  await context.route(
    `${HOMESERVER}/_matrix/client/unstable/org.matrix.msc4143/rtc/transports`,
    (route) =>
      route.fulfill({
        json: {
          rtc_transports: [{ type: 'livekit', livekit_service_url: 'http://127.0.0.1:9/livekit' }],
        },
      })
  );
  await loginWithPassword(page, { homeserver: HOMESERVER, ...user });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  const startCall = roomHeader(page).getByRole('button', { name: 'Start a call', exact: true });
  const callWindow = page.getByTestId('call-window');
  const callView = callWindow.getByTestId('call-panel');
  const sidePanel = page.getByTestId('resizable-call-panel');

  // The header's call button opens the window on the prescreen, 400 by 480 px at 16 px from the
  // bottom and end edges, over the page rather than in the room's side column.
  await startCall.click({ timeout: 60_000 });
  await expect(callView).toContainText('Be the first to hop in');
  await expect(callView.getByRole('button', { name: 'Join', exact: true })).toBeVisible();
  await expect(sidePanel).toHaveCount(0);
  let box: Box = {
    x: VIEWPORT.width - 16 - 400,
    y: VIEWPORT.height - 16 - 480,
    width: 400,
    height: 480,
  };
  await expectWindowAt(callWindow, box);

  // The title bar moves the window by as much as the pointer went. It is pressed near its start,
  // on the title, away from its buttons and the grips along the window's edges.
  const titleBar = await boxOf(callWindow.getByRole('group', { name: 'Move call window' }));
  await dragBy(page, { ...titleBar, width: 80 }, { x: -200, y: -150 });
  box = { ...box, x: box.x - 200, y: box.y - 150 };
  await expectWindowAt(callWindow, box);

  // The bottom end corner makes it bigger; its top start corner stays where it is.
  const corner = await boxOf(callWindow.locator('[data-call-window-edge="se"]'));
  await dragBy(page, corner, { x: 80, y: 60 });
  box = { ...box, width: 480, height: 540 };
  await expectWindowAt(callWindow, box);

  // Minimize turns it into the 56 px bar on its bottom edge, which ends with Expand and Close;
  // Expand gives the height back.
  await callView.getByRole('button', { name: 'Minimize', exact: true }).click();
  await expect(callWindow).toHaveAttribute('data-bar', 'true');
  await expectWindowAt(callWindow, { ...box, y: box.y + box.height - 56, height: 56 });
  const bar = callWindow.getByRole('group', { name: 'Move minimized call window' });
  await expect(bar.getByRole('button', { name: 'Close call', exact: true })).toBeVisible();
  await callView.getByRole('button', { name: 'Expand', exact: true }).click();
  await expect(callWindow).not.toHaveAttribute('data-bar');
  await expectWindowAt(callWindow, box);

  // Dock shows the call view in the room's side column instead; Float brings the window back
  // where it was. Each hands the focus its button had to the call view in its new place.
  await callView.getByRole('button', { name: 'Dock to the side', exact: true }).click();
  await expect(sidePanel.getByTestId('call-panel')).toContainText('Be the first to hop in');
  await expect(callWindow).toHaveCount(0);
  await expect(sidePanel.getByRole('heading', { name: callRoom, exact: true })).toBeFocused();
  await sidePanel.getByRole('button', { name: 'Float', exact: true }).click();
  await expect(sidePanel).toHaveCount(0);
  await expectWindowAt(callWindow, box);
  await expect(callWindow.getByRole('group', { name: 'Move call window' })).toBeFocused();

  // Another room opens: the window stays, in its place, on the first room's call.
  await page.getByRole('link', { name: otherRoom, exact: true }).first().click();
  await expect(
    roomHeader(page).getByRole('heading', { name: otherRoom, exact: true })
  ).toBeVisible();
  await expect(callView.getByRole('heading', { name: callRoom, exact: true })).toBeVisible();
  await expectWindowAt(callWindow, box);

  // The account remembers the place and size, so after a reload the window opens there again.
  const stored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? 'null') as unknown,
    `mindroom.callWindow:${user.userId}`
  );
  expect(stored).toMatchObject({ mode: 'floating', rect: box });
  await page.reload();
  await startCall.click({ timeout: 60_000 });
  await expect(callView.getByRole('heading', { name: otherRoom, exact: true })).toBeVisible();
  await expectWindowAt(callWindow, box);
});
