import { expect, test, type Locator, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, loginToMatrix } from '../helpers/matrix';
import { launchWebKit } from '../helpers/webkit';
import { CHROMIUM_WITH_SCROLLBARS } from '../helpers/disposableAccounts';

// The composer's text box with classic scrollbars, as Linux and Windows show them: no scrollbar
// while the text fits, and a thin one without arrow buttons once it overflows, in dark and light,
// in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit.
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const DESKTOP = { viewport: { width: 1280, height: 800 } };
/** Rows at each end of the scrollbar's strip where an arrow button would draw. */
const END_ROWS = 14;
/** Rows at each end the composer's own rim and focus line cover. */
const RIM_ROWS = 3;

test.use({
  ...DESKTOP,
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

/** A new room without messages, so the composer floats over the plain room background. */
const seedRoom = async () => {
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: `Composer scrollbar ${Date.now().toString(36)}`,
    topic: 'Notes for the composer scrollbar check',
  });
  return { homeserver, credentials, roomId };
};

const openRoute = (page: Page, url: string) =>
  page.evaluate((route) => {
    window.history.pushState(null, '', route);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, url);

type Strip = {
  /** Width the scrollbar takes from the text box. */
  gutter: number;
  overflows: boolean;
  /** Rows of the strip at the box's end edge that differ from its background. */
  inkRows: number[];
  height: number;
};

/** What the scrollbar strip at the end edge of the text box shows, read from a screenshot. */
const readStrip = async (page: Page, scroll: Locator): Promise<Strip> => {
  const geometry = await scroll.evaluate((element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    return {
      x: box.right - 12,
      y: box.top,
      height: box.height,
      gutter: element.offsetWidth - element.clientWidth,
      overflows: element.scrollHeight > element.clientHeight,
    };
  });
  const png = await page.screenshot({
    clip: { x: geometry.x, y: geometry.y, width: 12, height: geometry.height },
    scale: 'css',
  });
  const inkRows = await page.evaluate(
    async ({ data, rim }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (!context) return [];
      context.drawImage(image, 0, 0);
      const { data: pixels, width, height } = context.getImageData(0, 0, image.width, image.height);
      const tone = (x: number, y: number) => {
        const at = (y * width + x) * 4;
        return (
          0.299 * (pixels[at] ?? 0) + 0.587 * (pixels[at + 1] ?? 0) + 0.114 * (pixels[at + 2] ?? 0)
        );
      };
      // The background is the strip's most common tone: the composer's own fill.
      const tones: number[] = [];
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) tones.push(tone(x, y));
      tones.sort((a, b) => a - b);
      const background = tones[Math.floor(tones.length / 2)] ?? 0;
      const rows: number[] = [];
      for (let y = rim; y < height - rim; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (Math.abs(tone(x, y) - background) > 24) {
            rows.push(y);
            break;
          }
        }
      }
      return rows;
    },
    { data: png.toString('base64'), rim: RIM_ROWS }
  );
  return {
    gutter: geometry.gutter,
    overflows: geometry.overflows,
    inkRows,
    height: geometry.height,
  };
};

const SCHEMES = ['dark', 'light'] as const;

const checkComposer = async (page: Page, engine: string) => {
  const editable = page.locator('[data-editable-name="RoomInput"]');
  await expect(editable).toBeVisible({ timeout: 60_000 });
  const scroll = editable.locator('xpath=..');
  const report: string[] = [];
  await editable.click();
  await page.keyboard.type('A short note that fits on one line');
  // The pointer over the text box shows a scrollbar that waits for hover.
  await editable.hover();
  // Without focus, so only the scrollbar can draw in the strip.
  await editable.evaluate((element) => element.blur());
  for (const scheme of SCHEMES) {
    // eslint-disable-next-line no-await-in-loop
    await page.emulateMedia({ colorScheme: scheme });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(300);
    // eslint-disable-next-line no-await-in-loop
    const fits = await readStrip(page, scroll);
    report.push(
      `${engine} ${scheme} fits: gutter ${fits.gutter}, ink rows ${
        fits.inkRows.length
      } of ${Math.round(fits.height)}`
    );
    expect.soft(fits.overflows, `${engine} ${scheme}: one line fits`).toBe(false);
    expect.soft(fits.gutter, `${engine} ${scheme}: no scrollbar takes width`).toBe(0);
    expect.soft(fits.inkRows, `${engine} ${scheme}: nothing drawn at the end edge`).toEqual([]);
  }

  for (let line = 1; line <= 40; line += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press('Shift+Enter');
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.type(`Line ${line}`);
  }
  await editable.hover();
  await editable.evaluate((element) => element.blur());
  for (const scheme of SCHEMES) {
    // eslint-disable-next-line no-await-in-loop
    await page.emulateMedia({ colorScheme: scheme });
    for (const end of ['top', 'bottom'] as const) {
      // eslint-disable-next-line no-await-in-loop
      await scroll.evaluate((element, where) => {
        // eslint-disable-next-line no-param-reassign
        element.scrollTop = where === 'top' ? 0 : element.scrollHeight;
      }, end);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(300);
      // eslint-disable-next-line no-await-in-loop
      const strip = await readStrip(page, scroll);
      report.push(
        `${engine} ${scheme} overflows at ${end}: gutter ${strip.gutter}, ink rows ${
          strip.inkRows.length
        } of ${Math.round(strip.height)} (first ${strip.inkRows[0]}, last ${strip.inkRows.at(-1)})`
      );
      const where = `${engine} ${scheme}, scrolled to the ${end}`;
      expect.soft(strip.overflows, `${where}: 40 lines overflow`).toBe(true);
      expect.soft(strip.gutter, `${where}: the scrollbar is thin`).toBeLessThanOrEqual(8);
      expect.soft(strip.inkRows.length, `${where}: the thumb shows`).toBeGreaterThan(20);
      // The thumb sits at the end the text is scrolled to; the other end shows no arrow button.
      const otherEnd =
        end === 'top'
          ? strip.inkRows.filter((row) => row >= strip.height - END_ROWS)
          : strip.inkRows.filter((row) => row < END_ROWS);
      expect.soft(otherEnd, `${where}: no arrow button at the other end`).toEqual([]);
    }
  }
  console.log(report.join('\n'));
};

test.beforeEach(() => {
  test.skip(!hasPrimaryCredentials(), 'Requires a Matrix test account');
});

test('the composer shows no scrollbar while its text fits, and a thin one after (Chromium)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const { homeserver, credentials, roomId } = await seedRoom();
  await loginWithPassword(page, { homeserver, ...credentials });
  await openRoute(page, `/home/${encodeURIComponent(roomId)}/`);
  await checkComposer(page, 'chromium');
});

test('the composer shows no scrollbar while its text fits, and a thin one after (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  const { homeserver, credentials, roomId } = await seedRoom();
  // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({ ...DESKTOP, baseURL });
    const page = await context.newPage();
    await loginWithPassword(page, { homeserver, ...credentials });
    await openRoute(page, `/home/${encodeURIComponent(roomId)}/`);
    await checkComposer(page, 'webkit');
  } finally {
    await browser.close();
  }
});

// A long draft: its scrollbar shows with the pointer away from the text box, as when the person
// typed, pasted or attached last, and on a touch screen, where nothing hovers; it is the only sign
// that lines are out of view.
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true };

const checkLongDraft = async (page: Page, where: string, touch: boolean) => {
  const editable = page.locator('[data-editable-name="RoomInput"]');
  await expect(editable).toBeVisible({ timeout: 60_000 });
  const scroll = editable.locator('xpath=..');
  if (touch) await editable.tap();
  else await editable.click();
  await page.keyboard.type('Draft line 1');
  for (let line = 2; line <= 60; line += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press('Shift+Enter');
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.type(`Draft line ${line}`);
  }
  // The pointer rests at the far corner of the page, away from the composer; a touch screen keeps
  // :hover where it was last tapped, so the finger taps the empty timeline instead. Without
  // focus, only the scrollbar can draw in the strip.
  if (touch) await page.touchscreen.tap(195, 150);
  else await page.mouse.move(2, 2);
  await editable.evaluate((element) => element.blur());
  for (const scheme of SCHEMES) {
    // eslint-disable-next-line no-await-in-loop
    await page.emulateMedia({ colorScheme: scheme });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(300);
    // eslint-disable-next-line no-await-in-loop
    const strip = await readStrip(page, scroll);
    console.log(
      `${where} ${scheme} long draft: height ${Math.round(strip.height)}, gutter ${
        strip.gutter
      }, ink rows ${strip.inkRows.length}`
    );
    expect.soft(strip.overflows, `${where} ${scheme}: 60 lines overflow`).toBe(true);
    expect
      .soft(strip.inkRows.length, `${where} ${scheme}: the thumb shows without a pointer over it`)
      .toBeGreaterThan(20);
  }
  if (process.env.COMPOSER_SCROLLBAR_SHOTS) {
    await page.screenshot({
      path: `${process.env.COMPOSER_SCROLLBAR_SHOTS}/long-draft-${where.replace(/ /g, '-')}.png`,
    });
  }
};

for (const form of ['desktop', 'phone'] as const) {
  const options = form === 'phone' ? PHONE : DESKTOP;
  test(`a long draft shows its scrollbar with no pointer over it (Chromium, ${form})`, async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    const { homeserver, credentials, roomId } = await seedRoom();
    const context = await browser.newContext({ ...options, baseURL });
    try {
      const page = await context.newPage();
      await loginWithPassword(page, { homeserver, ...credentials });
      await openRoute(page, `/home/${encodeURIComponent(roomId)}/`);
      await checkLongDraft(page, `chromium ${form}`, form === 'phone');
    } finally {
      await context.close();
    }
  });

  test(`a long draft shows its scrollbar with no pointer over it (WebKit, ${form})`, async ({
    baseURL,
  }) => {
    test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    test.setTimeout(180_000);
    const { homeserver, credentials, roomId } = await seedRoom();
    const browser = await launchWebKit();
    try {
      const context = await browser.newContext({ ...options, baseURL });
      const page = await context.newPage();
      await loginWithPassword(page, { homeserver, ...credentials });
      await openRoute(page, `/home/${encodeURIComponent(roomId)}/`);
      await checkLongDraft(page, `webkit ${form}`, form === 'phone');
    } finally {
      await browser.close();
    }
  });
}
