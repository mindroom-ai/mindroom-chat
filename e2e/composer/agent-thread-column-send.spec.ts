import type { Locator, Page, Route } from '@playwright/test';
import {
  expect,
  inThread,
  lobbyEvents,
  openLobby,
  showPath,
  showThread,
  startThread,
  test,
  uniqueWord,
  waitForThreadEvent,
  type AgentStack,
} from '../helpers/agentStack';

// A send from a thread's column outlives the column: closed while its file still uploads, the
// file and its caption still arrive; opened again meanwhile, the column shows the send as pending,
// and its Send does not send the file a second time. Uploads are held until the test lets them go.
//   scripts/e2e-slot.sh <slot> --preview npx playwright test e2e/composer/agent-thread-column-send.spec.ts
test.describe.configure({ timeout: 360_000 });
test.use({ viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' });

const column = (page: Page): Locator => page.getByTestId('thread-column');
const columnComposer = (page: Page): Locator =>
  column(page).locator('[data-editable-name="RoomInput"]');
const pendingSend = (page: Page): Locator => column(page).locator('[data-pending-send-icon]');
const lobbyPath = (stack: AgentStack) => `/home/${encodeURIComponent(stack.rooms.lobby)}`;

/** Holds every media upload until `release`; `held` resolves once one is waiting. */
const holdUploads = async (page: Page) => {
  const waiting: Route[] = [];
  let heard: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    heard = resolve;
  });
  await page.route('**/_matrix/media/*/upload**', (route) => {
    waiting.push(route);
    heard();
  });
  return {
    held,
    release: async () => {
      await page.unroute('**/_matrix/media/*/upload**');
      await Promise.all(waiting.splice(0).map((route) => route.continue()));
    },
  };
};

/** Stages a text file in the column's composer, types `caption` and sends both with Enter. */
const sendFileWithCaption = async (page: Page, fileName: string, caption: string) => {
  const chooser = page.waitForEvent('filechooser');
  await column(page).getByRole('button', { name: 'Attach files' }).click();
  await (
    await chooser
  ).setFiles([{ name: fileName, mimeType: 'text/plain', buffer: Buffer.from(fileName) }]);
  await expect(column(page).getByText(fileName, { exact: true })).toBeVisible({ timeout: 20_000 });
  await columnComposer(page).click();
  await page.keyboard.type(caption);
  await page.keyboard.press('Enter');
};

const ownBodies = async (stack: AgentStack, rootId: string): Promise<string[]> =>
  (await lobbyEvents(stack))
    .filter((event) => inThread(event, rootId) && event.sender === stack.tester.userId)
    .map((event) => String(event.content.body));

const waitForOwn = (stack: AgentStack, rootId: string, body: string) =>
  waitForThreadEvent(
    stack,
    rootId,
    (event) => event.sender === stack.tester.userId && event.content.body === body,
    { timeout: 60_000, description: `"${body}" in the thread` }
  );

test('a send from the thread column arrives once after the column closes or opens again', async ({
  page,
  stack,
}) => {
  const word = uniqueWord('colsend');
  const rootId = await startThread(stack, `${word} hello`);
  await openLobby(page, stack);
  await showThread(page, stack, rootId);
  await page
    .locator('[data-thread-context-banner]')
    .getByRole('button', { name: 'Thread options', exact: true })
    .click();
  await page
    .getByRole('menuitem', { name: 'Show the thread beside the messages', exact: true })
    .click();
  await expect(column(page)).toBeVisible({ timeout: 30_000 });

  // Closed while the file uploads: the file and its caption still arrive.
  const first = await holdUploads(page);
  const firstFile = `${word}-closed.txt`;
  await sendFileWithCaption(page, firstFile, `${word} closed caption`);
  await first.held;
  await showPath(page, lobbyPath(stack));
  await expect(column(page)).toHaveCount(0);
  await first.release();
  await waitForOwn(stack, rootId, firstFile);
  await waitForOwn(stack, rootId, `${word} closed caption`);

  // Opened again while the file uploads: the column shows the send as pending, and its Send
  // sends nothing more.
  await showThread(page, stack, rootId);
  await expect(column(page)).toBeVisible({ timeout: 30_000 });
  const second = await holdUploads(page);
  const secondFile = `${word}-reopened.txt`;
  await sendFileWithCaption(page, secondFile, `${word} reopened caption`);
  await second.held;
  await showPath(page, lobbyPath(stack));
  await expect(column(page)).toHaveCount(0);
  await showThread(page, stack, rootId);
  await expect(column(page)).toBeVisible({ timeout: 30_000 });
  await expect(pendingSend(page)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('reopened-pending.png') });
  await columnComposer(page).click();
  await page.keyboard.press('Enter');
  await second.release();
  await waitForOwn(stack, rootId, `${word} reopened caption`);
  await expect(pendingSend(page)).toHaveCount(0, { timeout: 30_000 });
  expect(await ownBodies(stack, rootId)).toEqual(expect.arrayContaining([firstFile, secondFile]));
  const bodies = await ownBodies(stack, rootId);
  expect(bodies.filter((body) => body === firstFile)).toHaveLength(1);
  expect(bodies.filter((body) => body === secondFile)).toHaveLength(1);
});
