import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { buildLoginPath } from '../env';
import { standInVisualViewport } from '../helpers/keyboardViewport';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// The sign-in form on a phone with the keyboard up. After the password is typed, the Login button
// shows above the keyboard and the password field stays in view (in the iOS app the button sat
// under the keyboard, and only Return could sign in): both when the page itself gets shorter (the
// iOS app's web view, Chrome on Android) and when the page keeps its height and only the visual
// viewport shrinks (Safari on iOS, played here by a stand-in visualViewport). On a phone (390 by
// 844, touch), in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in
// WebKit. Set LOGIN_KEYBOARD_SHOTS=<directory> for screenshots.
const SHOTS = process.env.LOGIN_KEYBOARD_SHOTS;

const PHONE_SIZE = { width: 390, height: 844 };
const PHONE: BrowserContextOptions = { viewport: PHONE_SIZE, hasTouch: true, isMobile: true };
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1';
// The visible height an iPhone's keyboard leaves in portrait.
const KEYBOARD_VISIBLE = 508;

test.use({ video: 'off' });

type Keyboard = 'resizing' | 'Safari';

const username = (page: Page) => page.locator('input[name="usernameInput"]');
const password = (page: Page) => page.locator('input[name="passwordInput"]');

/** The iOS app and Chrome on Android shrink the page; Safari shrinks only the visual viewport. */
const raiseKeyboard = async (page: Page, keyboard: Keyboard) => {
  if (keyboard === 'resizing') {
    await page.setViewportSize({ width: PHONE_SIZE.width, height: KEYBOARD_VISIBLE });
    return;
  }
  await page.evaluate((visible) => {
    window.__setKeyboardViewport?.(visible, 0, 'resize');
  }, KEYBOARD_VISIBLE);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.style.getPropertyValue('--app-height'))
    )
    .toBe(`${KEYBOARD_VISIBLE}px`);
};

/** Where the Login button and the password field sit against the space above the keyboard. */
const readForm = (page: Page) =>
  page.evaluate((visible) => {
    const submit = document.querySelector('form button[type="submit"]');
    const field = document.querySelector('input[name="passwordInput"]');
    if (!submit || !field) return undefined;
    const button = submit.getBoundingClientRect();
    const input = field.getBoundingClientRect();
    const hit = document.elementFromPoint(
      button.left + button.width / 2,
      button.top + button.height / 2
    );
    return {
      buttonAboveKeyboard: button.bottom <= visible,
      buttonTakesTaps: !!hit && submit.contains(hit),
      fieldInView: input.top >= 0 && input.bottom <= visible,
      buttonBottom: Math.round(button.bottom),
      fieldTop: Math.round(input.top),
    };
  }, KEYBOARD_VISIBLE);

const checkLoginAboveKeyboard = async (
  browser: Browser,
  options: BrowserContextOptions,
  keyboard: Keyboard,
  engine: string
) => {
  const context = await browser.newContext({
    ...PHONE,
    ...options,
    baseURL: test.info().project.use.baseURL,
  });
  try {
    if (keyboard === 'Safari') await standInVisualViewport(context);
    const page = await context.newPage();
    await page.goto(buildLoginPath(HOMESERVER));
    await expect(password(page)).toBeVisible({ timeout: 30_000 });

    await username(page).tap();
    await raiseKeyboard(page, keyboard);
    await page.keyboard.type('phone-reader');
    await password(page).tap();
    await page.keyboard.type('a password typed on a phone');
    await expect(password(page)).toBeFocused();

    await expect
      .poll(() => readForm(page), {
        message: `${engine}, ${keyboard} keyboard: Login above the keyboard, password in view`,
      })
      .toMatchObject({ buttonAboveKeyboard: true, buttonTakesTaps: true, fieldInView: true });
    if (SHOTS) {
      await page.screenshot({
        path: `${SHOTS}/login-keyboard-${engine.toLowerCase()}-${keyboard.toLowerCase()}.png`,
      });
    }
  } finally {
    await context.close();
  }
};

test.describe('the Login button above a phone keyboard', () => {
  test.beforeEach(async () => {
    test.skip(
      !(await disposableHomeserverIsUp()),
      `No test homeserver at ${HOMESERVER} (just hs-up)`
    );
  });

  for (const keyboard of ['resizing', 'Safari'] as const) {
    test(`Chromium, ${keyboard} keyboard`, async ({ browser }) => {
      await checkLoginAboveKeyboard(browser, {}, keyboard, 'Chromium');
    });

    test(`WebKit, ${keyboard} keyboard`, async () => {
      test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE not set');
      const browser = await launchWebKit();
      try {
        await checkLoginAboveKeyboard(browser, { userAgent: IPHONE_SAFARI }, keyboard, 'WebKit');
      } finally {
        await browser.close();
      }
    });
  }
});
