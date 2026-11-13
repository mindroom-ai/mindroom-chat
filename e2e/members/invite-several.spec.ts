import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { loginToMatrix, matrixFetch } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// The invite dialog stays open after an invitation, so a person can invite several people in a
// row; it says who was invited and clears the field for the next one. Runs in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against the homeserver of
// `just hs-up` or of an e2e slot.
const PASSWORD = 'invite-several-spec-password';
const RUN = Date.now().toString(36);
const VIEWPORT = { width: 1280, height: 800 };

// AGENT_UI_SHOTS=<directory> also saves screenshots of the result.
const shot = async (page: Page, name: string) => {
  if (process.env.AGENT_UI_SHOTS)
    await page.screenshot({ path: `${process.env.AGENT_UI_SHOTS}/${name}.png` });
};

test.use({
  viewport: VIEWPORT,
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const register = async (name: string) => {
  const username = `invs_${name}_${RUN}`;
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

const inviteTwoInOneDialog = async (page: Page, name: string) => {
  const host = await register(`${name}h`);
  const first = await register(`${name}a`);
  const second = await register(`${name}b`);
  const roomId = await createRoom(HOMESERVER, host.accessToken, {
    name: `Crew room ${name} ${RUN}`,
  });
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: host.username,
    password: PASSWORD,
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  await page.getByRole('button', { name: 'Invite people' }).click({ timeout: 60_000 });
  const dialog = page.getByRole('dialog', { name: 'Invite' });
  await expect(dialog).toBeVisible();
  const field = dialog.getByRole('combobox');

  const invite = async (userId: string) => {
    await field.fill(userId);
    // Enter submits the typed ID; a click on Invite can miss while directory suggestions open.
    await field.press('Enter');
    await expect(dialog.getByRole('status')).toContainText(userId, { timeout: 15_000 });
  };
  await invite(first.userId);
  // Still open, with an empty field that has the focus for the next person.
  await expect(dialog).toBeVisible();
  await expect(field).toHaveValue('');
  await expect(field).toBeFocused();
  await invite(second.userId);
  await shot(page, `invite-several-${name}`);
  await expect(dialog).toBeVisible();

  const { chunk } = await matrixFetch<{
    chunk: { state_key: string; content: { membership: string } }[];
  }>(HOMESERVER, `/rooms/${encodeURIComponent(roomId)}/members?membership=invite`, {
    accessToken: host.accessToken,
  });
  expect(chunk.map((event) => event.state_key).sort()).toEqual(
    [first.userId, second.userId].sort()
  );

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const TITLE = 'the invite dialog stays open to invite several people';

test(`${TITLE} (Chromium)`, async ({ page }) => {
  test.setTimeout(180_000);
  await inviteTwoInOneDialog(page, 'c');
});

test(`${TITLE} (WebKit)`, async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, baseURL });
    await inviteTwoInOneDialog(await context.newPage(), 'w');
  } finally {
    await browser.close();
  }
});
