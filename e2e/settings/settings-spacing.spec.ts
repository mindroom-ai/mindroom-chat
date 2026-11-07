import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, matrixFetch } from '../helpers/matrix';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';

// The Settings dialog keeps one inset. Every box of the menu column (the search field, the rows,
// the search results and Logout) stays that far from the dialog's edges and from the divider, and
// the close button stays that far from the top and the end edge. The icons, the group headings and
// the page's breadcrumb start one step further in, the same distance from their column's edge. The
// field, the breadcrumb and the close button share one line. Every page and the search results are
// checked at 1280x800, 1440x900 and 390x844, in dark and light themes, left to right and in Arabic.
// SETTINGS_SPACING_OUT=<directory> also writes every measurement as JSON and screenshots of the
// dialog there.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'settings-spacing-spec-password';
const OUT = process.env.SETTINGS_SPACING_OUT;
const ROOM_COUNT = 26;
/** The settings dialog's inset: folds `S300`. */
const INSET = 12;
const THEMES = ['dark-theme', 'light-theme'] as const;

type Viewport = { width: number; height: number };
const SIZES: Record<string, Viewport> = {
  'desktop-1280': { width: 1280, height: 800 },
  'desktop-1440': { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
};

test.use({
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

/** A fresh account named Alice in 26 rooms, signed in on `page`. */
const signIn = async (page: Page, prefix: string) => {
  const username = `${prefix}_${Date.now().toString(36)}`;
  const { access_token: accessToken, user_id: userId } = await matrixFetch<{
    access_token: string;
    user_id: string;
  }>(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(userId)}/displayname`, {
    method: 'PUT',
    accessToken,
    body: JSON.stringify({ displayname: 'Alice' }),
  });
  for (let index = 0; index < ROOM_COUNT; index += 1) {
    // eslint-disable-next-line no-await-in-loop -- the rooms list in creation order.
    await createPrivateRoom(HOMESERVER, accessToken, {
      name: `Project room ${index + 1}`,
      topic: `Planning and updates for project ${index + 1}`,
    });
  }
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
};

/** Distances in CSS pixels, measured from the side a reader starts on (the right in Arabic). */
type MenuMeasures = {
  /** The search field's distance from the column's top, start and end edges. */
  fieldTop: number;
  fieldStart: number;
  fieldEnd: number;
  /** The magnifier's distance from the column's start edge. */
  searchIcon: number;
  /** Each menu row (or search result): its box's distance from both edges, and its icon's. */
  rows: { name: string; start: number; end: number; icon: number | null }[];
  /** Each group heading's text, from the column's start edge. */
  headings: { name: string; text: number }[];
  /** Logout's box from the column's start, end and bottom edges, and its icon. */
  logout: { start: number; end: number; bottom: number; icon: number };
  /** Space from the field's bottom to the first heading's text, and between the groups. */
  belowField: number;
  groupGaps: number[];
  /** Space from the last row (scrolled into view) to Logout. */
  aboveLogout: number;
  /** How far the menu list scrolls: 0 when every row fits. */
  menuOverflow: number;
  /** The height of the search field's bar on wider screens, and the field's vertical center. */
  searchBar: number | null;
  fieldCenter: number;
};

/** A title bar: its text and its one button (close on wider screens, back or close on phones). */
type BarMeasures = {
  height: number;
  /** The first text's distance from the bar's start edge, and its vertical center. */
  text: number;
  textCenter: number;
  /** The button's box from the dialog's top edge and the bar's start and end edges, and its icon. */
  button: {
    top: number;
    start: number;
    end: number;
    center: number;
    iconStart: number;
    iconEnd: number;
  };
};

type PageMeasures = {
  /** Space from the title bar to the first section heading's text. */
  top: number;
  /** Section headings' text from their card's start edge. */
  headings: number[];
  /** The cards' rows' content from the card's start edge. */
  cardText: number[];
  /** The Advanced fold's chevron from the cards' start edge, when the page has one. */
  advanced: number | null;
  /** Space under the page's last element once scrolled to the end. */
  bottom: number;
  scrolls: boolean;
};

type Measures = {
  rtl: boolean;
  menu?: MenuMeasures;
  /** The phone menu's title bar ("Settings" and the close button). */
  menuTitle?: BarMeasures;
  /** The open page's title bar ("Settings / Appearance"). */
  header?: BarMeasures;
  page?: PageMeasures;
};

/**
 * Measures the dialog as it is: the menu column when it shows, and the open page's title bar and
 * content when one is open. Rounded to a tenth of a pixel.
 */
const measure = (dialog: Locator) =>
  dialog.evaluate((element): Measures => {
    const round = (value: number) => Math.round(value * 10) / 10;
    const rtl = getComputedStyle(element).direction === 'rtl';
    const outer = element.getBoundingClientRect();
    const frame = {
      left: outer.left + element.clientLeft,
      right: outer.left + element.clientLeft + element.clientWidth,
      top: outer.top + element.clientTop,
      bottom: outer.top + element.clientTop + element.clientHeight,
    };
    type Edges = { left: number; right: number };
    const start = (box: Edges, edges: Edges) =>
      round(rtl ? edges.right - box.right : box.left - edges.left);
    const end = (box: Edges, edges: Edges) =>
      round(rtl ? box.left - edges.left : edges.right - box.right);
    // The box of the text itself, without the padding of the elements around it.
    const textBox = (node: Node) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const boxes: DOMRect[] = [];
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        if (!text.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(text);
        boxes.push(range.getBoundingClientRect());
      }
      const left = Math.min(...boxes.map((box) => box.left));
      const top = Math.min(...boxes.map((box) => box.top));
      const right = Math.max(...boxes.map((box) => box.right));
      const bottom = Math.max(...boxes.map((box) => box.bottom));
      return new DOMRect(left, top, right - left, bottom - top);
    };
    const center = (box: DOMRect) => round(box.top + box.height / 2);
    const iconStart = (row: Element, edges: Edges) => {
      const icon = row.querySelector('svg');
      return icon ? start(icon.getBoundingClientRect(), edges) : null;
    };
    const result: Measures = { rtl };

    const nav = element.querySelector('nav');
    const input = element.querySelector('[role="combobox"]');
    const fieldBox = input?.parentElement?.getBoundingClientRect();
    if (nav && input && fieldBox) {
      const column = nav.getBoundingClientRect();
      const edges = {
        left: Math.max(column.left, frame.left),
        right: Math.min(column.right, frame.right),
      };
      const listbox = nav.querySelector('[role="listbox"]');
      const rowElements = listbox
        ? [...listbox.querySelectorAll('[role="option"]')]
        : [...nav.querySelectorAll('[role="group"] button')];
      const headingElements = [...nav.querySelectorAll('[role="group"] > [role="heading"]')];
      const buttons = [...nav.querySelectorAll('button')];
      const logout = buttons[buttons.length - 1]!;
      const logoutBox = logout.getBoundingClientRect();
      let scroller: Element | null = rowElements[0]?.parentElement ?? null;
      while (scroller && scroller !== nav && scroller.scrollHeight <= scroller.clientHeight + 1)
        scroller = scroller.parentElement;
      const overflow =
        scroller && scroller !== nav ? scroller.scrollHeight - scroller.clientHeight : 0;
      if (scroller && scroller !== nav) scroller.scrollTop = scroller.scrollHeight;
      const lastRow = rowElements[rowElements.length - 1]?.getBoundingClientRect();
      const headingText = headingElements.map((heading) => textBox(heading));
      const groupGaps = headingElements.slice(1).map((heading, index) => {
        const previous = heading.parentElement?.previousElementSibling;
        const rows = previous ? [...previous.querySelectorAll('button')] : [];
        const bottom = rows[rows.length - 1]?.getBoundingClientRect().bottom ?? 0;
        return round(headingText[index + 1]!.top - bottom);
      });
      if (scroller && scroller !== nav) scroller.scrollTop = 0;
      const firstHeading = headingElements[0] ? textBox(headingElements[0]) : null;
      result.menu = {
        fieldTop: round(fieldBox.top - frame.top),
        fieldStart: start(fieldBox, edges),
        fieldEnd: end(fieldBox, edges),
        searchIcon: iconStart(input.parentElement!, edges) ?? -1,
        rows: rowElements.map((row) => {
          const box = row.getBoundingClientRect();
          return {
            name: row.textContent ?? '',
            start: start(box, edges),
            end: end(box, edges),
            icon: iconStart(row, edges),
          };
        }),
        headings: headingElements.map((heading, index) => ({
          name: heading.textContent ?? '',
          text: start(headingText[index]!, edges),
        })),
        logout: {
          start: start(logoutBox, edges),
          end: end(logoutBox, edges),
          bottom: round(frame.bottom - logoutBox.bottom),
          icon: iconStart(logout, edges) ?? -1,
        },
        belowField: firstHeading && !listbox ? round(firstHeading.top - fieldBox.bottom) : -1,
        groupGaps: listbox ? [] : groupGaps,
        aboveLogout: lastRow ? round(logoutBox.top - lastRow.bottom) : -1,
        menuOverflow: round(overflow),
        searchBar: input.closest('header')
          ? round(input.closest('header')!.getBoundingClientRect().height)
          : null,
        fieldCenter: center(fieldBox),
      };
    }

    const barOf = (header: Element, text: Element): BarMeasures => {
      const bar = header.getBoundingClientRect();
      const buttons = [...header.querySelectorAll('button')];
      const button = buttons[buttons.length - 1]!;
      const box = button.getBoundingClientRect();
      const icon = button.querySelector('svg')!.getBoundingClientRect();
      return {
        height: round(bar.height),
        text: start(textBox(text), bar),
        textCenter: center(textBox(text)),
        button: {
          top: round(box.top - frame.top),
          start: start(box, bar),
          end: end(box, bar),
          center: center(box),
          iconStart: start(icon, bar),
          iconEnd: end(icon, bar),
        },
      };
    };
    const menuTitle = nav?.querySelector('header h2');
    if (menuTitle) result.menuTitle = barOf(menuTitle.closest('header')!, menuTitle);

    const title = element.querySelector('[data-dialog-title]');
    const titleBar = title?.closest('header');
    if (title && titleBar) {
      const bar = titleBar.getBoundingClientRect();
      result.header = barOf(titleBar, title);

      const content = element.querySelector('[data-settings-page]');
      if (content) {
        const cards = [...content.querySelectorAll('[data-sequence-card]')];
        const headings = [
          ...content.querySelectorAll(':not([data-sequence-card]):has(+ [data-sequence-card])'),
        ];
        const cardOf = (heading: Element) => heading.nextElementSibling!.getBoundingClientRect();
        const advanced = [...content.querySelectorAll('button[aria-expanded][aria-controls]')].find(
          (button) => !button.closest('[data-sequence-card]')
        );
        const firstCard = cards[0]?.getBoundingClientRect();
        let scroller: Element | null = content;
        while (
          scroller &&
          scroller !== element &&
          scroller.scrollHeight <= scroller.clientHeight + 1
        )
          scroller = scroller.parentElement;
        const scrolls = !!scroller && scroller !== element;
        if (scroller && scrolls) scroller.scrollTop = scroller.scrollHeight;
        const last = content.lastElementChild?.lastElementChild ?? content.lastElementChild;
        const bottom = last ? round(frame.bottom - last.getBoundingClientRect().bottom) : -1;
        if (scroller && scrolls) scroller.scrollTop = 0;
        const firstText = headings[0]
          ? textBox(headings[0])
          : cards[0]
          ? cards[0].getBoundingClientRect()
          : null;
        result.page = {
          top: firstText ? round(firstText.top - bar.bottom) : -1,
          headings: headings.map((heading) => start(textBox(heading), cardOf(heading))),
          cardText: cards.flatMap((card) => {
            const row = card.firstElementChild;
            if (!row) return [];
            const padding = parseFloat(getComputedStyle(row).paddingInlineStart);
            return [
              round(start(row.getBoundingClientRect(), card.getBoundingClientRect()) + padding),
            ];
          }),
          advanced:
            advanced && firstCard
              ? start(advanced.querySelector('svg')!.getBoundingClientRect(), firstCard)
              : null,
          bottom,
          scrolls,
        };
      }
    }
    return result;
  });

const settle = async (page: Page) => {
  await page.mouse.move(0, 0);
  // The dialog slides in for 200 ms.
  await page.waitForTimeout(300);
};

/** Stores the theme and language, opens Home at the size, then Settings with ⌘, or Ctrl+,. */
const openSettings = async (page: Page, viewport: Viewport, theme: string, language: string) => {
  await page.setViewportSize(viewport);
  await page.evaluate(
    ([id, code]) => {
      localStorage.setItem('i18nextLng', code!);
      const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
      localStorage.setItem(
        'settings',
        JSON.stringify({ ...settings, useSystemTheme: false, themeId: id })
      );
    },
    [theme, language]
  );
  await page.goto('/home/');
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText('Project room 9', { exact: true }).first()).toBeVisible();
  // ⌘, or Ctrl+, opens Settings in any language; WebKit on Linux takes the account menu's entry.
  if (language === 'en') await chooseFromAccountMenu(page, 'Settings');
  else await page.keyboard.press('ControlOrMeta+,');
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.locator('nav, [data-settings-page]') });
  await expect(dialog).toBeVisible();
  await settle(page);
  return dialog;
};

const menuRows = (dialog: Locator) => dialog.locator('nav [role="group"] button');
const pageName = (dialog: Locator) =>
  dialog.locator('header:has([data-dialog-title]) [data-dialog-title] ~ span').last();

type Record_ = { state: string; measures: Measures };

const near = (actual: number, expected: number, what: string) =>
  expect
    .soft(Math.abs(actual - expected), `${what}: ${actual} against ${expected}`)
    .toBeLessThanOrEqual(1);

/** The checks every measurement must pass; `phone` has no divider and no title bar beside the menu. */
const checkMeasures = ({ state, measures }: Record_, phone: boolean) => {
  const { menu, header, page } = measures;
  if (menu) {
    near(menu.fieldStart, INSET, `${state}: search field from the start edge`);
    near(menu.fieldEnd, INSET, `${state}: search field from the end edge`);
    if (!phone) near(menu.fieldTop, INSET, `${state}: search field from the top edge`);
    for (const row of menu.rows) {
      near(row.start, INSET, `${state}: ${row.name} from the start edge`);
      near(row.end, INSET, `${state}: ${row.name} from the end edge`);
      if (row.icon !== null) near(row.icon, menu.searchIcon, `${state}: ${row.name} icon`);
    }
    for (const heading of menu.headings)
      near(heading.text, menu.searchIcon, `${state}: heading ${heading.name}`);
    near(menu.logout.start, INSET, `${state}: Logout from the start edge`);
    near(menu.logout.end, INSET, `${state}: Logout from the end edge`);
    near(menu.logout.bottom, INSET, `${state}: Logout from the bottom edge`);
    near(menu.logout.icon, menu.searchIcon, `${state}: Logout icon`);
    if (menu.belowField >= 0) near(menu.belowField, INSET, `${state}: field to first heading`);
    for (const gap of menu.groupGaps) near(gap, INSET, `${state}: between groups`);
    if (menu.aboveLogout >= 0)
      expect
        .soft(menu.aboveLogout, `${state}: last row to Logout`)
        .toBeGreaterThanOrEqual(INSET - 1);
    // Wider screens show the whole menu in the 700 px dialog (without Local MindRoom).
    if (!phone && menu.belowField >= 0)
      expect.soft(menu.menuOverflow, `${state}: the menu scrolls`).toBeLessThanOrEqual(1);
  }
  if (menu && measures.menuTitle) {
    const bar = measures.menuTitle;
    near(bar.text, INSET, `${state}: menu title from the start edge`);
    near(bar.button.end, INSET, `${state}: menu close button from the end edge`);
    near(bar.button.center, bar.textCenter, `${state}: menu title and close line`);
    near(menu.fieldTop - bar.height, INSET, `${state}: search field under the menu title`);
  }
  if (header && phone)
    near(header.button.center, header.textCenter, `${state}: back and title line`);
  if (header && menu && !phone) {
    if (menu.searchBar !== null) near(header.height, menu.searchBar, `${state}: bar heights`);
    near(header.button.top, INSET, `${state}: close button from the top edge`);
    near(header.button.end, INSET, `${state}: close button from the end edge`);
    near(header.text, menu.searchIcon, `${state}: breadcrumb from the divider`);
    near(header.button.iconEnd, menu.searchIcon, `${state}: close icon from the end edge`);
    near(header.textCenter, menu.fieldCenter, `${state}: breadcrumb and field line`);
    near(header.button.center, menu.fieldCenter, `${state}: close and field line`);
  }
  if (page) {
    const text = page.cardText[0];
    if (text !== undefined) {
      for (const heading of page.headings) near(heading, text, `${state}: section heading`);
      for (const row of page.cardText) near(row, text, `${state}: card row`);
      if (page.advanced !== null) near(page.advanced, text, `${state}: Advanced chevron`);
    }
    if (page.scrolls)
      expect.soft(page.bottom, `${state}: space under the page`).toBeGreaterThanOrEqual(INSET - 1);
  }
};

/** Every page of the menu, then the search results, measured and checked in both themes. */
const walkSettings = async (
  page: Page,
  size: string,
  language: string,
  out: Record_[],
  browser = 'chromium'
) => {
  const viewport = SIZES[size]!;
  const phone = viewport.width < 600;
  for (const theme of THEMES) {
    /* eslint-disable no-await-in-loop -- one state after the other in one dialog. */
    const dialog = await openSettings(page, viewport, theme, language);
    const tag = `${size} ${language} ${theme}`;
    const shot = async (name: string) => {
      if (!OUT) return;
      mkdirSync(OUT, { recursive: true });
      await dialog.screenshot({
        path: `${OUT}/${browser}-${size}-${language}-${theme}-${name}.png`,
      });
    };
    const rowCount = await menuRows(dialog).count();
    expect(rowCount).toBeGreaterThan(10);
    if (phone) {
      out.push({ state: `${tag} menu`, measures: await measure(dialog) });
      await shot('menu');
    }
    for (let index = 0; index < rowCount; index += 1) {
      const row = menuRows(dialog).nth(index);
      const name = (await row.innerText()).trim();
      await row.click();
      await expect(pageName(dialog)).toHaveText(name);
      await settle(page);
      out.push({ state: `${tag} ${name}`, measures: await measure(dialog) });
      if (index === 3 || index === 0) await shot(`page-${index}`);
      if (phone) {
        await dialog.locator('header:has([data-dialog-title]) button').first().click();
        await expect(menuRows(dialog).first()).toBeVisible();
      }
    }
    // The search results take the menu's place: the name of the fourth page finds its settings.
    const query = (await menuRows(dialog).nth(3).innerText()).trim();
    await dialog.getByRole('combobox').fill(query);
    await expect(dialog.getByRole('option').first()).toBeVisible();
    await settle(page);
    out.push({ state: `${tag} search`, measures: await measure(dialog) });
    await shot('search');
    await page.keyboard.press('Escape');
    /* eslint-enable no-await-in-loop */
  }
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/${browser}-${size}-${language}.json`, JSON.stringify(out, null, 2));
  }
  for (const record of out) checkMeasures(record, phone);
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
});

for (const size of Object.keys(SIZES)) {
  for (const language of ['en', 'ar']) {
    test(`the Settings dialog keeps one inset: ${size}, ${language}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(240_000);
      await signIn(page, `settings_spacing_${size.replace('-', '_')}_${language}`);
      const out: Record_[] = [];
      try {
        await walkSettings(page, size, language, out);
      } finally {
        await testInfo.attach('measures.json', { body: JSON.stringify(out, null, 2) });
      }
    });
  }
}

test('the Settings dialog keeps one inset in WebKit: desktop-1440, en', async ({
  baseURL,
}, testInfo) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  const browser = await launchWebKit();
  const out: Record_[] = [];
  try {
    const context = await browser.newContext({ viewport: SIZES['desktop-1440'], baseURL });
    const page = await context.newPage();
    await signIn(page, 'settings_spacing_webkit');
    await walkSettings(page, 'desktop-1440', 'en', out, 'webkit');
  } finally {
    await testInfo.attach('measures-webkit.json', { body: JSON.stringify(out, null, 2) });
    await browser.close();
  }
});
