import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { sendRoomMessage } from '../helpers/matrix';
import { setRoomCompact } from '../helpers/roomViewSwitch';

// Into a thread and out of it by keyboard, in a Compact room against the disposable homeserver of
// `just hs-up` (or a slot of scripts/e2e-slot.sh). Alt and the right arrow goes one level in (the
// composer, the cards, the focused card's thread), Alt and the left arrow one level out; Mod, Alt
// and the arrows move the focus through the cards; the plain arrows, Home and End move between
// focused cards; Mod, Shift and Enter resolves a focused card's thread. A composer with text
// keeps Alt and the left arrow. Set THREAD_KEYS_SHOTS=<dir> to also save screenshots.
const PASSWORD = 'thread-keys-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.THREAD_KEYS_SHOTS;
const MAC = process.platform === 'darwin';
const TOPICS = [
  'Prune the apple trees',
  'Order new ladders',
  'Fix the cider press',
  'Paint the barn',
];

const cards = (page: Page) => page.locator('[data-compact-room-view] [data-thread-root-id]');
const card = (page: Page, threadId: string) =>
  page.locator(`[data-compact-room-view] [data-thread-root-id="${threadId}"]`);
const cardOrder = (page: Page) =>
  cards(page).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-thread-root-id') ?? '')
  );
const banner = (page: Page) => page.locator('[data-thread-context-banner]');
const openThread = (page: Page) => new URL(page.url()).searchParams.get('threadId');
const composer = (page: Page) => page.locator('[data-room-footer]').getByRole('textbox').last();
/** The composer's text, without its placeholder and the fillers of empty lines. */
const composerText = (page: Page) =>
  composer(page).evaluate((element) => {
    const copy = element.cloneNode(true) as HTMLElement;
    copy
      .querySelectorAll('[data-slate-placeholder]')
      .forEach((placeholder) => placeholder.remove());
    return (copy.textContent ?? '').replace(/[\u200B\uFEFF]/g, '');
  });

/** Nothing happened after a key: give the app a moment to act on it first. */
const settle = (page: Page) => page.waitForTimeout(400);

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

/** A Compact room of one thread per topic, open on a page `width` wide: its cards' thread IDs. */
const openOrchard = async (
  page: Page,
  tag: string,
  width: number,
  topics: readonly string[] = TOPICS
): Promise<string[]> => {
  const me = await registerDisposableUser(`thread_keys_${tag}_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, me.accessToken, { name: 'Orchard' });
  for (const topic of topics) {
    // eslint-disable-next-line no-await-in-loop
    const rootId = await sendRoomMessage(HOMESERVER, me.accessToken, roomId, {
      msgtype: 'm.text',
      body: topic,
    });
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, me.accessToken, roomId, {
      msgtype: 'm.text',
      body: `A first note on: ${topic}`,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
  }

  await page.setViewportSize({ width, height: 800 });
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: me.username,
    password: PASSWORD,
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  await setRoomCompact(page, true);
  await expect(cards(page)).toHaveCount(topics.length, { timeout: 30_000 });
  return cardOrder(page);
};

test('the keyboard goes into a thread, to the next one, and out again', async ({ page }) => {
  test.setTimeout(180_000);
  const order = await openOrchard(page, 'full', 1280);
  const [first, second, third, fourth] = order as [string, string, string, string];

  await test.step('Alt and the right arrow goes from the composer to the cards, the left arrow back', async () => {
    await composer(page).click();
    await page.keyboard.press('Alt+ArrowRight');
    await expect(card(page, first)).toBeFocused();
    await expect(card(page, first)).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(composer(page)).toBeFocused();
    expect(openThread(page)).toBeNull();
  });

  await test.step('Mod, Alt and the down arrow moves the focus from the composer into the cards', async () => {
    await page.keyboard.press('ControlOrMeta+Alt+ArrowDown');
    await expect(card(page, first)).toBeFocused();
    await page.keyboard.press('ControlOrMeta+Alt+ArrowDown');
    await expect(card(page, second)).toBeFocused();
    await page.keyboard.press('ControlOrMeta+Alt+ArrowUp');
    await expect(card(page, first)).toBeFocused();
    // The focus shows after a chord too, where a browser reports no `:focus-visible`.
    await expect(card(page, first)).toHaveCSS('outline-style', 'solid');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/thread-keys-focused-card.png` });
  });

  await test.step('the arrows, Home and End move between focused cards', async () => {
    await page.keyboard.press('ArrowDown');
    await expect(card(page, second)).toBeFocused();
    await page.keyboard.press('End');
    await expect(card(page, fourth)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(card(page, fourth)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(card(page, first)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(card(page, second)).toBeFocused();
  });

  await test.step('Alt and the right arrow opens the focused card', async () => {
    await page.keyboard.press('Alt+ArrowRight');
    await expect(banner(page)).toBeVisible({ timeout: 30_000 });
    expect(openThread(page)).toBe(second);
  });

  await test.step("the back button names its keys, and a composer's text keeps them", async () => {
    const back = banner(page).getByRole('button', { name: 'Back', exact: true });
    await expect(back).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowLeft');
    await back.hover();
    const tooltip = page.getByRole('tooltip').filter({ hasText: 'Back' });
    await expect(tooltip).toContainText(MAC ? '⌥←' : 'Alt+←');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/thread-keys-back-tooltip.png` });
    await page.mouse.move(640, 500);

    await composer(page).click();
    await page.keyboard.type('draft');
    // Alt and the left arrow moves by word in text, so the thread stays.
    await page.keyboard.press('Alt+ArrowLeft');
    await settle(page);
    expect(openThread(page)).toBe(second);
    // Under a thread that fills the page no card shows: Mod, Alt and the arrows do nothing.
    await page.keyboard.press('ControlOrMeta+Alt+ArrowDown');
    await settle(page);
    expect(openThread(page)).toBe(second);
    await expect(async () => {
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('Backspace');
      expect(await composerText(page)).toBe('');
    }).toPass({ timeout: 10_000 });
  });

  await test.step('Alt and the left arrow leaves the thread for its card, Alt and the right arrow opens it again', async () => {
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(banner(page)).toHaveCount(0);
    await expect(cards(page)).toHaveCount(TOPICS.length);
    expect(openThread(page)).toBeNull();
    await expect(card(page, second)).toBeFocused();
    await expect(card(page, second)).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Alt+ArrowRight');
    await expect(banner(page)).toBeVisible();
    expect(openThread(page)).toBe(second);
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(banner(page)).toHaveCount(0);
    await expect(card(page, second)).toBeFocused();
    // The next thread from here: the down arrow, then in.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Alt+ArrowRight');
    await expect(banner(page)).toBeVisible();
    expect(openThread(page)).toBe(third);
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(banner(page)).toHaveCount(0);
    await expect(card(page, third)).toBeFocused();
    // One more level out: the composer.
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(composer(page)).toBeFocused();
    // Without a thread or a focused card, the keys are the browser's.
    await page.keyboard.press('Alt+ArrowLeft');
    await settle(page);
    await expect(cards(page)).toHaveCount(TOPICS.length);
    // From the composer, Alt and the right arrow goes to the card of the thread just left.
    await page.keyboard.press('Alt+ArrowRight');
    await expect(card(page, third)).toBeFocused();
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(composer(page)).toBeFocused();
  });

  await test.step('from outside the cards, the focus goes to the card beside the thread just left', async () => {
    await page.keyboard.press('ControlOrMeta+Alt+ArrowUp');
    await expect(card(page, second)).toBeFocused();
  });

  await test.step("Mod, Shift and Enter resolves the focused card's thread and moves on", async () => {
    await page.keyboard.press('ControlOrMeta+Shift+Enter');
    await expect(card(page, third)).toBeFocused();
    // The resolved thread's card says so, or has left the list with the filter that hides them.
    await expect(async () => {
      const resolved = card(page, second);
      if ((await resolved.count()) > 0) {
        await expect(resolved.locator('[data-compact-card-resolved-badge]')).toBeVisible();
      }
    }).toPass({ timeout: 15_000 });
  });

  await test.step('the shortcuts dialog lists the thread keys', async () => {
    await page.keyboard.press('ControlOrMeta+/');
    const row = (id: string) => page.locator(`[data-shortcut-row="${id}"]`);
    await expect(row('nextThread')).toContainText('Next thread');
    await expect(row('nextThread')).toContainText('↓');
    await expect(row('leaveThread')).toContainText('Leave the open thread');
    await expect(row('openThread')).toBeVisible();
    await expect(row('previousThread')).toBeVisible();
    if (SHOTS) {
      await row('leaveThread').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/thread-keys-help.png` });
    }
    await page.keyboard.press('ControlOrMeta+/');
    await expect(row('nextThread')).toHaveCount(0);
  });
});

test('beside its thread, the keys reach the cards and open the next thread', async ({ page }) => {
  test.setTimeout(180_000);
  const order = await openOrchard(page, 'beside', 1600);
  const [, second, third] = order as [string, string, string, string];

  await card(page, second).click();
  await expect(banner(page)).toBeVisible({ timeout: 30_000 });
  await banner(page).getByRole('button', { name: 'Thread options', exact: true }).click();
  await page
    .getByRole('menuitem', { name: 'Show the thread beside the messages', exact: true })
    .click();
  await expect(cards(page)).toHaveCount(TOPICS.length);

  // From the thread's own composer, the keys resolve the open thread.
  await page.getByTestId('thread-column').getByRole('textbox').last().click();
  await page.keyboard.press('ControlOrMeta+Shift+Enter');
  await expect(card(page, second).locator('[data-compact-card-resolved-badge]')).toBeVisible({
    timeout: 15_000,
  });
  expect(openThread(page)).toBe(second);

  // Mod, Alt and the down arrow goes to the card below the open thread's; Alt and the right
  // arrow opens it.
  await page.keyboard.press('ControlOrMeta+Alt+ArrowDown');
  await expect(card(page, third)).toBeFocused();
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(() => openThread(page)).toBe(third);
});

test('a thread left far down a long list hands the focus to its card', async ({ page }) => {
  test.setTimeout(240_000);
  // More cards than the list mounts at first on the way back from a thread.
  const topics = Array.from({ length: 30 }, (_, index) => `Row ${index + 1} of the orchard`);
  const order = await openOrchard(page, 'long', 1280, topics);
  const deep = order[27] ?? '';

  // Opened by its address, as from a link: the list has no place of the reader's to open on.
  const address = new URL(page.url());
  address.searchParams.set('threadId', deep);
  await page.goto(address.toString());
  await expect(banner(page)).toBeVisible({ timeout: 30_000 });
  await composer(page).click();

  await page.keyboard.press('Alt+ArrowLeft');
  await expect(banner(page)).toHaveCount(0);
  await expect(card(page, deep)).toBeFocused();
});
