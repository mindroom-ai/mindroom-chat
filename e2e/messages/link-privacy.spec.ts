import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Links in messages against the slot's homeserver, in Chromium (desktop) and WebKit (phone):
// - Site icons. By default no link sends anything to a third party. A deployment that sets
//   `messageRendering.linkFavicons` shows icons from icons.duckduckgo.com in unencrypted rooms,
//   and never in encrypted ones, whatever the person's link preview settings say.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'link-privacy-spec-password';
const RUN = Date.now().toString(36);
const ICON_SERVICE = 'icons.duckduckgo.com';

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

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
  const username = `lp_${name}_${RUN}`;
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

const createRoom = async (
  owner: MatrixSession,
  name: string,
  { encrypted, invite }: { encrypted: boolean; invite?: string }
): Promise<string> => {
  const { room_id: roomId } = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
    method: 'POST',
    accessToken: owner.accessToken,
    body: JSON.stringify({
      name,
      preset: 'private_chat',
      invite: invite ? [invite] : [],
      initial_state: encrypted
        ? [
            {
              type: 'm.room.encryption',
              state_key: '',
              content: { algorithm: 'm.megolm.v1.aes-sha2' },
            },
          ]
        : [],
    }),
  });
  return roomId;
};

const sendLink = (writer: MatrixSession, roomId: string, label: string, html: string) =>
  sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
    msgtype: 'm.text',
    body: `${label}: ${html.replace(/<[^>]+>/g, '')}`,
    format: 'org.matrix.custom.html',
    formatted_body: `${label}: ${html}`,
  });

/** Serves config.json with `linkFavicons` set as given, or left out with `undefined`. */
const routeConfig = async (context: BrowserContext, linkFavicons: boolean | undefined) => {
  await context.unroute('**/config.json');
  await context.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as { messageRendering?: Record<string, unknown> };
    const messageRendering = { ...config.messageRendering };
    if (linkFavicons !== undefined) messageRendering.linkFavicons = linkFavicons;
    await route.fulfill({ json: { ...config, messageRendering } });
  });
};

/**
 * A page whose requests to anything but this machine are recorded. The icon service and the
 * linked sites answer locally, so nothing leaves the test machine.
 */
const openContext = async (browser: Browser, options: BrowserContextOptions, baseURL?: string) => {
  const context = await browser.newContext({ ...options, baseURL });
  const external: string[] = [];
  context.on('request', (request) => {
    const { hostname } = new URL(request.url());
    if (hostname !== '127.0.0.1' && hostname !== 'localhost') external.push(request.url());
  });
  await context.route(`https://${ICON_SERVICE}/**`, (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="#39a"/></svg>',
    })
  );
  for (const site of [
    'https://example.org/**',
    'https://example.net/**',
    'https://evil.example/**',
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await context.route(site, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>Linked page</title>' })
    );
  }
  const page = await context.newPage();
  return { context, page, external };
};

/** Opens the room in Classic, where each message is its own row. */
const openRoom = async (page: Page, roomId: string, userId: string) => {
  await seedRoomOverviewState({
    page,
    roomId,
    userId,
    viewMode: 'classic',
    filterState: createDefaultThreadFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  const viewSwitch = page.locator('[data-room-view-switch]');
  await expect(viewSwitch).toBeVisible({ timeout: 30_000 });
  if ((await viewSwitch.getAttribute('aria-pressed')) === 'true') await viewSwitch.click();
};

const linkIn = (page: Page, label: string) =>
  page
    .locator('[data-message-id]')
    .filter({ hasText: `${label}:` })
    .last()
    .locator('a[href]');

const iconRequests = (external: string[]) => external.filter((url) => url.includes(ICON_SERVICE));
const linkedSiteRequests = (external: string[]) =>
  external.filter((url) => /^https:\/\/(?:example\.org|example\.net|evil\.example)\//.test(url));

/** Link icons: none by default; with the deployment's switch, unencrypted rooms only. */
const checkIcons = async (
  browser: Browser,
  options: BrowserContextOptions,
  engine: string,
  baseURL?: string
) => {
  const reader = await register(`icon_reader_${engine}`);
  const writer = await register(`icon_writer_${engine}`);
  const plainRoom = await createRoom(writer, 'Link Desk', {
    encrypted: false,
    invite: reader.userId,
  });
  await matrixFetch(HOMESERVER, `/join/${encodeURIComponent(plainRoom)}`, {
    method: 'POST',
    accessToken: reader.accessToken,
    body: '{}',
  });
  await sendLink(writer, plainRoom, 'Plain', '<a href="https://example.org/plain">plain-link</a>');
  const secretRoom = await createRoom(reader, 'Harbor Survey', { encrypted: true });

  const { context, page, external } = await openContext(browser, options, baseURL);
  try {
    await routeConfig(context, undefined);
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: reader.username,
      password: PASSWORD,
    });

    // Default configuration: the link renders without an icon and nothing goes to the service.
    await openRoom(page, plainRoom, reader.userId);
    const plain = linkIn(page, 'Plain');
    await expect(plain).toHaveText('plain-link', { timeout: 30_000 });
    await page.waitForTimeout(1_500);
    await expect(plain.locator('img'), `${engine}: no icon by default`).toHaveCount(0);
    expect(iconRequests(external), `${engine}: no icon requests by default`).toEqual([]);

    // The deployment turns icons on: the unencrypted room shows one.
    await routeConfig(context, true);
    await page.reload();
    await expect(plain).toHaveText('plain-link', { timeout: 30_000 });
    await expect(plain.locator('img'), `${engine}: icon once the deployment allows it`).toHaveCount(
      1
    );
    await expect
      .poll(() => iconRequests(external))
      .toEqual([`https://${ICON_SERVICE}/ip3/example.org.ico`]);

    // An encrypted room never shows one, even with link previews allowed there.
    await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem('settings') ?? '{}') as Record<
        string,
        unknown
      >;
      localStorage.setItem('settings', JSON.stringify({ ...stored, encUrlPreview: true }));
    });
    await openRoom(page, secretRoom, reader.userId);
    await page.locator('[data-editable-name="RoomInput"]').click();
    await page.keyboard.type('Sealed: [sealed-link](https://example.net/sealed)');
    await page.keyboard.press('Enter');
    const sealed = linkIn(page, 'Sealed');
    await expect(sealed).toHaveText('sealed-link', { timeout: 30_000 });
    await page.waitForTimeout(1_500);
    await expect(sealed.locator('img'), `${engine}: no icon in an encrypted room`).toHaveCount(0);
    expect(
      iconRequests(external).filter((url) => url.includes('example.net')),
      `${engine}: no icon request for an encrypted room's link`
    ).toEqual([]);
    expect(linkedSiteRequests(external), `${engine}: rendering opened no linked site`).toEqual([]);
  } finally {
    await context.close();
  }
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
  test.setTimeout(240_000);
});

test('link icons reach no third party unless the deployment allows it, never in encrypted rooms (Chromium)', async ({
  browser,
  baseURL,
}) => {
  await checkIcons(browser, DESKTOP, 'chromium', baseURL);
});

test('link icons reach no third party unless the deployment allows it, never in encrypted rooms (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  const webkit = await launchWebKit();
  try {
    await checkIcons(webkit, PHONE, 'webkit', baseURL);
  } finally {
    await webkit.close();
  }
});
