import { expect, test, type Page } from '@playwright/test';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import { matrixFetch } from '../helpers/matrix';

// Settings > About: Third-party notices opens public/licenses/THIRD_PARTY_NOTICES.txt, which the
// build writes from the production dependencies (scripts/third-party-notices.mjs), in the text
// viewer. Run it on a production build: scripts/e2e-slot.sh <n> --preview npx playwright test
// e2e/lane-c/about-notices.spec.ts (the dev server serves the same file).
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'about-notices-spec-password';
const NOTICES = '/public/licenses/THIRD_PARTY_NOTICES.txt';

test.use({
  viewport: { width: 1280, height: 800 },
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

/** A fresh account signed in on `page`, with Settings open on About. */
const openAbout = async (page: Page) => {
  const username = `about_${Date.now().toString(36)}`;
  await matrixFetch(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  await chooseFromAccountMenu(page, 'Settings');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('button', { name: 'About', exact: true })
    .click();
  return dialog;
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
});

test('the build serves the third-party notices as text, and About opens them', async ({ page }) => {
  const response = await page.request.get(NOTICES);
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('text/plain');
  const served = await response.text();
  expect(served.startsWith('Third-party notices\n')).toBe(true);
  // A runtime dependency with its declared license and license file; no development tool.
  expect(served).toContain('\nmatrix-js-sdk 41.7.0\nLicense: Apache-2.0\n');
  expect(served).toContain('\nFile LICENSE:\n');
  expect(served).not.toContain('\nvitest ');

  const dialog = await openAbout(page);
  await dialog.getByRole('button', { name: 'Third-party notices', exact: true }).click();
  const text = page.locator('pre code').filter({ hasText: 'matrix-js-sdk 41.7.0' });
  await expect(text).toBeVisible();
  expect(await text.textContent()).toBe(served);
  await expect(page.getByRole('button', { name: 'Copy All', exact: true })).toBeVisible();

  // Escape closes the viewer and leaves Settings open on About.
  await page.keyboard.press('Escape');
  await expect(text).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Third-party notices', exact: true })
  ).toBeVisible();
});
