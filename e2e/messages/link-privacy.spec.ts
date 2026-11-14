import { mkdirSync } from 'node:fs';
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
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
  type MatrixSession,
  joinRoom,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import { leaveCompactView } from '../helpers/roomViewSwitch';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// Links in messages against the slot's homeserver, in Chromium (desktop) and WebKit (phone):
// - Site icons. By default no link sends anything to a third party. A deployment that sets
//   `messageRendering.linkFavicons` shows icons from icons.duckduckgo.com in unencrypted rooms,
//   and never in encrypted ones, whatever the person's link preview settings say.
// - Destinations. Bidirectional control characters in a link's text are removed, every link
//   names its real address on hover (title), and a link whose text reads as an address on another
//   host asks before it opens.
// Set LINK_PRIVACY_SHOTS=<directory> to save the confirmation on each engine.
const PASSWORD = 'link-privacy-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.LINK_PRIVACY_SHOTS;
const ICON_SERVICE = 'icons.duckduckgo.com';
const BIDI = /[\u202A-\u202E\u2066-\u2069]/;

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

const register = (name: string): Promise<MatrixSession & { username: string }> =>
  registerDisposableUser(`lp_${name}_${RUN}`, PASSWORD);

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
  // WebKit does not route the requests the service worker makes, config.json among them.
  const context = await browser.newContext({ ...options, baseURL, serviceWorkers: 'block' });
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
  await leaveCompactView(page);
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
  await joinRoom(HOMESERVER, reader.accessToken, plainRoom);
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

    // The deployment turns icons on: the unencrypted room shows one, and only the icon of the
    // allowed host goes to the service, once per page load. Routing turns the browser's HTTP cache
    // off, so each load asks again; a browser without routes keeps the icon for the service's
    // max-age.
    const icon = `https://${ICON_SERVICE}/ip3/example.org.ico`;
    const expectIconRequests = async (count: number, when: string) => {
      await expect(plain.locator('img'), `${engine}: icon ${when}`).toHaveCount(1);
      await expect.poll(() => iconRequests(external).length).toBeGreaterThanOrEqual(count);
      await page.waitForTimeout(1_500);
      expect(iconRequests(external), `${engine}: one icon request per load ${when}`).toEqual(
        Array.from({ length: count }, () => icon)
      );
    };
    // The page renders its stored config.json and applies the fresh one on the same load.
    await routeConfig(context, true);
    await page.reload();
    await expect(plain).toHaveText('plain-link', { timeout: 30_000 });
    await expectIconRequests(1, 'once the fresh configuration allows it');
    // The next start renders the stored configuration that allows it at once.
    await page.reload();
    await expect(plain).toHaveText('plain-link', { timeout: 30_000 });
    await expectIconRequests(2, 'on a start from the stored configuration');

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

/** Real destinations: hover titles, bidi controls removed, a check before a misleading link. */
const checkDestinations = async (
  browser: Browser,
  options: BrowserContextOptions,
  engine: string,
  baseURL?: string
) => {
  const reader = await register(`dest_reader_${engine}`);
  const writer = await register(`dest_writer_${engine}`);
  const roomId = await createRoom(writer, 'Link Review', {
    encrypted: false,
    invite: reader.userId,
  });
  await joinRoom(HOMESERVER, reader.accessToken, roomId);
  await sendLink(
    writer,
    roomId,
    'Reversed',
    '<a href="https://evil.example/">https://\u202Egro.elpmaxe\u202C</a>'
  );
  await sendLink(
    writer,
    roomId,
    'Claimed',
    '<a href="https://evil.example/login">https://example.org/login</a>'
  );
  await sendLink(writer, roomId, 'Honest', '<a href="https://example.org/docs">the docs</a>');
  await sendLink(
    writer,
    roomId,
    'Same',
    '<a href="https://example.org/same">https://example.org/same</a>'
  );

  const { context, page, external } = await openContext(browser, options, baseURL);
  const press = options.hasTouch
    ? (locator: ReturnType<typeof linkIn>) => locator.tap()
    : (locator: ReturnType<typeof linkIn>) => locator.click();
  try {
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: reader.username,
      password: PASSWORD,
    });
    await openRoom(page, roomId, reader.userId);
    const reversed = linkIn(page, 'Reversed');
    await expect(reversed).toBeVisible({ timeout: 30_000 });

    // Every link names its real address, and no text keeps a direction override.
    for (const [label, href] of [
      ['Reversed', 'https://evil.example/'],
      ['Claimed', 'https://evil.example/login'],
      ['Honest', 'https://example.org/docs'],
      ['Same', 'https://example.org/same'],
    ] as const) {
      const link = linkIn(page, label);
      await expect(link, `${engine}: ${label} names its address`).toHaveAttribute('title', href);
      expect(
        BIDI.test((await link.textContent()) ?? ''),
        `${engine}: ${label} has no bidi controls`
      ).toBe(false);
    }
    await expect(reversed).toHaveText('https://gro.elpmaxe');

    const pages: string[] = [];
    context.on('page', (opened) => pages.push(opened.url()));
    const dialog = page.getByRole('dialog', { name: 'Open this link?' });

    // A link whose text names another host asks first, showing where it really goes.
    for (const [label, href] of [
      ['Reversed', 'https://evil.example/'],
      ['Claimed', 'https://evil.example/login'],
    ] as const) {
      await press(linkIn(page, label));
      await expect(dialog, `${engine}: ${label} asks before opening`).toBeVisible();
      await expect(dialog.getByText(href, { exact: true })).toBeVisible();
      if (SHOTS && label === 'Claimed') {
        mkdirSync(SHOTS, { recursive: true });
        for (const scheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme: scheme });
          await page.screenshot({ path: `${SHOTS}/link-confirm-${engine}-${scheme}.png` });
        }
        await page.emulateMedia({ colorScheme: null });
      }
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await page.waitForTimeout(500);
      expect(pages, `${engine}: ${label} did not open after Cancel`).toEqual([]);
    }

    // Every other way a mouse opens a link asks the same (live-test pass 2, P2-lane9-F001): a
    // middle click, a click with a new-tab modifier, the browser's own link menu, which offers to
    // open the link, and dragging the link to the tab bar.
    if (!options.hasTouch) {
      const claimed = linkIn(page, 'Claimed');
      const asks = async (how: string, act: () => Promise<unknown>) => {
        await act();
        await expect(dialog, `${engine}: ${how} asks before opening`).toBeVisible();
        await expect(dialog.getByText('https://evil.example/login', { exact: true })).toBeVisible();
        if (SHOTS) {
          mkdirSync(SHOTS, { recursive: true });
          const name = how.replace(/^a /, '').replace(/\W+/g, '-');
          await page.screenshot({ path: `${SHOTS}/link-confirm-${name}-${engine}.png` });
        }
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await page.waitForTimeout(500);
        expect(pages, `${engine}: ${how} opened nothing`).toEqual([]);
      };
      await asks('a middle click', () => claimed.click({ button: 'middle' }));
      await asks('a modifier click', () => claimed.click({ modifiers: ['ControlOrMeta'] }));
      await asks('a right click', () => claimed.click({ button: 'right' }));
      const dragged = await claimed.evaluate((link) => {
        const drag = new DragEvent('dragstart', { bubbles: true, cancelable: true });
        link.dispatchEvent(drag);
        return !drag.defaultPrevented;
      });
      expect(dragged, `${engine}: a misleading link cannot be dragged out`).toBe(false);
      const honestDrag = await linkIn(page, 'Honest').evaluate((link) => {
        const drag = new DragEvent('dragstart', { bubbles: true, cancelable: true });
        link.dispatchEvent(drag);
        return !drag.defaultPrevented;
      });
      expect(honestDrag, `${engine}: an honest link drags as usual`).toBe(true);
    }

    // Opening anyway goes to the real address.
    await press(linkIn(page, 'Claimed'));
    const opened = context.waitForEvent('page');
    await dialog.getByRole('button', { name: 'Open link', exact: true }).click();
    const target = await opened;
    await expect.poll(() => target.url()).toBe('https://evil.example/login');
    await target.close();

    // Text that does not read as another address opens at once.
    for (const [label, href] of [
      ['Honest', 'https://example.org/docs'],
      ['Same', 'https://example.org/same'],
    ] as const) {
      const next = context.waitForEvent('page');
      await press(linkIn(page, label));
      const direct = await next;
      await expect.poll(() => direct.url()).toBe(href);
      await expect(dialog).toHaveCount(0);
      await direct.close();
    }
    expect(external.filter((url) => url.includes(ICON_SERVICE))).toEqual([]);
  } finally {
    await context.close();
  }
};

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
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

test('links show their real destination and ask before a misleading one opens (Chromium)', async ({
  browser,
  baseURL,
}) => {
  await checkDestinations(browser, DESKTOP, 'chromium', baseURL);
});

test('links show their real destination and ask before a misleading one opens (WebKit desktop)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  const webkit = await launchWebKit();
  try {
    await checkDestinations(webkit, DESKTOP, 'webkit_desk', baseURL);
  } finally {
    await webkit.close();
  }
});

test('links show their real destination and ask before a misleading one opens (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  const webkit = await launchWebKit();
  try {
    await checkDestinations(webkit, PHONE, 'webkit', baseURL);
  } finally {
    await webkit.close();
  }
});
