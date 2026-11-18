import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// The composer shows two rows on a desktop: the text box on top, at least two lines tall, and its
// controls in a row under it, Send at the end; it ends 12 px above the bottom of the room, and
// the conversation scrolls on beneath that gap. On a phone it shows one row at rest, 8 px above
// the bottom, and expands to two rows while the user writes; a tap on a control of the expanded
// composer reaches that control even when the press takes focus from the text, as iOS does.
// Who has read the latest message shows at the end of the dock's row above the composer. Set
// COMPOSER_TWO_ROW_SHOTS=<directory> to save the bottom of the screen in the dark theme.
const PASSWORD = 'composer-two-row-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.COMPOSER_TWO_ROW_SHOTS;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  permissions: ['microphone'],
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1180, height: 800 } };
const MESSAGES = Array.from(
  { length: 18 },
  (_, index) => `Launch check ${index + 1}: the load test, the security review and the API page.`
);
const LAST = MESSAGES[MESSAGES.length - 1] ?? '';

test.use({
  launchOptions: {
    ...CHROMIUM_WITH_SCROLLBARS,
    args: [
      ...CHROMIUM_WITH_SCROLLBARS.args,
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  },
});

/** A room the author wrote in, which a second member has read to its latest message. */
const seed = async () => {
  const author = await registerDisposableUser(`ctr_author_${RUN}`, PASSWORD);
  const follower = await registerDisposableUser(`ctr_follower_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, author.accessToken, {
    name: 'Launch planning',
    preset: 'public_chat',
  });
  await joinRoom(HOMESERVER, follower.accessToken, roomId);
  let latest = '';
  for (const body of MESSAGES) {
    // eslint-disable-next-line no-await-in-loop
    latest = await sendRoomMessage(HOMESERVER, author.accessToken, roomId, {
      msgtype: 'm.text',
      body,
    });
  }
  await matrixFetch(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(latest)}`,
    { method: 'POST', accessToken: follower.accessToken, body: '{}' }
  );
  return { author, roomId };
};

type World = Awaited<ReturnType<typeof seed>>;

const textBox = (page: Page) => page.locator('[data-room-footer] [data-editable-name="RoomInput"]');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const composer = (page: Page) => page.locator('[data-composer-expanded]');

const signIn = async (
  browser: Browser,
  baseURL: string | undefined,
  world: World,
  options: BrowserContextOptions
) => {
  const context = await browser.newContext({ ...options, baseURL });
  const page = await context.newPage();
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: world.author.username,
    password: PASSWORD,
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate((to) => {
    window.history.pushState(null, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/home/${encodeURIComponent(world.roomId)}`);
  await expect(page.getByText(LAST, { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(button(page, 'Send message')).toBeVisible();
  return { context, page };
};

/** The bottom of the screen, from 260 px above the composer. */
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const viewport = page.viewportSize();
  const box = await page.locator('[data-room-footer] [data-editor-layout]').boundingBox();
  if (!viewport || !box) return;
  const top = Math.max(0, box.y - 260);
  await page.screenshot({
    path: path.join(SHOTS, `${name}.png`),
    clip: { x: 0, y: top, width: viewport.width, height: viewport.height - top },
  });
};

/** Where the composer's parts are, and what lies under the gap below it. */
const geometry = (page: Page) =>
  page.evaluate(() => {
    const footer = document.querySelector<HTMLElement>('[data-room-footer]');
    const grid = footer?.querySelector<HTMLElement>('[data-editor-layout]');
    const editable = footer?.querySelector('[data-editable-name="RoomInput"]');
    const send = footer?.querySelector('button[aria-label="Send message"]');
    const area = footer?.offsetParent;
    const frame = grid?.parentElement;
    if (!footer || !grid || !editable || !send || !area || !frame) throw new Error('no composer');
    const box = frame.getBoundingClientRect();
    const text = editable.getBoundingClientRect();
    const sendAt = send.getBoundingClientRect();
    const bottom = area.getBoundingClientRect().bottom;
    const under = document.elementFromPoint(box.left + 40, (box.bottom + bottom) / 2);
    return {
      layout: grid.dataset.editorLayout,
      top: box.top,
      height: box.height,
      gapBelow: bottom - box.bottom,
      textHeight: text.height,
      sendBelowText: sendAt.top >= text.bottom - 1,
      sendAtEnd: box.right - sendAt.right < 16,
      // The conversation, not the footer, takes what lies under the gap.
      underIsConversation: !!under && !under.closest('[data-room-footer]') && area.contains(under),
      areaRight: area.getBoundingClientRect().right,
    };
  });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('two rows on a desktop, one row on a phone that expands while writing', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(300_000);
  const world = await seed();

  // Desktop: two rows, low, the conversation beneath, the last message above the composer.
  const desktop = await signIn(browser, baseURL, world, DESKTOP);
  try {
    const { page } = desktop;
    const at = await geometry(page);
    console.log(`desktop: ${JSON.stringify(at)}`);
    expect(at.layout).toBe('stacked');
    expect(at.sendBelowText, 'Send sits under the text box').toBe(true);
    expect(at.sendAtEnd, 'Send ends the controls row').toBe(true);
    expect(at.textHeight, 'the text box is two lines tall').toBeGreaterThanOrEqual(60);
    expect(Math.round(at.gapBelow), '12 px under the composer').toBe(12);
    expect(at.underIsConversation, 'the conversation scrolls on beneath the gap').toBe(true);
    const last = await page.getByText(LAST, { exact: true }).first().boundingBox();
    expect(
      (last?.y ?? 0) + (last?.height ?? 0),
      'the last message clears the composer'
    ).toBeLessThanOrEqual(at.top);

    // Who has read the latest message: at the end of the dock's row, above the composer.
    const following = page.locator('[data-room-following="true"]');
    await expect(following).toContainText('ctr_follower', { timeout: 30_000 });
    const pill = await following.boundingBox();
    const after = await geometry(page);
    expect(await following.evaluate((element) => !element.closest('[data-room-footer]'))).toBe(
      true
    );
    expect(
      (pill?.y ?? 0) + (pill?.height ?? 0),
      'the names sit above the composer'
    ).toBeLessThanOrEqual(after.top);
    expect(
      after.areaRight - ((pill?.x ?? 0) + (pill?.width ?? 0)),
      'at the end of the row'
    ).toBeLessThan(24);
    // The names take a press at their centre; a little beside them, the press reaches the
    // conversation, not the dock.
    const hits = await following.evaluate((element) => {
      const name = element.querySelector('button');
      const box = name?.getBoundingClientRect();
      if (!name || !box) return { centre: false, beside: false };
      const y = box.top + box.height / 2;
      const beside = document.elementFromPoint(box.left - 6, y);
      return {
        centre: !!document
          .elementFromPoint(box.left + box.width / 2, y)
          ?.closest('button')
          ?.isSameNode(name),
        beside:
          !!beside &&
          !beside.closest('[data-room-following]') &&
          !beside.closest('[data-room-footer]'),
      };
    });
    expect(hits, 'the names take presses; beside them the conversation does').toEqual({
      centre: true,
      beside: true,
    });
    const pillBox = await following.locator('button').boundingBox();
    if (!pillBox) throw new Error('no names');
    await page.mouse.click(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2);
    await expect(page.getByText('Seen by', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Seen by', { exact: true })).toBeHidden();
    await page.mouse.move(0, 0);
    await shot(page, 'desktop-empty');

    await textBox(page).click();
    await page.keyboard.type('Can you check why the composer feels cramped at the bottom?');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('I think it should extend down into the strip under it,');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type("and compare against T3 Code's two-row layout.");
    const drafted = await geometry(page);
    expect(drafted.textHeight).toBeGreaterThan(at.textHeight);
    expect(Math.round(drafted.gapBelow)).toBe(12);
    await shot(page, 'desktop-draft');
  } finally {
    await desktop.context.close();
  }

  // Phone: one row at rest; a tap into the text expands it; taps on its controls land.
  const phone = await signIn(browser, baseURL, world, PHONE);
  try {
    const { page } = phone;
    const tap = async (target: ReturnType<Page['locator']>) => {
      const box = await target.boundingBox();
      if (!box) throw new Error('nothing to tap');
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    };
    const rest = await geometry(page);
    console.log(`phone at rest: ${JSON.stringify(rest)}`);
    await expect(composer(page)).toHaveAttribute('data-composer-expanded', 'false');
    expect(rest.layout).toBe('row');
    expect(rest.sendBelowText, 'Send sits beside the text at rest').toBe(false);
    expect(rest.height, 'as tall as one row').toBeLessThan(60);
    expect(Math.round(rest.gapBelow), '8 px under the composer').toBe(8);
    expect(rest.underIsConversation).toBe(true);
    await shot(page, 'phone-rest');

    await tap(textBox(page));
    await expect(composer(page)).toHaveAttribute('data-composer-expanded', 'true');
    await expect(textBox(page)).toBeFocused();
    const open = await geometry(page);
    console.log(`phone expanded: ${JSON.stringify(open)}`);
    expect(open.layout).toBe('stacked');
    expect(open.sendBelowText).toBe(true);
    expect(Math.round(open.gapBelow)).toBe(8);
    await shot(page, 'phone-expanded');

    // As iOS does, a press on a button takes focus from the text before the button's click.
    await page.evaluate(() => {
      window.addEventListener(
        'pointerdown',
        (event) => {
          if (event.target instanceof Element && event.target.closest('button')) {
            (document.activeElement as HTMLElement | null)?.blur();
          }
        },
        true
      );
    });
    const more = button(page, 'More actions');
    await tap(more);
    const menu = page.getByRole('menu', { name: 'More actions' });
    await expect(menu, 'the tap reached More actions').toBeVisible();
    await expect(composer(page)).toHaveAttribute('data-composer-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    // Expanded exactly while focus is in the empty composer, a moment after a change settles.
    const expectExpandedWithFocus = async (what: string) => {
      await page.waitForTimeout(600);
      const read = () =>
        page.evaluate(() => {
          const box = document.querySelector('[data-composer-expanded]');
          return {
            expanded: box?.getAttribute('data-composer-expanded') === 'true',
            focus: !!box?.contains(document.activeElement),
          };
        });
      const now = await read();
      expect(now.expanded, what).toBe(now.focus);
      return now;
    };

    // An empty composer whose menu is open stays expanded under it, past the press's hold,
    // although iOS took focus from the text and the menu opened without focus.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(composer(page)).toHaveAttribute('data-composer-expanded', 'false');
    await tap(more);
    await expect(menu).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.waitForTimeout(600);
    await expect(composer(page), 'open menu keeps it expanded').toHaveAttribute(
      'data-composer-expanded',
      'true'
    );
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(composer(page), 'closed and unfocused, it folds').toHaveAttribute(
      'data-composer-expanded',
      'false'
    );

    await tap(textBox(page));
    await expect(composer(page)).toHaveAttribute('data-composer-expanded', 'true');
    await tap(button(page, 'Record voice message'));
    const discard = button(page, 'Discard voice recording');
    await expect(discard, 'the tap reached the microphone').toBeVisible();
    await expect(composer(page)).toHaveAttribute('data-composer-expanded', 'true');
    await tap(discard);
    await expect(discard).toBeHidden();
    // The discard button had focus and is gone: no stale focus keeps the composer expanded.
    console.log(`after discard: ${JSON.stringify(await expectExpandedWithFocus('after discard'))}`);

    await tap(textBox(page));
    await expect(composer(page)).toHaveAttribute('data-composer-expanded', 'true');
    await page.keyboard.type('Ready for review.');
    await tap(button(page, 'Send message'));
    await expect(page.getByText('Ready for review.', { exact: true }).first()).toBeVisible();
    await expect(textBox(page)).not.toContainText('Ready for review.');

    // Focus leaving an empty composer folds it back to one row.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(composer(page)).toHaveAttribute('data-composer-expanded', 'false');
    expect((await geometry(page)).layout).toBe('row');

    // A room area the keyboard leaves short keeps one row while focused (upright, so no media
    // query for a sideways phone applies).
    await page.setViewportSize({ width: 390, height: 300 });
    await tap(textBox(page));
    await expect(composer(page)).toHaveAttribute('data-composer-expanded', 'true');
    const short = await geometry(page);
    const areaHeight = await page
      .locator('[data-room-footer]')
      .evaluate(
        (footer) => ((footer as HTMLElement).offsetParent as HTMLElement | null)?.clientHeight ?? 0
      );
    console.log(`phone short area ${areaHeight}px: ${JSON.stringify(short)}`);
    expect(areaHeight).toBeLessThanOrEqual(240);
    expect(short.sendBelowText, 'one row in a short area').toBe(false);
  } finally {
    await phone.context.close();
  }
});
