import {
  expect,
  showThread,
  startThread,
  test,
  uniqueWord,
  waitForThreadEvent,
  type MatrixEvent,
} from '../helpers/agentStack';
import { createPrivateRoom } from '../helpers/matrix';

// While this device is in a call, an agent's canvas does not open: its Open canvas button is
// disabled with "End the call to open interactive panels.", and the header lists no canvases;
// after the call it opens again. Needs the slot's call service (scripts/e2e-rtc.sh), which
// scripts/e2e-slot.sh --rtc starts:
//   scripts/e2e-slot.sh <slot> --rtc npx playwright test e2e/canvas/agent-canvas-during-call.spec.ts
test.describe.configure({ timeout: 300_000 });
test.use({
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      '--disable-features=IsolateSandboxedIframes',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  },
});

const callServiceIsUp = async (homeserver: string): Promise<boolean> => {
  try {
    const response = await fetch(`${homeserver}/.well-known/matrix/client`, {
      signal: AbortSignal.timeout(2_000),
    });
    const body = (await response.json()) as Record<string, unknown>;
    const foci = body['org.matrix.msc4143.rtc_foci'] as { livekit_service_url?: string }[];
    const url = foci?.[0]?.livekit_service_url;
    if (!url) return false;
    return (await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2_000) })).ok;
  } catch {
    return false;
  }
};

const isCanvasRequest = (event: MatrixEvent): boolean =>
  (event.content['io.mindroom.ui_action'] as { action?: unknown } | undefined)?.action ===
  'show_canvas';

test('a canvas does not open during a call, and says why', async ({ page, stack }) => {
  test.skip(!(await callServiceIsUp(stack.homeserver)), 'needs scripts/e2e-rtc.sh');
  await page.setViewportSize({ width: 1440, height: 900 });
  const callRoom = await createPrivateRoom(stack.homeserver, stack.tester.accessToken, {
    name: 'Canvas call room',
    topic: 'A call while an agent offers a canvas elsewhere',
  });
  const rootId = await startThread(stack, `${uniqueWord('callcanvas')} #canvas`);
  await waitForThreadEvent(stack, rootId, isCanvasRequest, {
    timeout: 120_000,
    description: 'the canvas request',
  });

  // Join a call in another room, then go to the agent's thread inside the app.
  await page.goto(`/home/${encodeURIComponent(callRoom)}`, { timeout: 180_000 });
  await page.locator('[data-room-call-button]').click();
  const callPanel = page.getByTestId('call-panel');
  await callPanel.getByRole('button', { name: 'Join', exact: true }).click();
  // Counted, not seen: alone in the call, the voice stage lists this device's person only for
  // screen readers.
  await expect(
    page.locator(`[data-call-tile="${stack.tester.userId}"][data-connected="true"]`)
  ).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator('[data-call-tab]')).toBeVisible();
  await showThread(page, stack, rootId);

  const open = page.getByRole('button', { name: 'Open canvas', exact: true }).first();
  await expect(open).toBeVisible({ timeout: 90_000 });
  await expect(open).toBeDisabled();
  await expect(
    page.getByRole('note').filter({ hasText: 'End the call to open interactive panels.' })
  ).toBeVisible();
  const headerCanvases = page
    .locator('header')
    .getByRole('button', { name: /^(Show Canvas|Hide Canvas|Canvases)$/ });
  await expect(headerCanvases).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('canvas-during-call.png') });

  // After the call, the canvas opens again. A page load would take the call up again, so the call
  // ends through its tab in the rail.
  await page.locator('[data-call-tab]').click();
  await callPanel.getByRole('button', { name: 'End' }).click();
  await expect(page.locator('[data-call-tab]')).toHaveCount(0, { timeout: 30_000 });
  // The call view stays open on the room's call; closed, its window no longer floats over the
  // thread.
  await callPanel.getByRole('button', { name: 'Close call' }).click();
  await expect(callPanel).toHaveCount(0);
  await showThread(page, stack, rootId);
  await expect(open).toBeEnabled({ timeout: 30_000 });
  await expect(headerCanvases).toHaveCount(1);
  await open.click();
  await expect(page.getByRole('complementary', { name: 'Canvas panel' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('canvas-after-call.png') });
});
