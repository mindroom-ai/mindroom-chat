import { expect, test, type BrowserContextOptions, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  joinRoom,
  registerAgentAccount,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// Leaving a thread that was opened from a link (not from its card) brings its card into view in
// the Compact view, as leaving a thread opened from its card does. A room with an agent and 120
// threads, the linked one about 100 cards down the Last Reply order, among 25 rooms, with
// classic scrollbars, on a desktop (1280 by 800) and a phone (390 by 844, touch), in Chromium
// and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. Set
// COMPACT_EXIT_SHOTS to a directory to save the room after leaving.
const PASSWORD = 'compact-deep-link-exit-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.COMPACT_EXIT_SHOTS;
const ROOTS = 120;
const LINKED = 20;

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

const registerAndLogin = (name: string): Promise<MatrixSession & { username: string }> =>
  registerDisposableUser(`cdl_${name}_${RUN}`, PASSWORD);

const seed = async (label: string) => {
  const reader = await registerAndLogin(`reader_${label}`);
  const agent = await registerAgentAccount(HOMESERVER, `triage_${label}`);
  for (let index = 1; index <= 24; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index}` });
  }
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Engineering triage',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  let linkedRootId = '';
  for (let index = 1; index <= ROOTS; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Ticket ${index}: the nightly export for region ${
        index % 7
      } times out after the schema change.`,
    });
    // Each thread's reply comes right after its root, so the Last Reply order keeps the room's.
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Looked at ticket ${index}: the export query needs the new index, patch is ready.`,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
    if (index === LINKED) linkedRootId = rootId;
  }
  return { reader, roomId, linkedRootId };
};

const cardShown = (page: Page, rootId: string) =>
  page.evaluate((id) => {
    const card = document.querySelector(`[data-thread-root-id="${CSS.escape(id)}"]`);
    if (!card) return false;
    const rect = card.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.left + Math.min(rect.width / 2, 120),
      rect.top + rect.height / 2
    );
    return !!hit && (card.contains(hit) || hit.contains(card));
  }, rootId);

const checkExit = async (page: Page, seeded: Awaited<ReturnType<typeof seed>>, label: string) => {
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seeded.reader.username,
    password: PASSWORD,
  });
  await page.goto(
    `/home/${encodeURIComponent(seeded.roomId)}?threadId=${encodeURIComponent(seeded.linkedRootId)}`
  );
  const banner = page.locator('[data-thread-context-banner]');
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`Looked at ticket ${LINKED}:`).first()).toBeVisible({
    timeout: 30_000,
  });
  await banner.getByRole('button').first().click();
  await expect(page.locator('[data-compact-room-view="true"]')).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() => cardShown(page, seeded.linkedRootId), {
      message: `the linked thread's card shows after leaving it (${label})`,
      timeout: 15_000,
    })
    .toBe(true);
  await page.waitForTimeout(1_500);
  expect(await cardShown(page, seeded.linkedRootId), `the card stays shown (${label})`).toBe(true);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label}.png` });
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

    test(`leaving a linked thread shows its card in Compact (Chromium, ${form})`, async ({
      page,
    }) => {
      test.setTimeout(240_000);
      const seeded = await seed(`c${form[0]}`);
      await checkExit(page, seeded, `chromium-${form}`);
    });

    test(`leaving a linked thread shows its card in Compact (WebKit, ${form})`, async ({
      baseURL,
    }) => {
      test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
      test.setTimeout(240_000);
      const seeded = await seed(`w${form[0]}`);
      // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
      const browser = await launchWebKit();
      try {
        const context = await browser.newContext({ ...options, baseURL });
        const page = await context.newPage();
        await checkExit(page, seeded, `webkit-${form}`);
      } finally {
        await browser.close();
      }
    });
  });
}
