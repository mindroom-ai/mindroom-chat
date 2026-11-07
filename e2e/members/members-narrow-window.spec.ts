import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { loginToMatrix, matrixFetch } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// With the members open beside a room, a window that narrows until they no longer fit beside it
// (a phone, or a tablet whose room is too narrow) closes them, as the original app does on a
// phone. The closing panel must not lie over the room as the members dialog on its way out, nor
// trap the focus there: the reader keeps the focus where it was. Runs in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against the homeserver of
// `just hs-up` or of an e2e slot.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'members-narrow-window-spec-password';
const RUN = Date.now().toString(36);
const DESKTOP = { width: 1280, height: 800 };

// MEMBERS_NARROW_SHOTS=<directory> also saves screenshots right after each narrowing.
const shot = async (page: Page, name: string) => {
  if (process.env.MEMBERS_NARROW_SHOTS)
    await page.screenshot({ path: `${process.env.MEMBERS_NARROW_SHOTS}/${name}.png` });
};

test.use({
  viewport: DESKTOP,
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
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

let accounts = 0;

const register = async (name: string) => {
  // Numbered, so that --repeat-each runs register new accounts.
  accounts += 1;
  const username = `mnw_${name}${accounts}_${RUN}`;
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

/** From now on, the page notes every focus move and every members dialog that appears. */
const watchFocusAndDialogs = (page: Page) =>
  page.evaluate(() => {
    const log: string[] = [];
    (window as Window & { membersNarrowLog?: string[] }).membersNarrowLog = log;
    document.addEventListener(
      'focusin',
      (event) => {
        const target = event.target as Element;
        const name = target.getAttribute('aria-label') ?? target.textContent?.trim().slice(0, 30);
        log.push(`focus ${target.tagName} "${name ?? ''}"`);
      },
      true
    );
    const dialogs = new MutationObserver(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="Members"]');
      if (dialog && !log.includes('members dialog')) log.push('members dialog');
    });
    dialogs.observe(document.body, { childList: true, subtree: true });
  });

const watched = (page: Page) =>
  page.evaluate(() => (window as Window & { membersNarrowLog?: string[] }).membersNarrowLog);

const narrowWithMembersOpen = async (page: Page, name: string) => {
  const reader = await register(`${name}r`);
  const other = await register(`${name}o`);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: `Harbor log ${name} ${RUN}`,
    invite: [other.userId],
  });
  await matrixFetch(HOMESERVER, `/join/${encodeURIComponent(roomId)}`, {
    method: 'POST',
    accessToken: other.accessToken,
    body: '{}',
  });
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);

  const panel = page.getByTestId('resizable-members-panel');
  const composer = page.getByRole('textbox', { name: 'Send a message...' });
  const showMembers = page.getByRole('button', { name: 'Show Members', exact: true });

  const openMembersBeside = async () => {
    await expect(composer).toBeVisible({ timeout: 60_000 });
    // Members open beside a wide room by default; open them if an earlier step closed them.
    if (await showMembers.isVisible()) await showMembers.click();
    await expect(panel).toBeVisible();
    await expect(page.getByRole('button', { name: 'Invite people' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Members', exact: true })).toHaveCount(0);
  };

  const narrowTo = async (viewport: { width: number; height: number }, label: string) => {
    // The reader is writing a message when the window narrows.
    await composer.click();
    await expect(composer).toBeFocused();
    await watchFocusAndDialogs(page);
    await page.setViewportSize(viewport);
    await shot(page, `${name}-${label}`);
    await expect(panel).toHaveCount(0);
    expect(await watched(page), `focus moves and dialogs (${label})`).toEqual([]);
    await expect(composer).toBeFocused();
  };

  // A phone: the members close, and the room keeps the reader's focus.
  await openMembersBeside();
  await narrowTo({ width: 390, height: 844 }, 'phone');

  // Wide again: the saved choice brings the members back beside the room.
  await page.setViewportSize(DESKTOP);
  await expect(panel).toBeVisible();

  // A tablet whose room is too narrow for the members beside it: they close the same way.
  await openMembersBeside();
  await narrowTo({ width: 800, height: 800 }, 'tablet');
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const TITLE =
  'members open beside a room close without a dialog or a focus move when the window narrows';

test(`${TITLE} (Chromium)`, async ({ page }) => {
  test.setTimeout(180_000);
  await narrowWithMembersOpen(page, 'c');
});

test(`${TITLE} (WebKit)`, async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({ viewport: DESKTOP, baseURL });
    await narrowWithMembersOpen(await context.newPage(), 'w');
  } finally {
    await browser.close();
  }
});
