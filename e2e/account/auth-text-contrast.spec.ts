import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { contrastRatio, sampleScreenshot, type Rgba } from '../helpers/glassVisual';
import { matrixFetch } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// The small text of the sign-in screen (the card's notes and the credits under it) and of the
// "Connecting to server" screen (its line and the app name; the loading screen has the same) keeps at least
// 4.5:1 against what is drawn behind it, the particle art included (3:1 for large text). Each text
// is hidden, the screen behind it sampled three times as the particles move, and the text's color
// compared with every sample. Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's
// WebKit, WebKit; dark and light themes, desktop and phone. Set AUTH_CONTRAST_SHOTS=<directory>
// to also save the screens.
const PASSWORD = 'auth-text-contrast-spec-password';
const SHOTS = process.env.AUTH_CONTRAST_SHOTS;
const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const THEMES = ['dark-theme', 'light-theme'];

test.use({
  // Requests to the homeserver must reach page.route, not a service worker.
  serviceWorkers: 'block',
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

type Probe = {
  text: string;
  large: boolean;
  color: Rgba;
  box: { x: number; y: number; width: number; height: number };
};

/**
 * Marks every visible text of the screen (its own text nodes, outside buttons and fields, which
 * draw their own fill) and returns its color, with the opacity of it and its ancestors, and box.
 */
const findTexts = (page: Page) =>
  page.evaluate((): Probe[] => {
    const probes: Probe[] = [];
    let index = 0;
    for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
      const own = [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== ''
      );
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const onScreen =
        box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
      if (!own || box.width === 0 || !onScreen || style.visibility !== 'visible') continue;
      if (element.closest('button, input, select, textarea, [role="status"] svg')) continue;
      let opacity = 1;
      for (let node: HTMLElement | null = element; node; node = node.parentElement) {
        opacity *= Number(getComputedStyle(node).opacity);
      }
      const numbers = style.color.match(/[\d.]+/g)!.map(Number);
      const srgb = style.color.startsWith('color(');
      const rgb = numbers.slice(0, 3).map((value) => (srgb ? value * 255 : value));
      let alpha = 1;
      if (style.color.includes('/')) alpha = numbers[numbers.length - 1]!;
      else if (style.color.startsWith('rgba')) alpha = numbers[3]!;
      const size = parseFloat(style.fontSize);
      element.setAttribute('data-contrast-probe', String(index));
      index += 1;
      probes.push({
        text: element.textContent!.trim().slice(0, 60),
        large: size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700),
        color: [rgb[0]!, rgb[1]!, rgb[2]!, alpha * opacity],
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
      });
    }
    return probes;
  });

/** The lowest contrast of each text against the screen behind it, over three moments. */
const measureTexts = async (page: Page) => {
  const probes = await findTexts(page);
  const points = probes.flatMap(({ box }, probe) => {
    const list: Array<{ x: number; y: number; probe: number }> = [];
    for (let y = box.y + 1; y < box.y + box.height - 1; y += 3) {
      for (let x = box.x + 1; x < box.x + box.width - 1; x += 3) list.push({ x, y, probe });
    }
    return list;
  });
  const hide = await page.addStyleTag({
    content: '[data-contrast-probe] { color: transparent !important; }',
  });
  const lowest = probes.map(() => Infinity);
  try {
    for (let moment = 0; moment < 3; moment += 1) {
      // eslint-disable-next-line no-await-in-loop -- the particles move between samples.
      const pixels = await sampleScreenshot(page, points);
      pixels.forEach((pixel, index) => {
        const { probe } = points[index]!;
        lowest[probe] = Math.min(lowest[probe]!, contrastRatio(probes[probe]!.color, pixel));
      });
      // eslint-disable-next-line no-await-in-loop -- as above.
      await page.waitForTimeout(300);
    }
  } finally {
    await hide.evaluate((element) => (element as HTMLStyleElement).remove());
  }
  return probes.map(({ text, large }, probe) => ({
    text,
    large,
    contrast: Math.round(lowest[probe]! * 100) / 100,
  }));
};

const setTheme = (page: Page, themeId: string) =>
  page.evaluate((id) => {
    const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
    localStorage.setItem(
      'settings',
      JSON.stringify({ ...settings, useSystemTheme: false, themeId: id })
    );
  }, themeId);

type StoredDatabases = { indexedDB?: Array<{ name: string }> };

type Measured = Record<string, Array<{ text: string; large: boolean; contrast: number }>>;

/** The origin `page` was opened at, for a new context of the same app. */
const baseURLOf = (page: Page) => new URL(page.url()).origin;

const record = async (page: Page, measured: Measured, name: string, browser: string) => {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(600);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${browser}-${name}.png` });
  measured[name] = await measureTexts(page);
};

/** The sign-in screen, then the connecting screen of a signed-in account. */
const checkScreens = async (page: Page, prefix: string, testInfo: TestInfo, browser: string) => {
  const username = `${prefix}_${Date.now().toString(36)}`;
  await matrixFetch(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });
  const measured: Measured = {};
  try {
    await page.goto('/');
    for (const [sizeName, size] of Object.entries(SIZES)) {
      for (const theme of THEMES) {
        /* eslint-disable no-await-in-loop -- one screen after the other on one page. */
        await page.setViewportSize(size);
        await setTheme(page, theme);
        await page.goto(`/login/${encodeURIComponent(HOMESERVER)}`);
        await expect(page.locator('input[name="usernameInput"]')).toBeVisible();
        await record(page, measured, `sign-in-${sizeName}-${theme}`, browser);
        /* eslint-enable no-await-in-loop */
      }
    }

    await page.setViewportSize(SIZES.desktop);
    await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
    // Each look starts in a new context with the session and its encryption storage but none of
    // its stored rooms or /versions answer, so the client waits for /versions, which never comes.
    const state = await page.context().storageState({ indexedDB: true });
    const session = {
      ...state,
      // The installed type definitions predate storageState's `indexedDB` list.
      origins: state.origins.map((origin) => {
        const stored = origin as typeof origin & StoredDatabases;
        return {
          ...stored,
          indexedDB: stored.indexedDB?.filter(
            ({ name }) => !/mindroom-(cache|room|thread)/.test(name)
          ),
        };
      }),
    };
    for (const [sizeName, size] of Object.entries(SIZES)) {
      for (const theme of THEMES) {
        /* eslint-disable no-await-in-loop -- one screen after the other. */
        const context = await page
          .context()
          .browser()!
          .newContext({
            baseURL: baseURLOf(page),
            viewport: size,
            serviceWorkers: 'block',
            storageState: session,
          });
        try {
          await context.addInitScript((id) => {
            Object.keys(localStorage)
              .filter((key) => key.startsWith('mindroom_client_spec_versions::'))
              .forEach((key) => localStorage.removeItem(key));
            const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
            localStorage.setItem(
              'settings',
              JSON.stringify({ ...settings, useSystemTheme: false, themeId: id })
            );
          }, theme);
          await context.route('**/_matrix/client/versions', () => undefined);
          const fresh = await context.newPage();
          await fresh.goto('/home/');
          await expect(fresh.getByText('Connecting to server')).toBeVisible();
          await record(fresh, measured, `connecting-${sizeName}-${theme}`, browser);
        } finally {
          await context.close();
        }
        /* eslint-enable no-await-in-loop */
      }
    }
  } finally {
    await testInfo.attach('contrast.json', { body: JSON.stringify(measured, null, 2) });
  }
  for (const [screen, texts] of Object.entries(measured)) {
    expect(texts.length, screen).toBeGreaterThan(0);
    for (const { text, large, contrast } of texts) {
      expect.soft(contrast, `${screen}: ${text}`).toBeGreaterThanOrEqual(large ? 3 : 4.5);
    }
  }
};

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

test('small text on the sign-in and startup screens stands out from the art', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await checkScreens(page, 'auth_contrast', testInfo, 'chromium');
});

test('small text on the sign-in and startup screens stands out from the art (WebKit)', async ({
  baseURL,
}, testInfo) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({
      viewport: SIZES.desktop,
      baseURL,
      serviceWorkers: 'block',
    });
    await checkScreens(await context.newPage(), 'auth_contrast_webkit', testInfo, 'webkit');
  } finally {
    await browser.close();
  }
});
