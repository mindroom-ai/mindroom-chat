import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { buildLoginPath } from '../env';
import {
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';

// Keyboard and screen reader basics against the disposable homeserver of `just hs-up` (or a slot
// of scripts/e2e-slot.sh): the skip link and landmarks, focus that menus and dialogs take and
// give back, the command palette shortcut, the live log of new messages, and axe-core over the
// main screens. One account signs in once; the tests share its page.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'a11y-spec-password';
const RUN = Date.now().toString(36);
const ROOM_NAME = `Keyboard Lab ${RUN}`;
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

// A loaded machine can take minutes to start the client; the signed-in shell is the signal.
const STARTUP_MS = 180_000;
const accountButton = (page: Page) => page.getByRole('button', { name: /^Open settings for / });

/** Opens a signed-in route and waits for the shell, which reloads the client. */
const gotoSignedIn = async (page: Page, route: string) => {
  await page.goto(route);
  await expect(accountButton(page)).toBeVisible({ timeout: STARTUP_MS });
};

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
 * leaves out its visible text. Matched by rule and element, so any other finding still fails.
 */
const KNOWN_PORTED_FINDINGS = [
  // KeyBackupNudge: its "Set up backup" button reads as "Set up secure key backup".
  /^label-content-name-mismatch: <button [^>]*aria-label="Set up secure key backup"/,
  // CompactThreadCard: a thread card's label summarizes the thread instead of repeating its text.
  // Matched by its attributes: production builds shorten the class names the dev server spells out.
  /^label-content-name-mismatch: <button [^>]*data-thread-root-id="[^"]*"[^>]*aria-label="Open thread: /,
];
const isKnownPortedFinding = (finding: string) =>
  KNOWN_PORTED_FINDINGS.some((pattern) => pattern.test(finding));

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

test.describe.serial('keyboard and accessibility', () => {
  test.describe.configure({ timeout: 2 * STARTUP_MS });
  let page: Page;
  let guest: MatrixSession & { username: string };
  let roomId: string;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
    test.setTimeout(2 * STARTUP_MS);
    const owner = await register('owner');
    guest = await register('guest');
    roomId = await createPrivateRoom(HOMESERVER, owner.accessToken, {
      name: ROOM_NAME,
      topic: 'Where the keyboard gets tried',
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
    await expect(page.getByRole('button', { name: 'Mark as Read' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Mark as Read' })).toHaveCount(0);
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

  test('the settings dialog is a named modal that gives focus back when it closes', async () => {
    const account = accountButton(page);
    await account.focus();
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
    await page.keyboard.press('ControlOrMeta+k');
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
    // The sync banners share one polite region that stays mounted.
    await expect(page.locator('[role="status"][aria-live="polite"]').first()).toBeAttached();
  });

  test('the main screens have no critical or serious axe-core findings', async () => {
    test.skip(!fs.existsSync(AXE_PATH), 'axe-core is not installed');
    const findings: string[] = [];
    const check = async (screen: string) => {
      const found = (await axeFindings(page)).filter((finding) => !isKnownPortedFinding(finding));
      findings.push(...found.map((finding) => `${screen} ${finding}`));
    };

    await gotoSignedIn(page, '/home/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await check('home');
    await openRoom(page);
    await check('room');
    await gotoSignedIn(page, '/home/create/');
    await expect(page.getByRole('textbox', { name: 'Name' })).toBeVisible();
    await check('create room');
    await accountButton(page).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await check('settings');

    expect(findings).toEqual([]);
  });
});
