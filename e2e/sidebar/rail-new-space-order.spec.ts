import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// The spaces nobody arranged show oldest first, so a new space goes to the end of the rail and
// stays there after a reload and on another device. The rail showed them in the order the client
// first got them: by room ID from the server's first sync, then in the order they came, so a new
// space sat last while live and elsewhere on the next device or start (live-test finding
// P2-lane4-F006). Runs in Chromium and,
// when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against the disposable
// homeserver of `just hs-up` (or a slot of scripts/e2e-slot.sh). Set RAIL_ORDER_SHOTS=<directory>
// for screenshots.
const PASSWORD = 'rail-new-space-order-spec-password';
const RUN = Date.now().toString(36);
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

const newSpaceStaysLast = async (page: Page, label: string, newPage: () => Promise<Page>) => {
  const person = await registerDisposableUser(`rnso_${label}_${RUN}`, PASSWORD);
  const spaceIds: string[] = [];
  for (const name of SPACES) {
    // eslint-disable-next-line no-await-in-loop
    spaceIds.push(await createRoom(HOMESERVER, person.accessToken, { name, space: true }));
  }
  // The spaces nobody arranged show oldest first.
  await loginWithPassword(page, { homeserver: HOMESERVER, ...person });
  await expect.poll(() => railSpaces(page), { timeout: 30_000 }).toEqual(spaceIds);

  // The person creates a space on another device.
  const newSpaceId = await createRoom(HOMESERVER, person.accessToken, {
    name: 'Launch planning',
    space: true,
  });
  const joined = [...spaceIds, newSpaceId];
  await expect.poll(() => railSpaces(page), { timeout: 30_000 }).toEqual(joined);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/rail-order-${label}-live.png` });

  await page.reload();
  await expect.poll(() => railSpaces(page), { timeout: 30_000 }).toHaveLength(joined.length);
  expect(await railSpaces(page), 'the rail after a reload').toEqual(joined);

  // A device that signs in now gets the rooms in the server's order, which is not the joins'.
  const fresh = await newPage();
  await loginWithPassword(fresh, { homeserver: HOMESERVER, ...person });
  await expect.poll(() => railSpaces(fresh), { timeout: 30_000 }).toHaveLength(joined.length);
  if (SHOTS) await fresh.screenshot({ path: `${SHOTS}/rail-order-${label}-new-device.png` });
  expect(await railSpaces(fresh), 'the rail on a new device').toEqual(joined);
};

test('a new space stays at the end of the rail after a reload (Chromium)', async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  await newSpaceStaysLast(page, 'chromium', async () =>
    (await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL })).newPage()
  );
});

test('a new space stays at the end of the rail after a reload (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  await onWebKitPage({ viewport: { width: 1280, height: 800 }, baseURL }, (page) =>
    newSpaceStaysLast(page, 'webkit', async () =>
      (
        await page
          .context()
          .browser()!
          .newContext({ viewport: { width: 1280, height: 800 }, baseURL })
      ).newPage()
    )
  );
});
