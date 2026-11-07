import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { onWebKitPage } from '../helpers/webkit';

// A space the person creates or joins goes to the end of the rail, and stays there after a
// reload: the rail showed the spaces nobody had arranged in the order the server listed them on
// that start, so a new space sat last while live and first after a reload (live-test finding
// P2-lane4-F006). Runs in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's
// WebKit, in WebKit, against the disposable homeserver of `just hs-up` (or a slot of
// scripts/e2e-slot.sh). Set RAIL_ORDER_SHOTS=<directory> for screenshots.
const PASSWORD = 'rail-new-space-order-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.RAIL_ORDER_SHOTS;
const SPACES = ['Sales', 'Finance', 'Platform', 'Research', 'Partners', 'Support'];

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/** The spaces in the rail, top to bottom. */
const railSpaces = (page: Page) =>
  page
    .getByRole('navigation', { name: 'Main', exact: true })
    .getByRole('group', { name: 'Spaces' })
    .locator('[data-id]')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-id') ?? ''));

const newSpaceStaysLast = async (page: Page, label: string) => {
  const person = await registerDisposableUser(`rnso_${label}_${RUN}`, PASSWORD);
  const spaceIds: string[] = [];
  for (const name of SPACES) {
    // eslint-disable-next-line no-await-in-loop
    spaceIds.push(await createRoom(HOMESERVER, person.accessToken, { name, space: true }));
  }
  await loginWithPassword(page, { homeserver: HOMESERVER, ...person });
  await expect.poll(() => railSpaces(page), { timeout: 30_000 }).toHaveLength(SPACES.length);
  const before = await railSpaces(page);

  // The person creates a space on another device.
  const newSpaceId = await createRoom(HOMESERVER, person.accessToken, {
    name: 'Launch planning',
    space: true,
  });
  await expect.poll(() => railSpaces(page), { timeout: 30_000 }).toEqual([...before, newSpaceId]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/rail-order-${label}-live.png` });

  await page.reload();
  await expect.poll(() => railSpaces(page), { timeout: 30_000 }).toHaveLength(SPACES.length + 1);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/rail-order-${label}-reload.png` });
  expect(await railSpaces(page), 'the rail after a reload').toEqual([...before, newSpaceId]);
};

test('a new space stays at the end of the rail after a reload (Chromium)', async ({ page }) => {
  test.setTimeout(180_000);
  await newSpaceStaysLast(page, 'chromium');
});

test('a new space stays at the end of the rail after a reload (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  await onWebKitPage({ viewport: { width: 1280, height: 800 }, baseURL }, (page) =>
    newSpaceStaysLast(page, 'webkit')
  );
});
