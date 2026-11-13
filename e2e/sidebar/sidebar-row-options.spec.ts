import { expect, test, type Locator, type Page } from '@playwright/test';
import { buildLoginPath } from '../env';
import { matrixFetch } from '../helpers/matrix';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// The page navigation beside a floating page card: the open room's highlight sits as far from the
// card as from the rail, with the column's title and menu lined up with the rows, in both
// directions. A room row's options button fades and slides in from the row's end on hover or
// focus, leaves the same way, cannot be reached while hidden, and never moves the row's text.
// Set SIDEBAR_SHOTS=<directory> to also save the gap and the options before, during and after
// hover, light and dark.
const PASSWORD = 'sidebar-options-spec-password';
const SHOTS = process.env.SIDEBAR_SHOTS;

type Account = { username: string; roomId: string };

/** A new account with two rooms; the first one is the one the spec opens. */
const setUp = async (name: string): Promise<Account> => {
  const username = `sidebar_${name}_${Date.now().toString(36)}`;
  const session = await matrixFetch<{ access_token: string }>(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });
  const roomId = await createRoom(HOMESERVER, session.access_token, { name: 'Agent canvas' });
  await createRoom(HOMESERVER, session.access_token, { name: 'Launch plans' });
  return { username, roomId };
};

const openRoom = async (page: Page, account: Account) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  // The form's labels follow the browser's language, so the spec signs in by the fields' names.
  await page.goto(buildLoginPath(HOMESERVER));
  await page.locator('input[name="usernameInput"]').fill(account.username);
  await page.locator('input[name="passwordInput"]').fill(PASSWORD);
  await page.locator('input[name="passwordInput"]').press('Enter');
  await expect(page.locator('[data-selected], nav').first()).toBeVisible({ timeout: 30_000 });
  await page.goto(`/home/${encodeURIComponent(account.roomId)}`);
  await expect(page.locator('[data-room-footer]')).toBeVisible({ timeout: 30_000 });
  await page.mouse.move(900, 450);
};

const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  if (!found) throw new Error('element has no box');
  return { left: found.x, right: found.x + found.width, top: found.y, height: found.height };
};

/** The page card: the nearest clipping ancestor of the room's footer. */
const cardBox = (page: Page) =>
  page.locator('[data-room-footer]').evaluate((footer) => {
    for (let node = footer.parentElement; node; node = node.parentElement) {
      if (getComputedStyle(node).overflow === 'clip') {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      }
    }
    throw new Error('the room is not in a card');
  });

const pageNav = (page: Page) =>
  page.locator('nav').filter({ has: page.locator('[data-selected=true]') });

/** The open row, the rail's first (Home) button, the card and the column title's menu button. */
const measureGap = async (page: Page) => {
  const nav = pageNav(page);
  return {
    row: await box(nav.locator('[data-selected=true]')),
    home: await box(page.locator('nav').first().getByRole('button').first()),
    card: await cardBox(page),
    menu: await box(nav.locator('header button').last()),
  };
};

/** A room row, found by its name, and its options. */
const roomRow = (page: Page, name: string) =>
  pageNav(page).locator('[data-shown]').locator('xpath=..').filter({ hasText: name });

const optionsState = (options: Locator) =>
  options.evaluate((element) => {
    const style = getComputedStyle(element);
    const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
    return {
      shown: element.getAttribute('data-shown'),
      opacity: Number(style.opacity),
      visibility: style.visibility,
      shift: matrix.e,
      running: element
        .getAnimations()
        .map((animation) => (animation as CSSTransition).transitionProperty)
        .sort(),
    };
  });

/** Freezes the options' running transitions at `ms`, for a screenshot of the motion. */
const freezeAt = (options: Locator, ms: number) =>
  options.evaluate((element, time) => {
    element.getAnimations().forEach((animation) => {
      animation.pause();
      animation.currentTime = time;
    });
  }, ms);

const resume = (options: Locator) =>
  options.evaluate((element) => element.getAnimations().forEach((animation) => animation.play()));

const settle = (page: Page) => page.waitForTimeout(400);

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

for (const direction of ['ltr', 'rtl'] as const) {
  test.describe(`${direction} page navigation`, () => {
    test.use({ locale: direction === 'rtl' ? 'ar' : 'en-US' });

    test('the open row sits as far from the card as from the rail', async ({ page }) => {
      test.slow();
      await openRoom(page, await setUp(`gap_${direction}`));
      const { row, home, card, menu } = await measureGap(page);
      const rtl = direction === 'rtl';
      const railGap = rtl ? home.left - row.right : row.left - home.right;
      const cardGap = rtl ? row.left - card.right : card.left - row.right;
      expect(railGap).toBeGreaterThan(12);
      expect(Math.abs(cardGap - railGap)).toBeLessThanOrEqual(4);
      // The title's menu button ends where the rows end.
      expect(Math.abs(rtl ? menu.left - row.left : menu.right - row.right)).toBeLessThanOrEqual(1);
      // Every row of the list, the section headers among them, ends on the same line.
      const ends = await pageNav(page)
        .locator('[data-selected], [role=heading][aria-level="3"]')
        .evaluateAll(
          (elements, isRtl) =>
            elements.map((element) => {
              const rect = element.getBoundingClientRect();
              return Math.round(isRtl ? rect.left : rect.right);
            }),
          rtl
        );
      expect(ends).toEqual(ends.map(() => ends[0]));
      if (SHOTS) {
        for (const scheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme: scheme });
          await settle(page);
          await page.screenshot({
            path: `${SHOTS}/L9-sidebar-gap-${direction}-${scheme}.png`,
            clip: rtl
              ? { x: 1600 - 640, y: 0, width: 640, height: 420 }
              : { x: 0, y: 0, width: 640, height: 420 },
          });
        }
      }
    });

    test('each splitter and its line sit in the middle of their gap', async ({ page }) => {
      test.slow();
      await openRoom(page, await setUp(`split_${direction}`));
      const rtl = direction === 'rtl';
      const nav = page.getByTestId('resizable-page-nav');
      const members = page.getByTestId('resizable-members-panel');
      await expect(members).toBeVisible();
      const card = await cardBox(page);
      const navBox = await box(nav);
      const membersCard = await box(members.locator(':scope > :first-child'));
      const splitters: { name: string; panel: Locator; gap: [number, number] }[] = [
        {
          name: 'nav',
          panel: nav,
          gap: rtl ? [card.right, navBox.left] : [navBox.right, card.left],
        },
        {
          name: 'members',
          panel: members,
          gap: rtl ? [membersCard.right, card.left] : [card.right, membersCard.left],
        },
      ];
      for (const { name, panel, gap } of splitters) {
        const [start, end] = gap;
        expect(end - start, `${name} gap`).toBeCloseTo(8, 0);
        const handle = panel.locator(':scope > [role=separator]');
        await handle.hover();
        await settle(page);
        const line = await handle.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const after = getComputedStyle(element, '::after');
          return {
            center: rect.left + parseFloat(after.left) + parseFloat(after.width) / 2,
            handleCenter: rect.left + rect.width / 2,
            color: after.backgroundColor,
          };
        });
        const gapCenter = (start + end) / 2;
        expect(Math.abs(line.center - gapCenter), `${name} line`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(line.handleCenter - gapCenter), `${name} handle`).toBeLessThanOrEqual(0.5);
        expect(line.color, `${name} line shows on hover`).not.toBe('rgba(0, 0, 0, 0)');
        if (SHOTS) {
          await page.screenshot({
            path: `${SHOTS}/L9-sidebar-splitter-${name}-${direction}.png`,
            clip: { x: gapCenter - 60, y: 0, width: 120, height: 240 },
          });
        }
        await page.mouse.move(900, 450);
        await settle(page);
        expect(
          await handle.evaluate((element) => getComputedStyle(element, '::after').backgroundColor),
          `${name} line hides at rest`
        ).toBe('rgba(0, 0, 0, 0)');
      }
    });

    test('row options fade and slide in on hover and leave the same way', async ({ page }) => {
      test.slow();
      await openRoom(page, await setUp(`options_${direction}`));
      const row = roomRow(page, 'Launch plans');
      const options = row.locator('[data-shown]');
      const name = row.getByRole('link');
      const rest = await optionsState(options);
      const restText = await box(name.getByText('Launch plans'));
      const sign = direction === 'rtl' ? -1 : 1;

      // Hidden: mounted, transparent, out of reach, a few px toward the row's end.
      expect(rest).toMatchObject({ shown: 'false', opacity: 0, visibility: 'hidden' });
      expect(rest.shift * sign).toBeGreaterThan(3);
      const button = options.locator('button');
      expect(
        await button.evaluate((element) => (element.focus(), document.activeElement === element))
      ).toBe(false);

      const shoot = async (step: string) => {
        if (!SHOTS) return;
        await page.screenshot({
          path: `${SHOTS}/L9-sidebar-options-${step}-${direction}.png`,
          clip: await row.boundingBox().then((rowBox) => ({
            x: Math.max(0, (rowBox?.x ?? 0) - 16),
            y: Math.max(0, (rowBox?.y ?? 0) - 40),
            width: (rowBox?.width ?? 240) + 32,
            height: (rowBox?.height ?? 36) + 80,
          })),
        });
      };
      await shoot('before');

      // Hovering starts both transitions at once and lands on the shown state.
      await row.hover();
      const entering = await optionsState(options);
      expect(entering.shown).toBe('true');
      expect(entering.visibility).toBe('visible');
      expect(entering.running).toEqual(expect.arrayContaining(['opacity', 'transform']));
      await freezeAt(options, 80);
      await shoot('during');
      await resume(options);
      await settle(page);
      const shown = await optionsState(options);
      expect(shown).toMatchObject({ opacity: 1, visibility: 'visible', shift: 0 });
      await shoot('after');
      // The row's text stays where it was.
      expect(await box(name.getByText('Launch plans'))).toEqual(restText);

      // Leaving runs the same transitions back instead of hiding the button at once.
      await page.mouse.move(900, 450);
      const leaving = await optionsState(options);
      expect(leaving.shown).toBe('false');
      expect(leaving.visibility).toBe('visible');
      expect(leaving.running).toEqual(expect.arrayContaining(['opacity', 'transform']));
      await settle(page);
      expect(await optionsState(options)).toMatchObject({ opacity: 0, visibility: 'hidden' });

      // Keyboard focus in the row shows the button, and Tab reaches it.
      await name.focus();
      await expect(options).toHaveAttribute('data-shown', 'true');
      await page.keyboard.press('Tab');
      await expect(button).toBeFocused();

      // An open menu keeps it shown after the pointer and focus leave.
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await page.mouse.move(900, 450);
      await settle(page);
      await expect(options).toHaveAttribute('data-shown', 'true');
      await page.keyboard.press('Escape');

      // Reduced motion keeps the fade alone: no sideways shift.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.mouse.click(900, 450);
      await settle(page);
      expect((await optionsState(options)).shift).toBe(0);
    });
  });
}

if (SHOTS) {
  test('options screenshots in dark', async ({ page }) => {
    test.slow();
    await page.emulateMedia({ colorScheme: 'dark' });
    await openRoom(page, await setUp('options_dark'));
    const row = roomRow(page, 'Launch plans');
    const options = row.locator('[data-shown]');
    const clip = await row.boundingBox().then((rowBox) => ({
      x: Math.max(0, (rowBox?.x ?? 0) - 16),
      y: Math.max(0, (rowBox?.y ?? 0) - 40),
      width: (rowBox?.width ?? 240) + 32,
      height: (rowBox?.height ?? 36) + 80,
    }));
    await page.screenshot({ path: `${SHOTS}/L9-sidebar-options-before-dark.png`, clip });
    await row.hover();
    await freezeAt(options, 80);
    await page.screenshot({ path: `${SHOTS}/L9-sidebar-options-during-dark.png`, clip });
    await resume(options);
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/L9-sidebar-options-after-dark.png`, clip });
  });
}
