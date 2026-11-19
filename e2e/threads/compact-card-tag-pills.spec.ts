import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import {
  createDefaultThreadFilterState,
  joinRoom,
  seedRoomOverviewState,
  sendRoomMessage,
  sendStateEvent,
} from '../helpers/matrix';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A Compact card on a phone shows a few whole tags and "+N" for the rest, as the thread banner
// does: every tag of a card with six shrank to one to three letters ("b...", "d.."), and in Arabic
// an English tag lost its start instead of its end (live-test finding P2-lane4-F008). Checked on a
// phone (390 by 844, touch) in Chromium, in English and Arabic, and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. Set CARD_TAG_SHOTS=<directory>
// for screenshots.
const PASSWORD = 'compact-card-tag-pills-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.CARD_TAG_SHOTS;
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const TAGS = ['bug', 'billing', 'documentation', 'release', 'urgent', 'customer-facing'];

test.use(PHONE);

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

type PillState = { text: string; whole: boolean; direction: string };

/** Each tag pill on the card: its label, whether it shows whole, and its direction. */
const pillStates = (page: Page, rootId: string): Promise<PillState[]> =>
  page.locator(`[data-thread-root-id="${rootId}"] .thread-tag-pill`).evaluateAll((pills) =>
    pills.map((pill) => {
      const label = (pill.firstElementChild as HTMLElement | null) ?? (pill as HTMLElement);
      return {
        text: label.textContent ?? '',
        whole: label.scrollWidth <= label.clientWidth + 1,
        direction: getComputedStyle(label).direction,
      };
    })
  );

const tagsStayReadable = async (page: Page, label: string) => {
  const reader = await registerDisposableUser(`cctp_reader_${label}_${RUN}`, PASSWORD);
  const agent = await registerDisposableUser(`mindroom_triage_${label}_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: `Support queue ${label}`,
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Invoices for the annual plan show the wrong tax rate since the last release.',
  });
  await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'I found the rate table change and drafted a fix for review.',
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });
  for (const tag of TAGS) {
    // eslint-disable-next-line no-await-in-loop
    await sendStateEvent(
      HOMESERVER,
      reader.accessToken,
      roomId,
      'com.mindroom.thread.tags',
      JSON.stringify([rootId, tag]),
      { set_by: reader.userId, set_at: new Date().toISOString() }
    );
  }

  await loginWithPassword(page, { homeserver: HOMESERVER, ...reader });
  await seedRoomOverviewState({
    page,
    roomId,
    userId: reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  const check = async (language: string) => {
    await page.goto(`/home/${encodeURIComponent(roomId)}/`);
    const card = page.locator(`[data-thread-root-id="${rootId}"]`).first();
    await expect(card.locator('.thread-tag-pill').first()).toBeVisible({ timeout: 30_000 });
    if (SHOTS) await card.screenshot({ path: `${SHOTS}/card-tags-${label}-${language}.png` });
    const pills = await pillStates(page, rootId);
    pills.forEach((pill) => {
      expect(pill.whole, `the ${pill.text} tag shows whole (${language})`).toBe(true);
      // An English tag reads left to right in an Arabic interface too, so it keeps its start.
      expect(pill.direction, `the ${pill.text} tag's direction (${language})`).toBe('ltr');
    });
    const hidden = TAGS.length - pills.length;
    if (hidden > 0) await expect(card.getByText(`+${hidden}`, { exact: true })).toBeVisible();
  };
  await check('en');
  await page.evaluate(() => localStorage.setItem('i18nextLng', 'ar'));
  await check('ar');
  await page.evaluate(() => localStorage.setItem('i18nextLng', 'en'));
};

test('a phone card shows whole tags and a count of the rest (Chromium)', async ({ page }) => {
  test.setTimeout(180_000);
  await tagsStayReadable(page, 'chromium');
});

test('a phone card shows whole tags and a count of the rest (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  await onWebKitPage({ ...PHONE, baseURL }, (page) => tagsStayReadable(page, 'webkit'));
});
