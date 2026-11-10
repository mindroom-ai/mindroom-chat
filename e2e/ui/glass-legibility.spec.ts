import { writeFile } from 'node:fs/promises';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  joinRoom,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';
import { surfaceShowThrough } from '../helpers/surfaceShowThrough';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Text behind a glass surface never competes with the text on it. Over a room of long messages,
// with the surface's own content hidden, the screen is sampled across the surface: what shows
// through varies only faintly, and the surface's title keeps 4.5:1 against every sample. Measured
// on the room header, the thread filter bar, the composer over the Compact view's cards, the Leave
// Room dialog, the thread banner (which sits flush under the room header) and the room header
// above it, and the sticky title of a settings page, on a desktop (1440 by 900) and a phone (390
// by 844, touch), in light and dark themes, in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE
// names Playwright's WebKit, in WebKit. Set GLASS_LEGIBILITY_SHOTS=<directory> to also save each
// surface.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'glass-legibility-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.GLASS_LEGIBILITY_SHOTS;
const ROOM = 'Launch planning';
const TOPIC = 'Weekly status, risks and the launch checklist';
const SUMMARY = 'Load test results and the go-live checklist';
const MESSAGE =
  'The weekly planning notes are ready: we moved the launch review to Thursday, the design team ' +
  'shared three new layouts for the onboarding flow, and the support queue is down to twelve open ' +
  'requests after the release. Please read the summary before the call and add your questions.';
const REPLY =
  'The load test held 2,100 requests per second for an hour with the new cache settings; the ' +
  'slowest page took 480 ms at the peak, and the error rate stayed under 0.1 percent throughout.';

const DESKTOP: BrowserContextOptions = { viewport: { width: 1440, height: 900 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

test.use({
  launchOptions: {
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

const register = async (username: string) =>
  matrixFetch<{ access_token: string; user_id: string }>(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });

/**
 * A reader and an agent in a room of long messages, one of them a thread of long replies with a
 * title. The agent makes it a MindRoom room, so the Threads view shows its filter bar.
 */
const seed = async (name: string) => {
  const reader = await register(`glass_${name}_${RUN}`);
  const agent = await register(`mindroom_glass_${name}_${RUN}`);
  const roomId = await createPrivateRoom(HOMESERVER, reader.access_token, {
    name: ROOM,
    topic: TOPIC,
    invite: [agent.user_id],
  });
  await joinRoom(HOMESERVER, agent.access_token, roomId);
  const messageIds: string[] = [];
  for (let index = 0; index < 18; index += 1) {
    // eslint-disable-next-line no-await-in-loop -- the timeline in order.
    const eventId = await sendRoomMessage(HOMESERVER, reader.access_token, roomId, {
      msgtype: 'm.text',
      body: `${index + 1}. ${MESSAGE}`,
    });
    messageIds.push(eventId);
  }
  // A dozen more threads of one reply, so the Compact view's cards pass under the composer.
  for (const eventId of messageIds.slice(0, 12)) {
    // eslint-disable-next-line no-await-in-loop -- the replies in order.
    await sendRoomMessage(HOMESERVER, agent.access_token, roomId, {
      msgtype: 'm.text',
      body: REPLY,
      'io.mindroom.stream_status': 'completed',
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: eventId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: eventId },
      },
    });
  }
  const rootId = messageIds[12]!;
  const relation = {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  };
  for (let index = 0; index < 14; index += 1) {
    // eslint-disable-next-line no-await-in-loop -- the thread in order.
    await sendRoomMessage(HOMESERVER, agent.access_token, roomId, {
      msgtype: 'm.text',
      body: `Reply ${index + 1}. ${REPLY}`,
      'io.mindroom.stream_status': 'completed',
      'm.relates_to': relation,
    });
  }
  await sendRoomMessage(HOMESERVER, agent.access_token, roomId, {
    msgtype: 'm.notice',
    body: SUMMARY,
    'io.mindroom.thread_summary': {
      version: 1,
      summary: SUMMARY,
      message_count: 15,
      generated_at: new Date().toISOString(),
      model: 'test',
    },
    'm.relates_to': relation,
  });
  return { username: `glass_${name}_${RUN}`, userId: reader.user_id, roomId, rootId };
};

type World = Awaited<ReturnType<typeof seed>>;
type Measured = Awaited<ReturnType<typeof surfaceShowThrough>>;

const setTheme = (page: Page, theme: string) =>
  page.evaluate((id) => {
    const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
    localStorage.setItem(
      'settings',
      JSON.stringify({ ...settings, useSystemTheme: false, themeId: id })
    );
  }, `${theme}-theme`);

const synced = (page: Page) =>
  expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });

const roomHeader = (page: Page) =>
  page.locator('header').filter({ has: page.getByRole('heading', { name: ROOM, exact: true }) });

/**
 * Signs in and keeps the room in its Threads view (a room with an agent opens in Compact), with
 * the filter bar shown.
 */
const signIn = (page: Page, world: World) =>
  loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: world.username,
    password: PASSWORD,
  });

/** Keeps the room in a view (a room with an agent opens in Compact), with the filter bar shown. */
const chooseView = (page: Page, world: World, viewMode: 'threaded' | 'compact') =>
  seedRoomOverviewState({
    page,
    roomId: world.roomId,
    userId: world.userId,
    viewMode,
    filterState: createDefaultThreadFilterState(),
  });

/**
 * The room in its Threads view, which lists the newest message first and opens at the end of the
 * list, the first message: the others pass under the header and the filter bar.
 */
const openRoom = async (page: Page, world: World) => {
  await chooseView(page, world, 'threaded');
  await page.goto(`/home/${encodeURIComponent(world.roomId)}`);
  await synced(page);
  // The first message; its thread's card can show the same text.
  await expect(
    page
      .getByText(/^1\. The weekly planning notes/)
      .filter({ visible: true })
      .first()
  ).toBeVisible({ timeout: 60_000 });
};

const openThread = async (page: Page, world: World) => {
  await page.goto(
    `/home/${encodeURIComponent(world.roomId)}?threadId=${encodeURIComponent(world.rootId)}`
  );
  await synced(page);
  await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(`Reply 14. ${REPLY.slice(0, 30)}`)).toBeVisible({
    timeout: 60_000,
  });
};

/** Measures one surface: its content hidden, the page behind sampled across it. */
const measure = async (
  page: Page,
  results: Record<string, Measured>,
  name: string,
  surface: Locator,
  text: Locator
) => {
  await expect(text).toBeVisible();
  await page.mouse.move(0, 0);
  // Menus, dialogs and the banner fade or slide in.
  await page.waitForTimeout(500);
  // "Catching up..." lies over the top of the app while a start catches up, and it may show only
  // after the check that followed the page load; the surface is measured without it.
  await synced(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
  results[name] = await surfaceShowThrough(page, surface, text);
};

const checkSurfaces = async (
  page: Page,
  engine: 'chromium' | 'webkit',
  size: 'desktop' | 'phone',
  testInfo: TestInfo
) => {
  const world = await seed(`${engine}_${size}`);
  await signIn(page, world);
  const results: Record<string, Measured> = {};
  const gaps: Record<string, number> = {};
  try {
    for (const theme of ['light', 'dark']) {
      /* eslint-disable no-await-in-loop -- one surface after the other on one page. */
      const prefix = `${engine}-${size}-${theme}`;
      await setTheme(page, theme);
      await openRoom(page, world);
      const header = roomHeader(page);
      await measure(
        page,
        results,
        `${prefix}-room-header`,
        header,
        header.getByRole('heading', { name: ROOM })
      );
      const filterBar = page.locator('[data-room-thread-overview]');
      await measure(
        page,
        results,
        `${prefix}-filter-bar`,
        filterBar,
        filterBar.locator('[data-filter-key]').first()
      );

      // The Compact view's cards pass under the composer.
      await chooseView(page, world, 'compact');
      await page.goto(`/home/${encodeURIComponent(world.roomId)}`);
      await synced(page);
      await expect(page.getByText(SUMMARY, { exact: true }).first()).toBeVisible({
        timeout: 60_000,
      });
      const textBox = page.locator('[data-editable-name="RoomInput"]');
      await textBox.evaluate((element) => {
        for (let node = element.parentElement; node; node = node.parentElement) {
          if (getComputedStyle(node).backdropFilter.includes('blur')) {
            node.setAttribute('data-glass-composer', '');
            return;
          }
        }
      });
      await measure(
        page,
        results,
        `${prefix}-compact-composer`,
        page.locator('[data-glass-composer]'),
        textBox
      );

      await header.getByRole('button', { name: 'More Options', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Leave Room', exact: true }).click();
      const leave = page.getByRole('alertdialog', { name: 'Leave Room' });
      await measure(
        page,
        results,
        `${prefix}-leave-dialog`,
        leave,
        leave.getByText('Leave Room', { exact: true }).first()
      );
      await page.keyboard.press('Escape');
      await expect(leave).toHaveCount(0);

      await openThread(page, world);
      const banner = page.locator('[data-thread-context-banner]');
      await measure(
        page,
        results,
        `${prefix}-thread-banner`,
        banner,
        banner.locator('[data-thread-context-summary]')
      );
      // Wider than a phone the banner sits flush under the room header: no strip between them
      // where scrolled text shows sharp and cut in half. On a phone it is the room header's row.
      if (size === 'desktop') {
        const headerBox = (await roomHeader(page).boundingBox())!;
        const bannerBox = (await banner.boundingBox())!;
        gaps[`${prefix}-banner-gap`] = Math.round(bannerBox.y - (headerBox.y + headerBox.height));
        await measure(
          page,
          results,
          `${prefix}-thread-room-header`,
          roomHeader(page),
          roomHeader(page).getByRole('heading', { name: ROOM })
        );
      }

      // A settings page scrolled under its sticky title.
      if (size === 'phone') await page.goto('/home/');
      await synced(page);
      await chooseFromAccountMenu(page, 'Settings');
      const dialog = page.getByRole('dialog', { name: 'Settings' });
      await dialog
        .getByRole('navigation', { name: 'Settings' })
        .getByRole('button', { name: 'Privacy & security', exact: true })
        .click();
      const title = dialog
        .locator('header')
        .filter({ hasText: 'Privacy & security' })
        .filter({ hasNot: page.getByRole('navigation') });
      await expect(title).toBeVisible();
      // The page's rows load after its title; scroll its list once they are there.
      await expect
        .poll(() =>
          title.evaluate((element) => {
            const list = element.closest('[data-y-scrollbar-width]');
            if (!list) return 0;
            list.scrollTop = 160;
            return list.scrollTop;
          })
        )
        .toBeGreaterThanOrEqual(100);
      await measure(
        page,
        results,
        `${prefix}-settings-title`,
        title,
        title.getByText('Privacy & security', { exact: true }).last()
      );
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      /* eslint-enable no-await-in-loop */
    }
  } finally {
    const body = JSON.stringify({ ...results, ...gaps }, null, 2);
    await writeFile(testInfo.outputPath(`legibility-${engine}-${size}.json`), body);
    await testInfo.attach(`legibility-${engine}-${size}.json`, { body });
  }
  // Playwright's WebKit leaves backdrop filters out of its screenshots (it draws them on screen),
  // so there the page behind shows through unblurred: the worst case, which the tint alone covers.
  // Chromium blurs it; a colored avatar passing under a dark header still reaches 17. Before the
  // dense tint these surfaces measured 15 to 127 in Chromium and 28 to 168 in WebKit.
  const limit = engine === 'webkit' ? 24 : 20;
  for (const [name, gap] of Object.entries(gaps)) {
    expect.soft(Math.abs(gap), `${name}: banner under the header`).toBeLessThanOrEqual(1);
  }
  for (const [name, { spread, contrast }] of Object.entries(results)) {
    expect.soft(spread, `${name}: the page behind shows only faintly`).toBeLessThanOrEqual(limit);
    expect
      .soft(contrast, `${name}: the title against what shows through`)
      .toBeGreaterThanOrEqual(4.5);
  }
};

// Every test seeds its own accounts and room.
test.describe.configure({ mode: 'parallel' });

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
});

for (const [size, options] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test(`glass surfaces keep their titles legible on a ${size}`, async ({ browser }, testInfo) => {
    test.setTimeout(300_000);
    const context = await browser.newContext(options);
    try {
      await checkSurfaces(await context.newPage(), 'chromium', size, testInfo);
    } finally {
      await context.close();
    }
  });

  test(`glass surfaces keep their titles legible on a ${size} (WebKit)`, async ({
    baseURL,
  }, testInfo) => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    test.setTimeout(300_000);
    let webkit: Browser | undefined;
    try {
      webkit = await launchWebKit();
      const context = await webkit.newContext({ ...options, baseURL });
      await checkSurfaces(await context.newPage(), 'webkit', size, testInfo);
    } finally {
      await webkit?.close();
    }
  });
}
