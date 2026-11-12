import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { buildLoginPath } from '../env';
import {
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { pressPaletteShortcut } from '../helpers/paletteShortcut';

// Keyboard and screen reader basics against the disposable homeserver of `just hs-up` (or a slot
// of scripts/e2e-slot.sh): the skip link and landmarks, focus that menus and dialogs take and
// give back, the command palette shortcut, the live log of new messages, and axe-core over the
// main screens in English, in Arabic (where the chrome mirrors) and in the dark theme. One account
// signs in once; the tests share its page.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'a11y-spec-password';
const RUN = Date.now().toString(36);
const ROOM_NAME = `Keyboard Lab ${RUN}`;
const ROOM_TOPIC = 'Where the keyboard gets tried';
const THREAD_ROOM_NAME = `Release Desk ${RUN}`;
const THREAD_ROOT = 'Is the release checklist done?';
const THREAD_REPLY = 'Every item on the checklist is ticked.';
// axe-core comes with eslint-plugin-jsx-a11y; the axe test is skipped if it is ever gone.
const AXE_PATH = path.join(process.cwd(), 'node_modules/axe-core/axe.min.js');

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

const register = async (name: string): Promise<MatrixSession & { username: string }> => {
  const username = `a11y_${name}_${RUN}`;
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  expect(response.ok, `registering ${username}`).toBe(true);
  return { ...(await loginToMatrix(HOMESERVER, username, PASSWORD)), username };
};

// The app's message catalogs (src/app/i18n/locales/<code>.json and its additions), flattened, so the
// passes in other languages find controls by the names they have there. A key a language lacks
// falls back to English, as in the app.
type Catalog = Map<string, string>;
const flatten = (tree: Record<string, unknown>, prefix = ''): [string, string][] =>
  Object.entries(tree).flatMap(([key, value]): [string, string][] => {
    const name = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string'
      ? [[name, value]]
      : flatten(value as Record<string, unknown>, name);
  });
const catalogs = new Map<string, Catalog>();
const catalog = (code: string): Catalog => {
  const cached = catalogs.get(code);
  if (cached) return cached;
  const locales = path.join(process.cwd(), 'src/app/i18n/locales');
  const loaded: Catalog = new Map(
    [path.join(locales, `${code}.json`), path.join(locales, 'additions', `${code}.json`)]
      .filter((file) => fs.existsSync(file))
      .flatMap((file) =>
        flatten(JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>)
      )
  );
  catalogs.set(code, loaded);
  return loaded;
};
const label = (code: string, key: string): string => {
  const text = catalog(code).get(key) ?? catalog('en').get(key);
  if (text === undefined) throw new Error(`No message ${key}`);
  return text;
};
/**
 * The text of a message before its first `{{value}}`, without the spaces and bidirectional
 * isolates in front of the value (axe-core shortens long attributes there).
 */
const textBefore = (text: string) =>
  (text.split('{{')[0] ?? text).replace(/[\s\u2066-\u2069]+$/u, '');
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A loaded machine can take minutes to start the client; the signed-in shell is the signal.
const STARTUP_MS = 180_000;
const accountButton = (page: Page, code = 'en') =>
  page.getByRole('button', {
    name: new RegExp(`^${escapeRegExp(textBefore(label(code, 'featureUi.accountMenu.open')))}`),
  });

/** Opens a signed-in route and waits for the shell, which reloads the client. */
const gotoSignedIn = async (page: Page, route: string, code = 'en') => {
  await page.goto(route);
  await expect(accountButton(page, code)).toBeVisible({ timeout: STARTUP_MS });
};

/** Opens a route inside the running app, without reloading the client. */
const openInApp = (page: Page, route: string) =>
  page.evaluate((to) => {
    window.history.pushState(null, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);

/** Writes the stored language and theme, which the app reads when it starts. */
const storeLook = (page: Page, code: string, themeId: string) =>
  page.evaluate(
    ([language, theme]) => {
      localStorage.setItem('i18nextLng', language);
      const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
      localStorage.setItem(
        'settings',
        JSON.stringify({ ...settings, useSystemTheme: false, themeId: theme })
      );
    },
    [code, themeId] as const
  );

const signIn = async (page: Page, username: string) => {
  await page.goto(buildLoginPath(HOMESERVER));
  await page.locator('input[name="usernameInput"]').fill(username, { timeout: STARTUP_MS });
  await page.locator('input[name="passwordInput"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(accountButton(page)).toBeVisible({ timeout: STARTUP_MS });
};

/** Describes the focused element, for assertions that read well in a failure. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return 'body';
    const name =
      element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 40) ?? '';
    return `${element.tagName.toLowerCase()} ${name}`;
  });

const openRoom = async (page: Page) => {
  await page
    .getByRole('navigation', { name: 'Home' })
    .getByRole('link', { name: ROOM_NAME })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: ROOM_NAME })).toBeVisible();
};

/**
 * Findings in ported (Lane P) code, which may not be rewritten here: each control's `aria-label`
 * leaves out its visible text. Matched by rule and element, with the label in the page's
 * language, so any other finding still fails.
 */
const knownPortedFindings = (code: string) => [
  // CompactThreadCard: a thread card's label summarizes the thread instead of repeating its text.
  // Matched by its attributes: production builds shorten the class names the dev server spells out,
  // and axe-core cuts a long element short, sometimes before the label (an Arabic label with a
  // full event ID in front of it), so the label is matched only when it is there.
  new RegExp(
    `^label-content-name-mismatch: <button [^>]*data-thread-root-id="[^"]*"(?:[^>]*aria-label="${escapeRegExp(
      textBefore(label(code, 'thread.aria.openThread'))
    )}| [^>]*\\.\\.\\.>$)`
  ),
];

/** Critical and serious axe-core findings on the page, as `rule: element` lines. */
const axeFindings = async (page: Page): Promise<string[]> => {
  await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async () => {
    type AxeResult = {
      violations: {
        id: string;
        impact: string | null;
        nodes: { target: string[]; html: string }[];
      }[];
    };
    const { axe } = window as unknown as {
      axe: { run: (context: Document) => Promise<AxeResult> };
    };
    const result = await axe.run(document);
    return result.violations
      .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
      .flatMap((violation) =>
        violation.nodes.map((node) => `${violation.id}: ${node.html.slice(0, 300)}`)
      );
  });
};

/** Horizontal paddings of an element, in pixels. */
const sidePaddings = (locator: Locator) =>
  locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight) };
  });

/**
 * How far the first element inside `outer` that matches `selector` sits from the inside of the
 * left and right borders of `outer`, in whole pixels. Measures an element that is hidden but laid
 * out too, such as an inset scrollbar with nothing to scroll.
 */
const insetWithin = (outer: Locator, selector: string) =>
  outer.evaluate((frame, innerSelector) => {
    const inner = frame.querySelector(innerSelector);
    if (!inner) throw new Error(`No ${innerSelector}`);
    const box = inner.getBoundingClientRect();
    const edges = frame.getBoundingClientRect();
    const style = getComputedStyle(frame);
    return {
      left: Math.round(box.left - edges.left - parseFloat(style.borderLeftWidth)),
      right: Math.round(edges.right - parseFloat(style.borderRightWidth) - box.right),
    };
  }, selector);

test.describe.serial('keyboard and accessibility', () => {
  test.describe.configure({ timeout: 3 * STARTUP_MS });
  let page: Page;
  let guest: MatrixSession & { username: string };
  let roomId: string;
  let threadRoomId: string;
  let threadRootId: string;

  /**
   * axe-core over the main screens in the page's language: home, a room beside its members, a
   * thread, Activity, message search, the account menu and the settings dialog. Each opens
   * inside the running app; the findings come back as `screen rule: element` lines.
   */
  const axeMainScreens = async (code: string): Promise<string[]> => {
    const known = knownPortedFindings(code);
    const findings: string[] = [];
    const check = async (screen: string) => {
      const found = (await axeFindings(page)).filter(
        (finding) => !known.some((pattern) => pattern.test(finding))
      );
      findings.push(...found.map((finding) => `${screen} ${finding}`));
    };

    await openInApp(page, '/home/');
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
    await check('home');
    await openInApp(page, `/home/${encodeURIComponent(roomId)}/`);
    await expect(page.getByRole('heading', { level: 1, name: ROOM_NAME })).toBeVisible();
    // A wide screen lists the room's members beside it. The owner may invite, so their search
    // also invites.
    await expect(
      page.getByRole('textbox', {
        name: label(code, 'featureUi.room.membersDrawer.searchOrInvite'),
      })
    ).toBeVisible();
    await check('room and members');
    await openInApp(
      page,
      `/home/${encodeURIComponent(threadRoomId)}/?threadId=${encodeURIComponent(threadRootId)}`
    );
    await expect(page.getByText(THREAD_REPLY)).toBeVisible();
    await check('thread');
    await openInApp(page, '/activity/');
    await expect(
      page.getByRole('heading', { level: 1, name: label(code, 'activity.pickTitle') })
    ).toBeVisible();
    await expect(page.locator('[data-activity-list="page"]')).toBeVisible();
    await check('activity');
    await openInApp(page, '/home/search/?term=checklist');
    await expect(page.getByRole('main').getByText(THREAD_ROOT)).toBeVisible({ timeout: 30_000 });
    await check('search');
    await accountButton(page, code).click();
    const settingsEntry = page.getByRole('menuitem', {
      name: label(code, 'settings.title'),
      exact: true,
    });
    await expect(settingsEntry).toBeVisible();
    await check('account menu');
    await settingsEntry.click();
    const settings = page.getByRole('dialog', { name: label(code, 'settings.title') });
    await expect(settings).toBeVisible();
    await check('settings');
    await page.keyboard.press('Escape');
    await expect(settings).toHaveCount(0);
    return findings;
  };

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
    test.setTimeout(2 * STARTUP_MS);
    const owner = await register('owner');
    guest = await register('guest');
    roomId = await createPrivateRoom(HOMESERVER, owner.accessToken, {
      name: ROOM_NAME,
      topic: ROOM_TOPIC,
      invite: [guest.userId],
    });
    await joinRoom(HOMESERVER, guest.accessToken, roomId);
    await sendRoomMessage(
      HOMESERVER,
      guest.accessToken,
      roomId,
      { msgtype: 'm.text', body: 'First message' },
      'a11y-spec'
    );
    // A second room holds a thread the two accounts wrote, which the passes below open.
    threadRoomId = await createPrivateRoom(HOMESERVER, owner.accessToken, {
      name: THREAD_ROOM_NAME,
      topic: 'Ship it when the list is done',
      invite: [guest.userId],
    });
    await joinRoom(HOMESERVER, guest.accessToken, threadRoomId);
    threadRootId = await sendRoomMessage(
      HOMESERVER,
      owner.accessToken,
      threadRoomId,
      { msgtype: 'm.text', body: THREAD_ROOT },
      'a11y-spec'
    );
    await sendRoomMessage(
      HOMESERVER,
      guest.accessToken,
      threadRoomId,
      {
        msgtype: 'm.text',
        body: THREAD_REPLY,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: threadRootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: threadRootId },
        },
      },
      'a11y-spec'
    );
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await signIn(page, owner.username);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('the first Tab reaches a skip link that jumps to the page title', async () => {
    await gotoSignedIn(page, '/home/');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Home' })).toBeVisible();
    await expect(page.getByRole('main')).toHaveCount(1);

    await page.locator('body').focus();
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();

    await page.keyboard.press('Enter');
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeFocused();
  });

  test('a menu opened with Enter takes focus, and Escape gives it back to its button', async () => {
    const homeOptions = page.getByRole('button', { name: 'Home Options', exact: true });
    await homeOptions.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Mark as Read' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: 'Mark as Read' })).toHaveCount(0);
    await expect(homeOptions).toBeFocused();

    await openRoom(page);
    const roomOptions = page
      .getByRole('main')
      .getByRole('button', { name: 'More Options', exact: true })
      .first();
    await roomOptions.focus();
    await page.keyboard.press('Enter');
    // The menu takes focus once it has rendered, a frame or more after the key.
    await expect.poll(() => focused(page)).not.toContain('More Options');
    await page.keyboard.press('Escape');
    await expect(roomOptions).toBeFocused();
  });

  test("the members panel's resize handle shows its line while it has keyboard focus", async () => {
    await openRoom(page);
    const handle = page.getByRole('separator', { name: 'Resize member panel' });
    await expect(handle).toBeVisible();
    const line = () =>
      handle.evaluate((element) => getComputedStyle(element, '::after').backgroundColor);
    // Away from the pointer and the keyboard the floating layout hides the line in the gap.
    await page.mouse.move(0, 0);
    const resting = await line();
    await handle.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(handle).toBeFocused();
    expect(await handle.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
    await expect.poll(line).not.toBe(resting);
    expect(await line()).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('the settings dialog is a named modal that gives focus back when it closes', async () => {
    const account = accountButton(page);
    await account.focus();
    await page.keyboard.press('Enter');
    // The account button opens its menu, whose first entry takes focus.
    const settings = page.getByRole('menuitem', { name: 'Settings', exact: true });
    await expect(settings).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByRole('navigation', { name: 'Settings' })).toBeVisible();
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(account).toBeFocused();
  });

  test('the command palette opens with its shortcut and closes with Escape', async () => {
    const composer = page.getByRole('textbox', { name: /message/i }).first();
    await composer.focus();
    await pressPaletteShortcut(page);
    const palette = page.getByRole('combobox', { name: 'Command palette' });
    await expect(palette).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);
    await expect(composer).toBeFocused();
  });

  test("a new message from someone else is read out from the room's log", async () => {
    await expect(page.getByRole('heading', { level: 1, name: ROOM_NAME })).toBeVisible();
    const log = page.getByRole('log');
    await expect(log).toHaveAttribute('aria-live', 'polite');
    await sendRoomMessage(
      HOMESERVER,
      guest.accessToken,
      roomId,
      { msgtype: 'm.text', body: 'The build is green again.' },
      'a11y-spec'
    );
    await expect(log).toContainText(`${guest.username}: The build is green again.`, {
      timeout: 20_000,
    });
    // How the connection is reads out from one polite region that stays mounted.
    await expect(page.locator('[role="status"][aria-live="polite"]').first()).toBeAttached();
  });

  test('the main screens have no critical or serious axe-core findings', async () => {
    test.skip(!fs.existsSync(AXE_PATH), 'axe-core is not installed');
    await gotoSignedIn(page, '/home/');
    const findings = await axeMainScreens('en');
    await openInApp(page, '/home/create/');
    await expect(page.getByRole('textbox', { name: 'Name' })).toBeVisible();
    const known = knownPortedFindings('en');
    findings.push(
      ...(await axeFindings(page))
        .filter((finding) => !known.some((pattern) => pattern.test(finding)))
        .map((finding) => `create room ${finding}`)
    );

    expect(findings).toEqual([]);
  });

  test('in Arabic the main screens mirror and have no critical or serious axe-core findings', async () => {
    test.skip(!fs.existsSync(AXE_PATH), 'axe-core is not installed');
    await storeLook(page, 'ar', 'light-theme');
    await gotoSignedIn(page, '/home/', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    expect(await axeMainScreens('ar')).toEqual([]);

    // The chrome is mirrored, not only its text: the navigation header keeps its title 12 px from
    // the start (the right) and its menu at the end (the left), 12 px in, where the rows end beside
    // the floating page card, and the list's inset scrollbar runs at the end edge, as a platform
    // scrollbar does in right-to-left languages.
    await openInApp(page, `/home/${encodeURIComponent(roomId)}/`);
    const homeNav = page.getByRole('navigation', { name: label('ar', 'nav.home') });
    const navHeader = homeNav.locator('header').first();
    expect(await sidePaddings(navHeader)).toEqual({ left: 12, right: 12 });
    const navHeaderBox = (await navHeader.boundingBox())!;
    const navMenuBox = (await navHeader.locator('button').last().boundingBox())!;
    expect(navMenuBox.x + navMenuBox.width / 2).toBeLessThan(
      navHeaderBox.x + navHeaderBox.width / 2
    );
    const navTrack = await insetWithin(homeNav, '[role="scrollbar"]');
    expect(navTrack.left).toBeLessThan(navTrack.right);
    // The room header puts its wider inset on the title side.
    const header = page.getByRole('banner').filter({ hasText: ROOM_NAME });
    expect(await sidePaddings(header)).toEqual({ left: 8, right: 16 });
    // A dialog's title bar: the title S400 from the start, the close button S200 from the end.
    await header.getByRole('button', { name: ROOM_TOPIC }).click();
    const topic = page.getByRole('dialog', { name: ROOM_NAME });
    expect(await sidePaddings(topic.locator('header').first())).toEqual({ left: 8, right: 16 });
    await page.keyboard.press('Escape');
    await expect(topic).toHaveCount(0);
    // Settings keep the close button the dialog's 12 px inset from its end edge, at the right in
    // English and at the left here.
    await accountButton(page, 'ar').click();
    await page.getByRole('menuitem', { name: label('ar', 'settings.title'), exact: true }).click();
    const settings = page.getByRole('dialog', { name: label('ar', 'settings.title') });
    await expect(settings).toBeVisible();
    const closeLabel = label('ar', 'featureUi.settings.emojisStickers.globalPacks.close');
    expect((await insetWithin(settings, `button[aria-label="${closeLabel}"]`)).left).toBe(12);
    await page.keyboard.press('Escape');
    await expect(settings).toHaveCount(0);
  });

  test('in the dark theme the main screens have no critical or serious axe-core findings', async () => {
    test.skip(!fs.existsSync(AXE_PATH), 'axe-core is not installed');
    await storeLook(page, 'en', 'dark-theme');
    await gotoSignedIn(page, '/home/');
    await expect(page.locator('body')).toHaveClass(/(^|\s)dark-theme(\s|$)/);
    expect(await axeMainScreens('en')).toEqual([]);
  });
});
