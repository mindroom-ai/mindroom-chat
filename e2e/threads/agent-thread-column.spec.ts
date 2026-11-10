import type { Locator, Page } from '@playwright/test';
import {
  expect,
  messageRow,
  openLobby,
  showPath,
  showThread,
  startThread,
  test,
  uniqueWord,
  waitForThreadEvent,
  type AgentStack,
} from '../helpers/agentStack';
import { roomHeader } from '../helpers/roomMenu';

// The thread column end to end: a production build with the example client plugin
// (src/app/plugins/__fixtures__/example-plugin) against the agent stack. A thread first opens in
// the messages' place, as before; Show beside (in the thread's More menu) moves it to a column of its own beside the room's
// messages, with the focus in its composer, and the next thread opens there too. A reply sent
// from the column leaves the room composer's draft alone. The plugin's panel opens to the right of
// the thread, three columns, and closing it leaves two. Dragging the column's edge over the
// messages takes the thread to their place, where the next thread opens too, until Show beside
// again; text and files staged for the thread go with it both ways. A plugin's page opens a thread with the SDK's `navigateRoomThread` the way chosen. A phone
// shows the thread in the messages' place whatever was chosen.
//   MINDROOM_CLIENT_PLUGINS=$PWD/src/app/plugins/__fixtures__/example-plugin \
//     scripts/e2e-slot.sh <slot> --preview npx playwright test e2e/threads/agent-thread-column.spec.ts
test.skip(
  !process.env.MINDROOM_CLIENT_PLUGINS?.includes('example-plugin'),
  'needs a build with the example client plugin in MINDROOM_CLIENT_PLUGINS'
);
test.describe.configure({ timeout: 360_000 });
test.use({ viewport: { width: 1600, height: 900 } });

const LAYOUT_KEY = 'mindroom.threadColumn.layout';

const column = (page: Page): Locator => page.getByTestId('thread-column');
/** The room page's own composer, not the column's. */
const pageComposer = (page: Page): Locator =>
  page.locator('[data-room-footer] [data-editable-name="RoomInput"]');
const columnComposer = (page: Page): Locator =>
  column(page).locator('[data-editable-name="RoomInput"]');
const banner = (scope: Page | Locator): Locator => scope.locator('[data-thread-context-banner]');
const examplePanel = (page: Page): Locator =>
  page.getByRole('region', { name: 'Example panel', exact: true });
const storedLayout = (page: Page) =>
  page.evaluate((key) => window.localStorage.getItem(key), LAYOUT_KEY);

/** The thread's More menu offers to show the thread in the messages' place beside them. */
const showBeside = async (page: Page) => {
  await banner(page).getByRole('button', { name: 'Thread options', exact: true }).click();
  await page
    .getByRole('menuitem', { name: 'Show the thread beside the messages', exact: true })
    .click();
};

const shot = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`thread-column-${name}.png`) });

/** Starts a thread in the lobby and shows it once the helper answered in it. */
const openNewThread = async (page: Page, stack: AgentStack, word: string): Promise<string> => {
  const rootId = await startThread(stack, `${word} hello`);
  await waitForThreadEvent(stack, rootId, (event) => event.sender === stack.agents.helper, {
    timeout: 90_000,
    description: "the helper's reply",
  });
  await showThread(page, stack, rootId);
  return rootId;
};

test('a thread opens beside the messages once chosen, takes their place when dragged over them, and stays there on a phone', async ({
  page,
  stack,
}) => {
  await openLobby(page, stack);
  const word = uniqueWord('column');
  const first = await openNewThread(page, stack, word);

  // First use: the thread in the messages' place, as before.
  await expect(column(page)).toHaveCount(0);
  await shot(page, 'first-use-full');
  await showBeside(page);
  await expect(column(page)).toBeVisible();
  await expect(messageRow(column(page), first)).toBeVisible({ timeout: 30_000 });
  await expect(columnComposer(page)).toBeFocused();
  // The room's messages beside it: the room composer, and the thread's card in the list.
  await expect(pageComposer(page)).toBeVisible();
  await expect(banner(page)).toHaveCount(1);
  expect(await storedLayout(page)).toBe('"beside"');
  await shot(page, 'beside');

  // A draft in the room composer stays while a reply goes out from the column.
  const draft = `${word} draft for the room`;
  await pageComposer(page).click();
  await page.keyboard.type(draft);
  const reply = `${word} reply from the column`;
  await columnComposer(page).click();
  await page.keyboard.type(reply);
  await page.keyboard.press('Enter');
  const sent = await waitForThreadEvent(
    stack,
    first,
    (event) => event.sender === stack.tester.userId && event.content.body === reply,
    { timeout: 60_000, description: 'the reply sent from the column' }
  );
  await expect(messageRow(column(page), sent.event_id)).toContainText(reply, { timeout: 30_000 });
  await expect(pageComposer(page)).toHaveText(draft);
  await expect(columnComposer(page)).not.toContainText(reply);
  await shot(page, 'beside-reply-and-draft');

  // The plugin's panel opens to the right of the thread: three columns.
  await roomHeader(page).getByRole('button', { name: 'Example panel', exact: true }).click();
  await expect(examplePanel(page)).toBeVisible({ timeout: 30_000 });
  await expect(column(page)).toBeVisible();
  await expect
    .poll(async () => {
      const [messages, thread, panel] = await Promise.all([
        pageComposer(page).boundingBox(),
        column(page).boundingBox(),
        examplePanel(page).boundingBox(),
      ]);
      return (
        !!messages &&
        !!thread &&
        !!panel &&
        messages.x + messages.width <= thread.x + 1 &&
        thread.x + thread.width <= panel.x + 1
      );
    })
    .toBe(true);
  await shot(page, 'three-columns');
  await roomHeader(page).getByRole('button', { name: 'Example panel', exact: true }).click();
  await expect(examplePanel(page)).toHaveCount(0, { timeout: 30_000 });
  await expect(column(page)).toBeVisible();

  // Dragged over the messages, the thread takes their place, and that is stored.
  const handle = page.getByRole('separator', { name: 'Resize the thread', exact: true });
  const edge = await handle.boundingBox();
  if (!edge) throw new Error('the thread column has no edge to drag');
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x - 300, edge.y + edge.height / 2, { steps: 5 });
  await page.mouse.move(80, edge.y + edge.height / 2, { steps: 10 });
  await expect(handle).toHaveAttribute('aria-valuetext', 'Show the thread in full');
  await page.mouse.up();
  await expect(column(page)).toHaveCount(0);
  await expect(banner(page)).toBeVisible();
  await expect(messageRow(page, first)).toBeVisible();
  expect(await storedLayout(page)).toBe('"full"');
  await shot(page, 'dragged-full');

  // The next thread opens in the messages' place too, until Show beside.
  const second = await openNewThread(page, stack, `${word}b`);
  await expect(column(page)).toHaveCount(0);
  // A file staged for the thread in the messages' place goes with it to the column.
  const staged = `${word}-full.txt`;
  const fullChooser = page.waitForEvent('filechooser');
  await page.locator('[data-room-footer]').getByRole('button', { name: 'Attach files' }).click();
  await (
    await fullChooser
  ).setFiles([{ name: staged, mimeType: 'text/plain', buffer: Buffer.from('From the thread.') }]);
  await expect(page.locator('[data-room-footer]').getByText(staged, { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await showBeside(page);
  await expect(messageRow(column(page), second)).toBeVisible({ timeout: 30_000 });
  await expect(column(page).getByText(staged, { exact: true })).toBeVisible();
  await expect(page.locator('[data-room-footer]').getByText(staged, { exact: true })).toHaveCount(
    0
  );
  await columnComposer(page).press('Enter');
  await waitForThreadEvent(
    stack,
    second,
    (event) => event.sender === stack.tester.userId && event.content.body === staged,
    { timeout: 60_000, description: 'the file staged in the full view, sent from the column' }
  );

  const third = await openNewThread(page, stack, `${word}c`);
  await expect(messageRow(column(page), third)).toBeVisible({ timeout: 30_000 });
  await shot(page, 'next-thread-beside');

  // The column's own Show in full does what the drag did, and the text and the file staged in its
  // composer go with the thread to the messages' place.
  const unsent = `${word} not sent yet`;
  await columnComposer(page).click();
  await page.keyboard.type(unsent);
  const fileName = `${word}-column.txt`;
  const chooser = page.waitForEvent('filechooser');
  await column(page).getByRole('button', { name: 'Attach files' }).click();
  await (
    await chooser
  ).setFiles([{ name: fileName, mimeType: 'text/plain', buffer: Buffer.from('From the column.') }]);
  await expect(column(page).getByText(fileName, { exact: true })).toBeVisible({ timeout: 20_000 });
  await banner(column(page))
    .getByRole('button', { name: 'Show the thread in full', exact: true })
    .click();
  await expect(column(page)).toHaveCount(0);
  await expect(pageComposer(page)).toBeFocused();
  await expect(pageComposer(page)).toHaveText(unsent);
  await expect(
    page.locator('[data-room-footer]').getByText(fileName, { exact: true })
  ).toBeVisible();
  expect(await storedLayout(page)).toBe('"full"');
  await pageComposer(page).press('Enter');
  await waitForThreadEvent(
    stack,
    third,
    (event) => event.sender === stack.tester.userId && event.content.body === fileName,
    { timeout: 60_000, description: 'the file staged in the column, sent from the full view' }
  );
  await showBeside(page);
  await expect(column(page)).toBeVisible();

  // A plugin opens a thread with the SDK's navigateRoomThread as the app does: beside, as chosen.
  await showPath(
    page,
    `/p/example/rooms/${encodeURIComponent(stack.rooms.lobby)}/${encodeURIComponent(second)}`
  );
  await page.getByRole('button', { name: 'Open the thread', exact: true }).click();
  await expect(messageRow(column(page), second)).toBeVisible({ timeout: 30_000 });

  // A phone shows the thread in the messages' place, with no way beside them.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(column(page)).toHaveCount(0);
  await expect(messageRow(page, second)).toBeVisible({ timeout: 30_000 });
  await banner(page).getByRole('button', { name: 'Thread options', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Copy thread link', exact: true })).toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: 'Show the thread beside the messages' })
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await shot(page, 'phone');
});
