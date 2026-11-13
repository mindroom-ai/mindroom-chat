import {
  expect,
  test,
  type BrowserContextOptions,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  createDefaultThreadFilterState,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// Jumps within a room to a message far above the view. In the Threads view the room's whole
// history is loaded, so the message is in the room's rows but its row is not mounted: a click on
// a reply's quote and the minimap's first stripe each bring it into view, and the
// quote highlights it. In the Full view the message is older than the loaded timeline, and the
// quote still loads the history around it and lands on it. Desktop (1280 by 800) and
// phone (390 by 844, touch; no minimap there, it needs a fine pointer), Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, WebKit. The account has 25 rooms.
// Set FAR_ROW_JUMP_SHOTS=<directory> to save the landed views.
const PASSWORD = 'far-row-jumps-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.FAR_ROW_JUMP_SHOTS;

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const OLD = 'Which crew takes the early shift on the dredger while berth four is closed?';
const REPLY = 'The north crew takes it, starting Monday.';
const NOTES = [
  'Pilot boarding moved to the outer anchorage while the swell is up.',
  'Can someone confirm the reefer plugs on the north quay are back in service? The night shift ' +
    'reported two of them tripping again around three.',
  'Weather update: gusts up to 30 knots after lunch, crane work stops above 25.',
  'Thanks, noted.',
  'The bunker barge is alongside the tanker at berth two, expect the fire watch until six.',
];
const NOTE_COUNT = 80;

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

/** An account with 24 other rooms and a room: an old message, 80 notes, a reply quoting it. */
const seed = async (name: string) => {
  const username = `frj_${name}_${RUN}`;
  const owner: MatrixSession = await registerDisposableUser(username, PASSWORD);
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(owner.userId)}/displayname`, {
    method: 'PUT',
    accessToken: owner.accessToken,
    body: JSON.stringify({ displayname: 'Harbor Coordinator' }),
  });
  await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      createRoom(HOMESERVER, owner.accessToken, { name: `Project room ${index + 1}` })
    )
  );
  const roomId = await createRoom(HOMESERVER, owner.accessToken, { name: 'Harbor operations' });
  const send = (content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, owner.accessToken, roomId, content);
  const old = await send({ msgtype: 'm.text', body: OLD });
  for (let index = 0; index < NOTE_COUNT; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await send({ msgtype: 'm.text', body: `${NOTES[index % NOTES.length]} (${index + 1})` });
  }
  const reply = await send({
    msgtype: 'm.text',
    body: REPLY,
    'm.relates_to': { 'm.in_reply_to': { event_id: old } },
  });
  return { username, userId: owner.userId, roomId, old, reply };
};

type Seeded = Awaited<ReturnType<typeof seed>>;

/** Records whether the row of `eventId` is ever drawn highlighted, from now on. */
const watchHighlight = (page: Page, eventId: string) =>
  page.evaluate((id) => {
    const state = window as Window & { farHighlights?: Record<string, boolean> };
    const seen = state.farHighlights ?? {};
    state.farHighlights = seen;
    seen[id] = false;
    const started = performance.now();
    const tick = () => {
      const row = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
      const fill = row ? getComputedStyle(row).backgroundColor : 'rgba(0, 0, 0, 0)';
      if (fill !== 'rgba(0, 0, 0, 0)' && fill !== 'transparent') {
        seen[id] = true;
        return;
      }
      if (performance.now() - started < 60_000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, eventId);

const highlighted = (page: Page, eventId: string) =>
  page.evaluate(
    (id) =>
      (window as Window & { farHighlights?: Record<string, boolean> }).farHighlights?.[id] ?? false,
    eventId
  );

const row = (page: Page, eventId: string) => page.locator(`[data-message-id="${eventId}"]`);

/** The landed row is inside the visible band of the timeline, not under the header. */
const expectLanded = async (page: Page, eventId: string, where: string) => {
  await expect(row(page, eventId), `row in view (${where})`).toBeInViewport({
    ratio: 0.9,
    timeout: 30_000,
  });
  const header = await page
    .getByRole('banner')
    .filter({ has: page.getByRole('heading', { name: 'Harbor operations' }) })
    .boundingBox();
  const box = await row(page, eventId).boundingBox();
  if (header && box) {
    expect(box.y, `row below the header (${where})`).toBeGreaterThanOrEqual(
      header.y + header.height - 1
    );
  }
};

const shoot = async (page: Page, testInfo: TestInfo, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/far-row-jump-${name}.png` });
  await testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
};

const openRoom = async (page: Page, seeded: Seeded, classic = false) => {
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seeded.username,
    password: PASSWORD,
  });
  if (classic) {
    await seedRoomOverviewState({
      page,
      roomId: seeded.roomId,
      userId: seeded.userId,
      viewMode: 'classic',
      filterState: createDefaultThreadFilterState(),
    });
  }
  await page.goto(`/home/${encodeURIComponent(seeded.roomId)}/`);
  await expect(page.getByText(REPLY, { exact: true })).toBeVisible({ timeout: 60_000 });
  // The old message's row is far above: not mounted.
  await expect(row(page, seeded.old)).toHaveCount(0);
};

type Form = 'desktop' | 'phone';

const replyQuoteJump = async (page: Page, engine: string, form: Form, testInfo: TestInfo) => {
  const seeded = await seed(`q_${engine}_${form}`);
  await openRoom(page, seeded);
  const quote = row(page, seeded.reply).locator(`[data-event-id="${seeded.old}"]`).first();
  await expect(quote).toBeVisible({ timeout: 30_000 });
  await watchHighlight(page, seeded.old);
  if (form === 'phone') await quote.tap();
  else await quote.click();
  await expectLanded(page, seeded.old, `${engine}, ${form}, quote`);
  await expect.poll(() => highlighted(page, seeded.old), { timeout: 10_000 }).toBe(true);
  await shoot(page, testInfo, `quote-${engine}-${form}`);
};

const minimapJump = async (page: Page, engine: string, form: Form, testInfo: TestInfo) => {
  test.skip(form === 'phone', 'The minimap needs a fine pointer');
  const seeded = await seed(`m_${engine}_${form}`);
  await openRoom(page, seeded);
  const slider = page.getByRole('slider', { name: 'Jump to message', exact: true });
  await expect(slider).toBeVisible({ timeout: 30_000 });
  await slider.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expectLanded(page, seeded.old, `${engine}, ${form}, minimap`);
  await shoot(page, testInfo, `minimap-${engine}-${form}`);
};

const unloadedQuoteJump = async (page: Page, engine: string, form: Form, testInfo: TestInfo) => {
  const seeded = await seed(`u_${engine}_${form}`);
  await openRoom(page, seeded, true);
  const quote = row(page, seeded.reply).locator(`[data-event-id="${seeded.old}"]`).first();
  await expect(quote).toBeVisible({ timeout: 30_000 });
  await watchHighlight(page, seeded.old);
  if (form === 'phone') await quote.tap();
  else await quote.click();
  await expectLanded(page, seeded.old, `${engine}, ${form}, unloaded quote`);
  await expect.poll(() => highlighted(page, seeded.old), { timeout: 10_000 }).toBe(true);
  await shoot(page, testInfo, `unloaded-quote-${engine}-${form}`);
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

type Check = (page: Page, engine: string, form: Form, info: TestInfo) => Promise<void>;
const CHECKS: [string, Check][] = [
  ['a reply quote opens its far, loaded message', replyQuoteJump],
  ['the minimap opens a far, loaded message', minimapJump],
  [
    'in the Full view a reply quote opens a message older than the loaded timeline',
    unloadedQuoteJump,
  ],
];

for (const [form, options] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test.describe(form, () => {
    test.use(options);

    for (const [title, check] of CHECKS) {
      test(`${title} (Chromium, ${form})`, async ({ page }, testInfo) => {
        test.setTimeout(240_000);
        await check(page, 'chromium', form, testInfo);
      });

      test(`${title} (WebKit, ${form})`, async ({ baseURL }, testInfo) => {
        test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
        test.setTimeout(240_000);
        const browser = await launchWebKit();
        try {
          const context = await browser.newContext({ ...options, baseURL });
          await check(await context.newPage(), 'webkit', form, testInfo);
        } finally {
          await browser.close();
        }
      });
    }
  });
}
