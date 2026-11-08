import {
  expect,
  test,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A call tile, a shared screen's label, the "Waiting for ..." line and a ring name a member whose
// name another member of the room shows too with the user ID after it, the part that tells a copy
// apart. The fixture lays them out as wide as the call panel opens (400 px, or a phone's width),
// too narrow for "Morgan Lee (@casey:matrix.localhost)" on one line: the display name may be cut
// short, never the user ID. No call service: the fixture renders the tiles of a stand-in call.

// The fixture's copies: of a person's name, with a user ID longer than a tile's line, of a long
// name. Each is in the call on one device and connecting on another, shares a screen and rings.
const COPIES = [
  '@casey:matrix.localhost',
  '@morgan.lee.design.operations:matrix.localhost',
  '@alexandra.copy:matrix.localhost',
];

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

/**
 * One entry per place the text of `root` shows `userId`: true when it shows the whole ID, that
 * is, its characters are laid out inside `root`, and no element between them that clips what
 * overflows (`root` included) holds more than fits, an ellipsis or a cut. The overflow is checked,
 * not only the characters' boxes, because WebKit reports a range in ellipsized text only as far as
 * the ellipsis, so a cut-off ID can look whole there.
 */
const idShown = (root: Locator, userId: string) =>
  root.evaluate((element, id) => {
    const places: boolean[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const start = node.textContent?.indexOf(id) ?? -1;
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + id.length);
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0);
      const boxes = [element.getBoundingClientRect()];
      let fits = true;
      for (let box = node.parentElement; box; box = box === element ? null : box.parentElement) {
        const style = getComputedStyle(box);
        const clipsX = style.overflowX !== 'visible';
        const clipsY = style.overflowY !== 'visible';
        if (
          (clipsX && box.scrollWidth > box.clientWidth + 1) ||
          (clipsY && box.scrollHeight > box.clientHeight + 1)
        ) {
          fits = false;
        }
        if (clipsX || clipsY) boxes.push(box.getBoundingClientRect());
      }
      places.push(
        fits &&
          rects.length > 0 &&
          rects.every((rect) =>
            boxes.every(
              (box) =>
                rect.left >= box.left - 0.5 &&
                rect.right <= box.right + 0.5 &&
                rect.top >= box.top - 0.5 &&
                rect.bottom <= box.bottom + 0.5
            )
          )
      );
    }
    return places;
  }, userId);

const openFixture = async (page: Page, view: 'tiles' | 'rings', theme: string, shot: string) => {
  await page.goto(`/e2e/fixtures/call-tile-names.html?view=${view}&theme=${theme}`);
  await page.locator('body[data-fixture-ready]').waitFor({ state: 'attached' });
  await page.screenshot({ path: test.info().outputPath(`${shot}-${view}.png`), fullPage: true });
};

/** Where each copy's user ID shows, and whether it shows whole there. */
const checkIdsWhole = async (page: Page, theme: string, shot: string) => {
  await openFixture(page, 'tiles', theme, shot);
  // Each copy's tile in the call names them once; the connecting one also in "Waiting for ...".
  await expect(page.locator('[data-call-tile]')).toHaveCount(1 + 2 * COPIES.length);
  const tiles = await Promise.all(
    COPIES.map(async (id) => {
      const own = page.locator(`[data-call-tile="${id}"]`);
      const screen = page.locator(`[data-call-screen="${id}"]`);
      return [
        [`tiles of ${id}`, [await idShown(own.nth(0), id), await idShown(own.nth(1), id)]],
        [`screen of ${id}`, [await idShown(screen, id)]],
      ] as const;
    })
  );
  await openFixture(page, 'rings', theme, shot);
  const rings = page.locator('[data-incoming-call]');
  await expect(rings).toHaveCount(COPIES.length);
  const ringed = await Promise.all(
    COPIES.map(async (id, index) => [`ring of ${id}`, [await idShown(rings.nth(index), id)]])
  );
  expect(Object.fromEntries([...tiles.flat(), ...ringed])).toEqual(
    Object.fromEntries(
      COPIES.flatMap((id) => [
        [`tiles of ${id}`, [[true], [true, true]]],
        [`screen of ${id}`, [[true]]],
        [`ring of ${id}`, [[true]]],
      ])
    )
  );
};

const LAYOUTS: { name: string; options: BrowserContextOptions; theme: string }[] = [
  { name: 'desktop', options: { viewport: { width: 1280, height: 800 } }, theme: 'light' },
  { name: 'phone', options: PHONE, theme: 'light' },
];

for (const { name, options, theme } of LAYOUTS) {
  test(`call tiles, screens and rings show a copied name's user ID whole (Chromium ${name})`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ ...options, baseURL });
    try {
      await checkIdsWhole(await context.newPage(), theme, `chromium-${name}`);
    } finally {
      await context.close();
    }
  });

  test(`call tiles, screens and rings show a copied name's user ID whole (WebKit ${name})`, async ({
    baseURL,
  }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    const webkitOptions = name === 'desktop' ? { viewport: { width: 1440, height: 900 } } : options;
    await onWebKitPage({ ...webkitOptions, baseURL }, (page) =>
      checkIdsWhole(page, 'dark', `webkit-${name}`)
    );
  });
}
