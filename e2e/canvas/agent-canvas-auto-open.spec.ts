import {
  expect,
  openLobby,
  routeClientConfig,
  sendFromComposer,
  showThread,
  startThread,
  test,
  uniqueWord,
  waitForAgentReply,
  waitForThreadEvent,
  type MatrixEvent,
} from '../helpers/agentStack';

// A live canvas request opens the Canvas panel by itself when the deployment lets the agent's
// homeserver do so (`mindroom.uiActions.autoOpenFromHomeservers`). Each test runs in a new browser
// context restored from the signed-in storage state, so its first page load is a browser session's
// first: no service worker yet, which takes the page with one reload.
test.describe.configure({ timeout: 300_000 });

const isCanvasRequest = (event: MatrixEvent): boolean =>
  (event.content['io.mindroom.ui_action'] as { action?: unknown } | undefined)?.action ===
  'show_canvas';

test('a live canvas request opens by itself on the first load of a browser session @webkit', async ({
  page,
  stack,
}) => {
  const agentServer = stack.agents.helper.slice(stack.agents.helper.indexOf(':') + 1);
  await routeClientConfig(page, stack, { uiActions: { autoOpenFromHomeservers: [agentServer] } });
  await page.setViewportSize({ width: 1440, height: 900 });

  await openLobby(page, stack);
  const rootId = await startThread(stack, `${uniqueWord('autoopen')} hello`);
  await showThread(page, stack, rootId);
  await waitForAgentReply(stack, rootId, (body) => body.includes('You said'), {
    timeout: 120_000,
  });

  // A person reading the thread asks for the canvas; the request only opens a focused window.
  await page.bringToFront();
  await sendFromComposer(page, '#canvas please');
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
  await waitForThreadEvent(stack, rootId, isCanvasRequest, {
    timeout: 120_000,
    description: 'the canvas request',
  });

  const panel = page.getByRole('complementary', { name: 'Canvas panel' });
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel).toContainText('Interactive panel from Helper');
});
