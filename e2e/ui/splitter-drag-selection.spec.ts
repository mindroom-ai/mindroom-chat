import { expect, test, type Page } from '@playwright/test';

// A drag on a side panel's splitter keeps the page from selecting text, and leaves what was
// selected and the composer's caret where they were (e2e/fixtures/splitter-drag.tsx). In the Mac
// app's web view a held mouse that left the splitter of a panel at its widest selected messages.
// This is desktop coverage of the page's policy during a drag (user-select and selectstart), in
// Chromium and WebKit: neither starts a selection from a captured drag, and the Mac app's own
// selection gesture is not exercised here. SPLITTER_SHOTS names a directory for screenshots of a
// selected message in the middle of a drag and after it.

const SHOTS = process.env.SPLITTER_SHOTS;

const open = async (page: Page, query = '') => {
  await page.goto(`/e2e/fixtures/splitter-drag.html${query}`);
  const splitter = page.getByRole('separator', { name: 'Resize Example panel' });
  await expect(splitter).toBeVisible();
  const box = (await splitter.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + 120 };
};

const width = async (page: Page) => (await page.getByTestId('example-panel').boundingBox())!.width;

/** Whether a message can be selected now: its computed style, and its selectstart events. */
const messageSelects = (page: Page) =>
  page.evaluate(() => {
    const message = document.querySelector('main p.selectable')!;
    const style = getComputedStyle(message);
    return {
      userSelect: style.userSelect || style.webkitUserSelect,
      selectstart: message.dispatchEvent(new Event('selectstart', { cancelable: true })),
    };
  });
const SELECTS = { userSelect: 'text', selectstart: true };
const BLOCKED = { userSelect: 'none', selectstart: false };

const selectedText = (page: Page) => page.evaluate(() => window.getSelection()!.toString());

/** A real mouse drag over the conversation, as a reader selects messages. */
const selectMessages = async (page: Page) => {
  await page.mouse.move(40, 30);
  await page.mouse.down();
  await page.mouse.move(300, 120, { steps: 5 });
  await page.mouse.up();
  return selectedText(page);
};

test('a drag on the splitter of a panel at its widest keeps the messages unselectable @webkit', async ({
  page,
}) => {
  const { x, y } = await open(page);
  const widest = await width(page);
  expect(await messageSelects(page)).toEqual(SELECTS);
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Past the widest, over the conversation: the panel stays and the pointer leaves the splitter.
  await page.mouse.move(x - 300, y + 30, { steps: 10 });
  expect(await width(page)).toBe(widest);
  expect(await messageSelects(page)).toEqual(BLOCKED);
  await page.mouse.up();
  expect(await width(page)).toBe(widest);
  expect(await messageSelects(page)).toEqual(SELECTS);
  expect(await selectMessages(page)).not.toBe('');
});

test('a drag on the splitter resizes the panel with the messages unselectable on its way @webkit', async ({
  page,
}) => {
  const { x, y } = await open(page, '?width=500');
  expect(await width(page)).toBe(500);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 100, y, { steps: 5 });
  expect(await messageSelects(page)).toEqual(BLOCKED);
  await page.mouse.up();
  expect(await width(page)).toBe(400);
  expect(await messageSelects(page)).toEqual(SELECTS);
  // And to the conversation's side, wider.
  await page.mouse.move(x + 100, y);
  await page.mouse.down();
  await page.mouse.move(x - 100, y, { steps: 5 });
  expect(await messageSelects(page)).toEqual(BLOCKED);
  await page.mouse.up();
  expect(await width(page)).toBe(600);
  expect(await messageSelects(page)).toEqual(SELECTS);
});

test('a cancelled drag on the splitter makes the messages selectable at once @webkit', async ({
  page,
}) => {
  const { x, y } = await open(page);
  await page.evaluate(() => {
    document.addEventListener('pointerdown', (event) => {
      document.body.dataset.pointerId = String(event.pointerId);
    });
  });
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 200, y, { steps: 5 });
  expect(await messageSelects(page)).toEqual(BLOCKED);
  await page
    .getByRole('separator', { name: 'Resize Example panel' })
    .dispatchEvent('pointercancel', {
      pointerId: Number(await page.locator('body').getAttribute('data-pointer-id')),
      isPrimary: true,
    });
  // Before the button comes up, which would end the drag on its own.
  expect(await messageSelects(page)).toEqual(SELECTS);
  await page.mouse.up();
});

test('typing after a drag on the splitter goes in at the caret @webkit', async ({ page }) => {
  const { x, y } = await open(page, '?width=500');
  const composer = page.getByRole('textbox');
  await composer.click();
  await page.keyboard.type('abcdef');
  for (let left = 0; left < 4; left += 1) await page.keyboard.press('ArrowLeft');
  // To its widest and past it, then back to a smaller width.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 600, y, { steps: 10 });
  await page.mouse.move(x + 100, y, { steps: 10 });
  await page.mouse.up();
  expect(await width(page)).toBe(400);
  await page.keyboard.type('X');
  await expect(composer).toHaveText('abXcdef');
});

test('a selected message stays selected across a drag on the splitter @webkit', async ({
  page,
}) => {
  const { x, y } = await open(page, '?width=500');
  const selected = await selectMessages(page);
  expect(selected).not.toBe('');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 100, y, { steps: 5 });
  const project = test.info().project.name;
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${project}-during.png` });
  await page.mouse.up();
  expect(await width(page)).toBe(400);
  expect(await selectedText(page)).toBe(selected);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${project}-after.png` });
});
