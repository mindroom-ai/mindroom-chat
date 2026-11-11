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
// (src/app/plugins/__fixtures__/example-plugin) against the agent stack. Every thread shows in the
// thread column. It first fills the page, with the page's one composer; Show beside (a button on
// the thread's banner, also in its More menu) takes it beside the room's messages, inside the
// page's card rather than in a card of its own. A reply sent from the column leaves the room
// composer's draft alone. The plugin's panel opens to the right of the thread, three columns, and
// closing it leaves two. Dragging the column's edge over the messages fills the page with the
// column, which keeps its composer; the next thread then fills the page too, and Show beside takes
// it beside the messages at once, a file staged in its composer and all. A thread opened beside
// the messages takes the focus. Show in full and back keep the column's text and file. A plugin's
// page opens a thread with the SDK's `navigateRoomThread` the way chosen. On a phone a thread fills
// the page whatever was chosen, with no Show beside.
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
  page.locator(
    '[data-room-footer]:not([data-testid="thread-column"] *) [data-editable-name="RoomInput"]'
  );
const columnComposer = (page: Page): Locator =>
  column(page).locator('[data-editable-name="RoomInput"]');
const banner = (scope: Page | Locator): Locator => scope.locator('[data-thread-context-banner]');
const besideButton = (scope: Page | Locator): Locator =>
  banner(scope).getByRole('button', { name: 'Show the thread beside the messages', exact: true });
/** The box a side panel draws its card on; the thread column, in the page's card, draws none. */
const columnBox = (page: Page): Locator => column(page).locator(':scope > :first-child');
const examplePanel = (page: Page): Locator =>
  page.getByRole('region', { name: 'Example panel', exact: true });
const storedLayout = (page: Page) =>
  page.evaluate((key) => window.localStorage.getItem(key), LAYOUT_KEY);

const openThreadOptions = (page: Page) =>
  banner(page).getByRole('button', { name: 'Thread options', exact: true }).click();

/** Takes the column beside the messages with Show beside in the thread's More menu. */
const showBeside = async (page: Page) => {
  await openThreadOptions(page);
  await page
    .getByRole('menuitem', { name: 'Show the thread beside the messages', exact: true })
    .click();
};

const shot = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`thread-column-${name}.png`) });

/** Stages a text file named `name` in the composer inside `scope`. */
const stageFile = async (page: Page, scope: Locator, name: string) => {
  const chooser = page.waitForEvent('filechooser');
  await scope.getByRole('button', { name: 'Attach files' }).click();
  await (await chooser).setFiles([{ name, mimeType: 'text/plain', buffer: Buffer.from(name) }]);
  await expect(scope.getByText(name, { exact: true })).toBeVisible({ timeout: 20_000 });
};

/** The tester's message `body` in the thread `rootId`, once the server has it. */
const ownMessage = (stack: AgentStack, rootId: string, body: string, description: string) =>
  waitForThreadEvent(
    stack,
    rootId,
    (event) => event.sender === stack.tester.userId && event.content.body === body,
    { timeout: 60_000, description }
  );

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

test('a thread fills the page, goes beside the messages once chosen, fills it again when dragged over them, and fills it on a phone', async ({
  page,
  stack,
}) => {
  await openLobby(page, stack);
  const word = uniqueWord('column');
  const first = await openNewThread(page, stack, word);

  // First use: the column fills the page, with the page's one composer.
  await expect(column(page)).toHaveAttribute('data-filled', 'true');
  await expect(messageRow(column(page), first)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-editable-name="RoomInput"]')).toHaveCount(1);
  await expect(pageComposer(page)).toHaveCount(0);
  await shot(page, 'first-use-full');
  await besideButton(page).click();
  await expect(column(page)).not.toHaveAttribute('data-filled', 'true');
  await expect(messageRow(column(page), first)).toBeVisible();
  // The room's messages beside it: the room composer, and the thread's card in the list.
  await expect(pageComposer(page)).toBeVisible();
  await expect(banner(page)).toHaveCount(1);
  expect(await storedLayout(page)).toBe('"beside"');
  await expect(columnBox(page)).toHaveCSS('box-shadow', 'none');
  await shot(page, 'beside');

  // A draft in the room composer stays while a reply goes out from the column.
  const draft = `${word} draft for the room`;
  await pageComposer(page).click();
  await page.keyboard.type(draft);
  const reply = `${word} reply from the column`;
  await columnComposer(page).click();
  await page.keyboard.type(reply);
  await page.keyboard.press('Enter');
  const sent = await ownMessage(stack, first, reply, 'the reply sent from the column');
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

  // Dragged over the messages, the column fills the page, keeping its thread; that is stored.
  const handle = page.getByRole('separator', { name: 'Resize the thread', exact: true });
  const edge = await handle.boundingBox();
  if (!edge) throw new Error('the thread column has no edge to drag');
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x - 300, edge.y + edge.height / 2, { steps: 5 });
  await page.mouse.move(80, edge.y + edge.height / 2, { steps: 10 });
  await expect(handle).toHaveAttribute('aria-valuetext', 'Show the thread in full');
  await page.mouse.up();
  await expect(column(page)).toHaveAttribute('data-filled', 'true');
  await expect(columnBox(page)).toHaveCSS('box-shadow', 'none');
  await expect(messageRow(column(page), sent.event_id)).toBeVisible();
  await expect(pageComposer(page)).toBeHidden();
  // The room's header comes with it, its buttons in reach.
  await expect(column(page).locator('h1')).toBeVisible();
  await expect(
    roomHeader(page).getByRole('button', { name: 'Example panel', exact: true })
  ).toBeVisible();
  expect(await storedLayout(page)).toBe('"full"');
  await shot(page, 'dragged-full');

  // The next thread fills the page too, as chosen last. A file staged in its composer goes beside
  // the messages with it: Show beside does not wait.
  const second = await openNewThread(page, stack, `${word}b`);
  await expect(column(page)).toHaveAttribute('data-filled', 'true');
  const staged = `${word}-full.txt`;
  await stageFile(page, column(page), staged);
  await showBeside(page);
  await expect(column(page)).not.toHaveAttribute('data-filled', 'true');
  await expect(messageRow(column(page), second)).toBeVisible({ timeout: 30_000 });
  await expect(column(page).getByText(staged, { exact: true })).toBeVisible();
  await shot(page, 'beside-with-file');
  await columnComposer(page).press('Enter');
  await ownMessage(stack, second, staged, 'the file staged while the column filled the page');

  // A thread that opens beside the messages takes the focus.
  const third = await openNewThread(page, stack, `${word}c`);
  await expect(messageRow(column(page), third)).toBeVisible({ timeout: 30_000 });
  await expect(columnComposer(page)).toBeFocused();
  await shot(page, 'next-thread-beside');

  // Show in full and back keep the column's composer, with its text and file.
  const unsent = `${word} not sent yet`;
  await columnComposer(page).click();
  await page.keyboard.type(unsent);
  const fileName = `${word}-column.txt`;
  await stageFile(page, column(page), fileName);
  await banner(column(page))
    .getByRole('button', { name: 'Show the thread in full', exact: true })
    .click();
  await expect(column(page)).toHaveAttribute('data-filled', 'true');
  await expect(columnComposer(page)).toHaveText(unsent);
  // Letters typed with the focus on the thread's text go on in the column's composer, where it
  // left off.
  await column(page).getByText(`${word}c hello`, { exact: true }).click();
  await page.keyboard.type('more');
  await expect(columnComposer(page)).toHaveText(`${unsent}more`);
  await expect(column(page).getByText(fileName, { exact: true })).toBeVisible();
  expect(await storedLayout(page)).toBe('"full"');
  await besideButton(column(page)).click();
  await expect(column(page)).not.toHaveAttribute('data-filled', 'true');
  await expect(pageComposer(page)).toBeVisible();
  expect(await storedLayout(page)).toBe('"beside"');
  await columnComposer(page).press('Enter');
  await ownMessage(stack, third, fileName, 'the file staged in the column');

  // A plugin opens a thread with the SDK's navigateRoomThread as the app does: beside, as chosen.
  await showPath(
    page,
    `/p/example/rooms/${encodeURIComponent(stack.rooms.lobby)}/${encodeURIComponent(second)}`
  );
  await page.getByRole('button', { name: 'Open the thread', exact: true }).click();
  await expect(messageRow(column(page), second)).toBeVisible({ timeout: 30_000 });

  // On a phone a thread fills the page, with no way beside the messages.
  await page.setViewportSize({ width: 390, height: 844 });
  await showThread(page, stack, first);
  await expect(column(page)).toHaveAttribute('data-filled', 'true');
  await expect(besideButton(page)).toHaveCount(0);
  await openThreadOptions(page);
  await expect(page.getByRole('menuitem', { name: 'Copy thread link', exact: true })).toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: /Show the thread beside the messages/ })
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await shot(page, 'phone');
});
