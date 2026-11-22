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
import { COMPACT_VIEW, walkCompactCards } from '../helpers/compactCards';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

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
  const roots: string[] = [];
  for (const topic of topics) {
    // eslint-disable-next-line no-await-in-loop
    const rootId = await sendRoomMessage(HOMESERVER, me.accessToken, roomId, {
      msgtype: 'm.text',
      body: topic,
    });
    roots.push(rootId);
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
  const view = page.locator(COMPACT_VIEW);
  await expect(view).toHaveAttribute('data-compact-card-count', String(topics.length), {
    timeout: 30_000,
  });
  const mounted = await cardOrder(page);
  if (mounted.length === topics.length) return mounted;
  const order = await walkCompactCards(view, roots);
  expect(order).toHaveLength(topics.length);
  await view.evaluate((element) => {
    element.scrollTop = 0;
  });
  return order;
};

test('the keyboard goes into a thread and out again, and between the cards', async ({ page }) => {
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
    await expect(row('nextThread')).toContainText('Focus the next thread');
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

  // Mod, Alt and the down arrow goes to the card below the open thread's. From the open thread's
  // own card, Alt and the right arrow goes back into that thread.
  const threadComposer = page.getByTestId('thread-column').getByRole('textbox').last();
  await page.keyboard.press('ControlOrMeta+Alt+ArrowDown');
  await expect(card(page, third)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(card(page, second)).toBeFocused();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(threadComposer).toBeFocused();
  expect(openThread(page)).toBe(second);

  // And from another card it opens that card's thread.
  await page.keyboard.press('ControlOrMeta+Alt+ArrowDown');
  await expect(card(page, third)).toBeFocused();
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(() => openThread(page)).toBe(third);
});

/** The control that has the focus in the cards: its card and name, and whether it shows. */
const focusedStop = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const view = active?.closest('[data-compact-room-view]');
    if (!active || !view || active.getAttribute('role') === 'scrollbar') return undefined;
    if (active.hasAttribute('data-compact-spacer')) return 'a spacer kept the focus';
    const box = active.getBoundingClientRect();
    const area = view.getBoundingClientRect();
    const control = active.dataset.threadRootId ? 'card' : active.getAttribute('aria-label');
    const id = active.closest<HTMLElement>('[data-scroll-anchor]')?.dataset.scrollAnchor;
    const shown = box.bottom > area.top && box.top < area.bottom;
    const place = `${Math.round(box.top)}..${Math.round(box.bottom)} of ${Math.round(area.bottom)}`;
    return `${id} ${control}${shown ? '' : `, out of view at ${place}, ${view.scrollTop}`}`;
  });

/** The stops `key` (Tab or Shift+Tab) makes from the focused control until it leaves the cards. */
const tabStops = async (page: Page, key: string): Promise<string[]> => {
  const stops: string[] = [];
  for (let press = 0; press < 400; press += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press(key);
    // eslint-disable-next-line no-await-in-loop
    const stop = await focusedStop(page);
    if (stop === undefined) break;
    stops.push(stop);
  }
  return stops;
};

// Tab and Shift+Tab are the browser's own in a list that mounts a window of its cards: every
// card is a stop in the page's order, forwards from its button and backwards from its last
// control, as when every card is mounted. `tab` is the browser's key for every control: Safari
// tabs past buttons without Option.
const checkTabOrder = async (page: Page, tag: string, tab = 'Tab') => {
  const back = `Shift+${tab}`;
  const topics = Array.from({ length: 60 }, (_, index) => `Row ${index + 1} of the orchard`);
  const order = await openOrchard(page, tag, 1280, topics);
  const view = page.locator(COMPACT_VIEW);
  const scrollTo = (top: number) =>
    view.evaluate(async (scroller, to) => {
      scroller.scrollTop = to < 0 ? scroller.scrollHeight : to;
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
    }, top);
  await expect(view).not.toHaveAttribute('data-cards-pending', 'true', { timeout: 30_000 });
  const [first, second] = [order[0] ?? '', order[1] ?? ''];
  const last = order.at(-1) ?? '';
  await expect(card(page, last)).toHaveCount(0);
  await card(page, first).focus();
  const forward = [`${first} card`, ...(await tabStops(page, tab))];
  expect([...new Set(forward.map((stop) => stop.split(' ')[0]))]).toEqual(order);
  expect(forward.filter((stop) => /spacer|out of view/.test(stop))).toEqual([]);
  // Each card has the same controls: its button, then at least its menu.
  expect(forward.length % order.length).toBe(0);
  const controls = forward.length / order.length;
  expect(controls).toBeGreaterThanOrEqual(2);
  // Past the last card, then back: the same stops in reverse, each card entered at its end.
  expect(await view.getByRole('scrollbar').evaluate((bar) => bar === document.activeElement)).toBe(
    true
  );
  expect(await tabStops(page, back)).toEqual([...forward].reverse());

  // From the first card's last control, with the list scrolled to its end: only that card is
  // left of the first cards, and the next stop of the page is the spacer after it.
  await card(page, first).focus();
  for (let press = 1; press < controls; press += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press(tab);
  }
  await scrollTo(-1);
  await expect(card(page, second)).toHaveCount(0);
  await page.keyboard.press(tab);
  expect(await focusedStop(page)).toBe(`${second} card`);
  // From the scrollbar, with the list back at its top: the last card is entered at its end.
  await scrollTo(-1);
  await view.getByRole('scrollbar').focus();
  await scrollTo(0);
  await expect(card(page, last)).toHaveCount(0);
  await page.keyboard.press(back);
  expect(await focusedStop(page)).toBe(forward.at(-1));
};

test('Tab and Shift+Tab stop at every card of a long list, in both directions', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await checkTabOrder(page, 'tab');
});

test('Tab and Shift+Tab stop at every card of a long list, in both directions (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  await onWebKitPage({ baseURL }, (page) => checkTabOrder(page, 'tabw', MAC ? 'Alt+Tab' : 'Tab'));
});

test('a thread left far down a long list hands the focus to its card', async ({ page }) => {
  test.setTimeout(240_000);
  // More cards than the list mounts at first on the way back from a thread.
  const topics = Array.from({ length: 30 }, (_, index) => `Row ${index + 1} of the orchard`);
  const order = await openOrchard(page, 'long', 1280, topics);
  const deep = order[27] ?? '';
  const first = order[0] ?? '';
  const last = order.at(-1) ?? '';
  await expect(card(page, last)).toHaveCount(0);
  await card(page, first).focus();
  await page.keyboard.press('End');
  await expect(card(page, last)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(card(page, first)).toBeFocused();

  // Opened by its address, as from a link: the list has no place of the reader's to open on.
  const address = new URL(page.url());
  address.searchParams.set('threadId', deep);
  await page.goto(address.toString());
  await expect(banner(page)).toBeVisible({ timeout: 30_000 });
  await composer(page).click();

  await page.keyboard.press('Alt+ArrowLeft');
  await expect(banner(page)).toHaveCount(0);
  await expect(card(page, deep)).toBeFocused();

  // With the thread open beside a scrolled-away list, Alt+ArrowLeft reveals its card in view.
  await page.setViewportSize({ width: 1600, height: 800 });
  await expect(page.locator(COMPACT_VIEW)).toHaveAttribute('data-compact-card-count', '30', {
    timeout: 30_000,
  });
  await page.keyboard.press('Alt+ArrowRight');
  await expect(banner(page)).toBeVisible({ timeout: 30_000 });
  await banner(page).getByRole('button', { name: 'Thread options', exact: true }).click();
  await page
    .getByRole('menuitem', { name: 'Show the thread beside the messages', exact: true })
    .click();
  await page.locator(COMPACT_VIEW).evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(card(page, deep)).not.toBeInViewport();
  await page.getByTestId('thread-column').getByRole('textbox').last().click();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(card(page, deep)).toBeFocused();
  await expect(card(page, deep)).toBeInViewport();
});
