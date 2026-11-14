import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, matrixFetch } from '../helpers/matrix';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// The Settings dialog keeps one inset. Every box of the menu column (the search field, the rows,
// the search results and Logout) stays that far from the dialog's edges and from the divider, and
// the close button stays that far from the top and the end edge. The icons and the group headings
// start one step further in, the same distance from the column's edge, and the page's breadcrumb
// starts where the page's text does. The field, the breadcrumb and the close button share one
// line. On wider screens the dialog is tall enough for the whole menu, Local MindRoom included,
// and a room's settings dialog has the same title bars. Every page and the search results are
// checked at 1280x800, 1440x900 and 390x844, in dark and light themes, left to right and in Arabic.
// SETTINGS_SPACING_OUT=<directory> also writes every measurement as JSON and screenshots of the
// dialog there.
const PASSWORD = 'settings-spacing-spec-password';
const OUT = process.env.SETTINGS_SPACING_OUT;
const ROOM_COUNT = 26;
/** The settings dialog's inset: folds `S300`. */
const INSET = 12;
/** The tallest the desktop dialog grows, and its margin to the window's edges. */
const DIALOG_HEIGHT = 740;
const DIALOG_MARGIN = 16;
/** Both title bars on wider screens: the 32 px search field and the inset above and below it. */
const BAR = 56;
const THEMES = ['dark-theme', 'light-theme'] as const;

type Viewport = { width: number; height: number };
const SIZES: Record<string, Viewport> = {
  'desktop-1280': { width: 1280, height: 800 },
  'desktop-1440': { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
};

test.use({
  // The routed configuration (Local MindRoom) reaches the page only without the service worker.
  serviceWorkers: 'block',
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

/** The deployment offers Local MindRoom to this homeserver's accounts; the slot has no service. */
const routeLocalMindroom = async (page: Page) => {
  await page.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as Record<string, Record<string, unknown>>;
    await route.fulfill({
      response,
      json: { ...config, sidebar: { ...config.sidebar, mindRoomProvisioningUrl: HOMESERVER } },
    });
  });
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
};

/** A fresh account named Alice in 26 rooms, signed in on `page`; returns the first room. */
const signIn = async (page: Page, prefix: string) => {
  await routeLocalMindroom(page);
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
  const roomIds: string[] = [];
  for (let index = 0; index < ROOM_COUNT; index += 1) {
    roomIds.push(
      // eslint-disable-next-line no-await-in-loop -- the rooms list in creation order.
      await createPrivateRoom(HOMESERVER, accessToken, {
        name: `Project room ${index + 1}`,
        topic: `Planning and updates for project ${index + 1}`,
      })
    );
  }
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  return roomIds[0]!;
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
  /**
   * The button's box from the dialog's top edge and the bar's start and end edges, and its icon
   * (none in a room's menu title bar on wider screens).
   */
  button: null | {
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
  /**
   * Where the page's text starts, from the pane's start edge: the first section heading's text, or
   * the first card's rows on a page without headings.
   */
  textEdge: number;
};

type Measures = {
  rtl: boolean;
  /** The dialog's height. */
  height: number;
  menu?: MenuMeasures;
  /** The menu's title bar: a phone's "Settings" and close button, or a room's name. */
  menuTitle?: BarMeasures;
  /** The open page's title bar ("Settings / Appearance", or a room's "General"). */
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
    const result: Measures = { rtl, height: round(outer.height) };

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
      const button = buttons[buttons.length - 1];
      const box = button?.getBoundingClientRect();
      const icon = button?.querySelector('svg')?.getBoundingClientRect();
      return {
        height: round(bar.height),
        text: start(textBox(text), bar),
        textCenter: center(textBox(text)),
        button:
          box && icon
            ? {
                top: round(box.top - frame.top),
                start: start(box, bar),
                end: end(box, bar),
                center: center(box),
                iconStart: start(icon, bar),
                iconEnd: end(icon, bar),
              }
            : null,
      };
    };
    const menuTitle = nav?.querySelector('header h2');
    if (menuTitle) result.menuTitle = barOf(menuTitle.closest('header')!, menuTitle);

    // The page's title bar is the header outside the menu; its text, the breadcrumb.
    const titleBar = [...element.querySelectorAll('header')].find(
      (header) => !header.closest('nav')
    );
    const title = titleBar
      ? [...titleBar.children].find((child) => child.textContent?.trim())
      : undefined;
    if (title && titleBar) {
      const bar = titleBar.getBoundingClientRect();
      result.header = barOf(titleBar, title);

      const content = element.querySelector('[data-settings-page]');
      if (content) {
        const cards = [...content.querySelectorAll('[data-sequence-card]')];
        const headings = [...content.querySelectorAll('[data-settings-heading]')];
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
          textEdge: headings[0]
            ? start(textBox(headings[0]), bar)
            : firstCard && cards[0]!.firstElementChild
            ? round(
                start(firstCard, bar) +
                  parseFloat(getComputedStyle(cards[0]!.firstElementChild).paddingInlineStart)
              )
            : -1,
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
const checkMeasures = ({ state, measures }: Record_, viewport: Viewport) => {
  const { menu, header, page } = measures;
  const phone = viewport.width < 600;
  if (!phone) {
    const height = Math.min(DIALOG_HEIGHT, viewport.height - 2 * DIALOG_MARGIN);
    near(measures.height, height, `${state}: dialog height`);
  }
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
    // Wider screens show the whole menu, Local MindRoom included.
    if (!phone && menu.belowField >= 0)
      expect.soft(menu.menuOverflow, `${state}: the menu scrolls`).toBeLessThanOrEqual(1);
  }
  if (menu && measures.menuTitle?.button) {
    const bar = measures.menuTitle;
    const button = measures.menuTitle.button;
    near(bar.text, INSET, `${state}: menu title from the start edge`);
    near(button.end, INSET, `${state}: menu close button from the end edge`);
    near(button.center, bar.textCenter, `${state}: menu title and close line`);
    near(menu.fieldTop - bar.height, INSET, `${state}: search field under the menu title`);
  }
  if (header?.button && phone)
    near(header.button.center, header.textCenter, `${state}: back and title line`);
  if (header?.button && menu && !phone) {
    if (menu.searchBar !== null) near(header.height, menu.searchBar, `${state}: bar heights`);
    near(header.button.top, INSET, `${state}: close button from the top edge`);
    near(header.button.end, INSET, `${state}: close button from the end edge`);
    if (page && page.textEdge >= 0)
      near(header.text, page.textEdge, `${state}: breadcrumb on the page's text edge`);
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
    expect(rowCount, 'the menu, Local MindRoom included').toBe(14);
    if (phone) {
      out.push({ state: `${tag} menu`, measures: await measure(dialog) });
      await shot('menu');
    }
    for (let index = 0; index < rowCount; index += 1) {
      const row = menuRows(dialog).nth(index);
      const name = (await row.innerText()).trim();
      await row.click();
      // The page's own title may say more ("Connect Local MindRoom").
      await expect(pageName(dialog)).toContainText(name);
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
  for (const record of out) checkMeasures(record, viewport);
};

/**
 * A room's settings dialog: its menu's title bar (the room's name) and the page's title bar are
 * both 56 px, the close button keeps the inset from the top and the end edge, the room's name, the
 * page's title and the close button share one line, and the title starts where the page's text
 * does.
 */
const checkRoomMeasures = ({ state, measures }: Record_) => {
  const { menuTitle, header, page } = measures;
  expect(menuTitle, `${state}: the room's name`).toBeTruthy();
  expect(header?.button, `${state}: the close button`).toBeTruthy();
  if (!menuTitle || !header?.button) return;
  near(menuTitle.height, BAR, `${state}: room name bar height`);
  near(header.height, BAR, `${state}: page title bar height`);
  near(header.button.top, INSET, `${state}: close button from the top edge`);
  near(header.button.end, INSET, `${state}: close button from the end edge`);
  near(header.textCenter, menuTitle.textCenter, `${state}: room name and page title line`);
  near(header.button.center, header.textCenter, `${state}: page title and close line`);
  if (page && page.textEdge >= 0)
    near(header.text, page.textEdge, `${state}: page title on the page's text edge`);
};

/** Every page of a room's settings, in both themes. */
const walkRoomSettings = async (page: Page, size: string, roomId: string, out: Record_[]) => {
  const viewport = SIZES[size]!;
  for (const theme of THEMES) {
    /* eslint-disable no-await-in-loop -- one state after the other in one dialog. */
    await openSettings(page, viewport, theme, 'en');
    await page.keyboard.press('Escape');
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    const roomHeader = page.locator('header').filter({ hasText: 'Project room 1' });
    await roomHeader.getByRole('button').last().click();
    await page.getByRole('menuitem', { name: 'Room Settings', exact: true }).click();
    const dialog = page.getByRole('dialog').filter({ has: page.locator('[data-settings-page]') });
    await expect(dialog).toBeVisible();
    await settle(page);
    const rows = dialog.locator('nav button');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(3);
    const pageTitle = dialog.locator('header:not(nav header)').first();
    for (let index = 0; index < rowCount; index += 1) {
      const row = rows.nth(index);
      const name = (await row.innerText()).trim();
      const before = await pageTitle.innerText();
      await row.click();
      // The first page is open already; the others change the title ("Members" reads "1 Member").
      if (index > 0) await expect(pageTitle).not.toHaveText(before);
      await settle(page);
      out.push({ state: `room ${size} ${theme} ${name}`, measures: await measure(dialog) });
      if (OUT && index === 0) {
        mkdirSync(OUT, { recursive: true });
        await dialog.screenshot({ path: `${OUT}/chromium-room-${size}-${theme}-page-0.png` });
      }
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    /* eslint-enable no-await-in-loop */
  }
  if (OUT) writeFileSync(`${OUT}/chromium-room-${size}.json`, JSON.stringify(out, null, 2));
  for (const record of out) checkRoomMeasures(record);
};

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
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

for (const size of ['desktop-1280', 'desktop-1440']) {
  test(`a room's settings dialog has the same title bars: ${size}`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const roomId = await signIn(page, `settings_spacing_room_${size.replace('-', '_')}`);
    const out: Record_[] = [];
    try {
      await walkRoomSettings(page, size, roomId, out);
    } finally {
      await testInfo.attach('room-measures.json', { body: JSON.stringify(out, null, 2) });
    }
  });
}

test('the Settings dialog keeps one inset in WebKit: desktop-1440, en', async ({
  baseURL,
}, testInfo) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  const browser = await launchWebKit();
  const out: Record_[] = [];
  try {
    const context = await browser.newContext({
      viewport: SIZES['desktop-1440'],
      baseURL,
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    await signIn(page, 'settings_spacing_webkit');
    await walkSettings(page, 'desktop-1440', 'en', out, 'webkit');
  } finally {
    await testInfo.attach('measures-webkit.json', { body: JSON.stringify(out, null, 2) });
    await browser.close();
  }
});
