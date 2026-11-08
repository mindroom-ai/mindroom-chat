import { mkdirSync } from 'node:fs';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A call this device is in, in a room named `Payroll <U+202E>sevihcra<U+202C>`: the rail's call
// tab (its label, and on a desktop its tooltip) and the call panel (its heading, its name and its
// controls' name) show each direction control as its code point, in English and in Arabic, where
// the name sits between the translation's isolates. No call service: the fixture renders the real
// tab and panel for a stand-in call that reports itself connected. On a phone (390 by 844, touch)
// and a desktop (1280 by 800), in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names
// Playwright's WebKit, in WebKit. Set CALL_PANEL_NAMES_SHOTS=<directory> to save each view.
const SHOTS = process.env.CALL_PANEL_NAMES_SHOTS;
const NAME_SHOWN = 'Payroll <U+202E>sevihcra<U+202C>';
const CONTROL = /[؜‎‏‪-‮⁦-⁩]/;
// What a translation puts around a name it holds: a first-strong isolate and its end.
const TRANSLATION_ISOLATES = /[⁨⁩]/g;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

const RETURN_TO_CALL = {
  en: `Return to the call in ${NAME_SHOWN}`,
  ar: `العودة إلى المكالمة في ⁨${NAME_SHOWN}⁩`,
};

/** `text` holds `shown` and no control character but a translation's isolates. */
const expectShown = (text: string | null, shown: string) => {
  expect(text).toContain(shown);
  expect((text ?? '').replace(TRANSLATION_ISOLATES, '')).not.toMatch(CONTROL);
};

const check = async (page: Page, lang: 'en' | 'ar', label: string, desktop: boolean) => {
  await page.goto(`/e2e/fixtures/call-panel-names.html?lang=${lang}`);
  await page.locator('body[data-fixture-ready]').waitFor({ state: 'attached' });
  await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');

  // The call panel: its heading, its own name and the name of its controls.
  const panel = page.getByTestId('call-panel');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  expectShown(await panel.locator('h2').textContent(), NAME_SHOWN);
  expect(await panel.getAttribute('aria-label')).toBe(NAME_SHOWN);
  expect(await panel.getByRole('toolbar').getAttribute('aria-label')).toBe(NAME_SHOWN);

  // The rail's call tab: its label, and the tooltip a pointer brings up.
  const tab = page.locator('[data-call-tab]');
  await expect(tab).toBeVisible();
  const tabLabel = await tab.getAttribute('aria-label');
  expectShown(tabLabel, NAME_SHOWN);
  expect(tabLabel).toBe(RETURN_TO_CALL[lang]);
  if (desktop) {
    await tab.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeVisible();
    expectShown(await tooltip.textContent(), NAME_SHOWN);
  }
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${label}-${lang}.png` });
  }
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  for (const [viewport, options] of [
    ['phone', PHONE],
    ['desktop', DESKTOP],
  ] as const) {
    const context = await browser.newContext({ ...options, baseURL });
    try {
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
      for (const lang of ['en', 'ar'] as const)
        await check(page, lang, `${engine}-${viewport}`, viewport === 'desktop');
      expect(pageErrors, `uncaught errors in ${engine} ${viewport}`).toEqual([]);
    } finally {
      await context.close();
    }
  }
};

test('the call tab and the call panel show direction controls as code points (Chromium)', async ({
  browser,
  baseURL,
}) => {
  await run(browser, baseURL, 'chromium');
});

test('the call tab and the call panel show direction controls as code points (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
