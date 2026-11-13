import {
  expect,
  test,
  type BrowserContextOptions,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { matrixFetch, type MatrixSession } from '../helpers/matrix';
import { launchWebKit } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// A room the reader has not joined, opened by its address (`/home/#alias:server`), shows a page
// whose header names the room by that address, not by the room ID the address resolves to. Opened
// by its room ID, the header shows the room's address, and a room without an address shows its
// name. Join then opens the room. On a desktop (1280 by 800) and a phone (390 by 844, touch), in
// Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit; the reader
// has 25 rooms. Set JOIN_HEADER_SHOTS=<directory> to save each page.
const PASSWORD = 'join-by-address-header-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.JOIN_HEADER_SHOTS;

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const ALIASED_ROOM = 'Harbor operations';
const UNNAMED_ADDRESS_ROOM = 'Quay notes';

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const register = async (username: string): Promise<MatrixSession> => {
  return registerDisposableUser(username, PASSWORD);
};

const createPublicRoom = async (owner: MatrixSession, name: string, aliasName?: string) =>
  (
    await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
      method: 'POST',
      accessToken: owner.accessToken,
      body: JSON.stringify({
        name,
        topic: 'Shift handovers and berth changes for the container terminal.',
        preset: 'public_chat',
        room_alias_name: aliasName,
      }),
    })
  ).room_id;

const seed = async (name: string) => {
  const owner = await register(`jbh_${name}_owner_${RUN}`);
  const username = `jbh_${name}_${RUN}`;
  const reader = await register(username);
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index + 1}` })
    )
  );
  const server = owner.userId.slice(owner.userId.indexOf(':') + 1);
  const aliasName = `harbor_${name}_${RUN}`;
  const alias = `#${aliasName}:${server}`;
  const aliasedRoomId = await createPublicRoom(owner, ALIASED_ROOM, aliasName);
  const plainRoomId = await createPublicRoom(owner, UNNAMED_ADDRESS_ROOM);
  return { username, alias, aliasedRoomId, plainRoomId };
};

const shoot = async (page: Page, testInfo: TestInfo, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/join-header-${name}.png` });
  await testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
};

const check = async (page: Page, engine: string, form: 'desktop' | 'phone', info: TestInfo) => {
  const seeded = await seed(`${engine}_${form}`);
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seeded.username,
    password: PASSWORD,
  });
  const join = page.getByRole('button', { name: 'Join', exact: true });

  const expectHeader = async (shown: string, hidden: string[], where: string) => {
    await expect(join, where).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByRole('heading', { name: shown, exact: true }),
      `the header names the room ${shown} (${where})`
    ).toBeVisible({ timeout: 30_000 });
    for (const text of hidden) {
      // eslint-disable-next-line no-await-in-loop
      await expect(page.getByText(text), `${text} is not shown (${where})`).toHaveCount(0);
    }
  };

  // Opened by its address: the header keeps the address.
  await page.goto(`/home/${encodeURIComponent(seeded.alias)}`);
  await expectHeader(seeded.alias, [seeded.aliasedRoomId], `${engine}, ${form}, by address`);
  await shoot(page, info, `${engine}-${form}-address`);

  // Opened by its room ID: the header shows its address.
  await page.goto(`/home/${encodeURIComponent(seeded.aliasedRoomId)}`);
  await expectHeader(seeded.alias, [seeded.aliasedRoomId], `${engine}, ${form}, by ID`);

  // A room without an address, opened by its room ID: the header shows its name.
  await page.goto(`/home/${encodeURIComponent(seeded.plainRoomId)}`);
  await expectHeader(UNNAMED_ADDRESS_ROOM, [seeded.plainRoomId], `${engine}, ${form}, no address`);
  await shoot(page, info, `${engine}-${form}-no-address`);

  // Join opens the room.
  await page.goto(`/home/${encodeURIComponent(seeded.alias)}`);
  await expect(join).toBeVisible({ timeout: 60_000 });
  if (form === 'phone') await join.tap();
  else await join.click();
  await expect(page.locator('[data-editable-name="RoomInput"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(ALIASED_ROOM).first()).toBeVisible();
  await expect(page.getByText(seeded.aliasedRoomId)).toHaveCount(0);
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

for (const [form, options] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test.describe(form, () => {
    test.use(options);
    const title = 'a room opened by address names it by address in the header';

    test(`${title} (Chromium, ${form})`, async ({ page }, testInfo) => {
      test.setTimeout(180_000);
      await check(page, 'chromium', form, testInfo);
    });

    test(`${title} (WebKit, ${form})`, async ({ baseURL }, testInfo) => {
      test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
      test.setTimeout(180_000);
      // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
      const browser = await launchWebKit();
      try {
        const context = await browser.newContext({ ...options, baseURL });
        await check(await context.newPage(), 'webkit', form, testInfo);
      } finally {
        await browser.close();
      }
    });
  });
}
