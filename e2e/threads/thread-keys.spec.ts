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
// and the arrows move the focus through the cards, and from an open thread open the thread above
// or below; the plain arrows, Home and End move between focused cards; Mod, Shift and Enter
// resolves a focused card's thread. A composer with text keeps Alt and the left arrow. Set
// THREAD_KEYS_SHOTS=<dir> to also save screenshots.
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

test('the keyboard goes into a thread, to the next one, and out again', async ({ page }) => {
  test.setTimeout(180_000);
  const me = await registerDisposableUser(`thread_keys_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, me.accessToken, { name: 'Orchard' });
  for (const topic of TOPICS) {
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

  await page.setViewportSize({ width: 1280, height: 800 });
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: me.username,
    password: PASSWORD,
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  await setRoomCompact(page, true);
  await expect(cards(page)).toHaveCount(TOPICS.length, { timeout: 30_000 });
  const order = await cardOrder(page);
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

  await test.step('in the thread, Mod, Alt and the arrows open the thread below or above', async () => {
    await page.keyboard.press('ControlOrMeta+Alt+ArrowDown');
    await expect.poll(() => openThread(page)).toBe(third);
    await page.keyboard.press('ControlOrMeta+Alt+ArrowUp');
    await expect.poll(() => openThread(page)).toBe(second);
    await page.keyboard.press('ControlOrMeta+Alt+ArrowUp');
    await expect.poll(() => openThread(page)).toBe(first);
    // Above the first card there is no thread: this one stays.
    await page.keyboard.press('ControlOrMeta+Alt+ArrowUp');
    await settle(page);
    expect(openThread(page)).toBe(first);
    await expect(banner(page)).toBeVisible();
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
    expect(openThread(page)).toBe(first);
    // Mod, Alt and the arrows have no text meaning: they step from a composer with text too.
    await page.keyboard.press('ControlOrMeta+Alt+ArrowDown');
    await expect.poll(() => openThread(page)).toBe(second);
    await page.keyboard.press('ControlOrMeta+Alt+ArrowUp');
    await expect.poll(() => openThread(page)).toBe(first);
    await composer(page).click();
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
    await expect(card(page, first)).toBeFocused();
    await expect(card(page, first)).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Alt+ArrowRight');
    await expect(banner(page)).toBeVisible();
    expect(openThread(page)).toBe(first);
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(banner(page)).toHaveCount(0);
    await expect(card(page, first)).toBeFocused();
    // One more level out: the composer.
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(composer(page)).toBeFocused();
    // Without a thread or a focused card, the keys are the browser's.
    await page.keyboard.press('Alt+ArrowLeft');
    await settle(page);
    await expect(cards(page)).toHaveCount(TOPICS.length);
    // From the composer, Alt and the right arrow goes to the card of the thread just left.
    await page.keyboard.press('Alt+ArrowRight');
    await expect(card(page, first)).toBeFocused();
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(composer(page)).toBeFocused();
  });

  await test.step('from outside the cards, the focus goes to the card beside the thread just left', async () => {
    await page.keyboard.press('ControlOrMeta+Alt+ArrowDown');
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
