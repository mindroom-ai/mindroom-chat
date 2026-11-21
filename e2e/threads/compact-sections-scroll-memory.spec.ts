import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  createDefaultThreadFilterState,
  joinRoom,
  registerAgentAccount,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// A phone reader in the Compact room's sections (Needs you first, then Working) opens a card from
// either section and comes back with the thread's Back: the cards must be where they were. The
// room was entered from a thread link, so its address asks for that card (`?focusEvent=1`); the
// iOS app's Back puts the room's address back in the thread's place, which must not take that
// request again. Against the disposable homeserver of a slot (scripts/e2e-slot.sh). With SHOTS
// set to a directory, it saves the phone screen right after the Back from a Needs you card there.
const PASSWORD = 'sections-scroll-spec-password';
const RUN = Date.now().toString(36);
const COMPACT_VIEW = '[data-compact-room-view="true"]:not([inert] *)';
const WORKING = 14;
const NEEDS_YOU = 10;
const FAKE_IOS_KEY = 'sections-scroll-fake-ios';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** Capacitor as the iOS app has it, once the test sets FAKE_IOS_KEY: the iOS platform. */
function fakeIOS(key: string) {
  if (localStorage.getItem(key) !== '1') return;
  const win = window as unknown as Record<string, unknown>;
  win.CapacitorCustomPlatform = { name: 'ios', plugins: {} };
  win.Capacitor = {
    PluginHeaders: [],
    nativeCallback: () => '1',
    nativePromise: () => Promise.resolve({}),
  };
}

const inThread = (rootId: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

/** Once the list stops moving: each card fully in view below the glass header, by its top. */
const settledCards = (
  page: Page
): Promise<{ scrollTop: number; offsets: Record<string, number> }> =>
  page.evaluate(async (selector) => {
    const view = document.querySelector<HTMLElement>(selector)!;
    let previous = view.scrollTop;
    for (let stable = 0, frames = 0; stable < 5 && frames < 120; frames += 1) {
      await new Promise((resolve) => {
        requestAnimationFrame(resolve);
      });
      stable = view.scrollTop === previous ? stable + 1 : 0;
      previous = view.scrollTop;
    }
    const { top, bottom } = view.getBoundingClientRect();
    const header = parseFloat(getComputedStyle(view).paddingTop);
    const offsets: Record<string, number> = {};
    view.querySelectorAll<HTMLElement>('[data-scroll-anchor]').forEach((row) => {
      const rect = row.getBoundingClientRect();
      if (rect.top >= top + header && rect.bottom <= bottom) {
        offsets[row.dataset.scrollAnchor!] = rect.top - top;
      }
    });
    return { scrollTop: view.scrollTop, offsets };
  }, COMPACT_VIEW);

const scrollTo = (page: Page, scrollTop: number) =>
  page.evaluate(
    ([selector, value]) => {
      const view = document.querySelector<HTMLElement>(selector)!;
      // Model the reader taking control before advancing to an exact pixel offset.
      view.dispatchEvent(new WheelEvent('wheel', { deltaY: value - view.scrollTop }));
      view.scrollTop = value;
    },
    [COMPACT_VIEW, scrollTop] as const
  );

/** The scroll position that shows the Working header just below the glass header. */
const workingScrollTop = async (page: Page) => {
  await expect(page.locator(COMPACT_VIEW)).not.toHaveAttribute('data-cards-pending', 'true');
  return page.evaluate((selector) => {
    const view = document.querySelector<HTMLElement>(selector)!;
    const header = view.querySelector<HTMLElement>('[data-compact-section="working"]')!;
    const offset = header.getBoundingClientRect().top - view.getBoundingClientRect().top;
    return Math.round(view.scrollTop + offset - parseFloat(getComputedStyle(view).paddingTop) - 40);
  }, COMPACT_VIEW);
};

const clickThreadExitButton = (page: Page) =>
  page.evaluate(() => {
    const exitButton = document.querySelector('[data-thread-context-banner] button');
    if (!(exitButton instanceof HTMLButtonElement)) throw new Error('Thread exit button not found');
    exitButton.click();
  });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

for (const ios of [false, true]) {
  test(`a phone reader comes back to the cards they left in either section${
    ios ? ' (iOS app)' : ''
  }`, async ({ page, context }) => {
    test.setTimeout(240_000);
    const form = ios ? 'i' : 'w';
    const reader = await registerDisposableUser(`ssm_${form}${RUN}`, PASSWORD);
    const agent = await registerAgentAccount(HOMESERVER, `sections_${form}${RUN}`);
    const roomId = await createRoom(HOMESERVER, reader.accessToken, {
      name: 'Placeholder Desk',
      invite: [agent.userId],
    });
    await joinRoom(HOMESERVER, agent.accessToken, roomId);
    const roots: string[] = [];
    for (let index = 0; index < WORKING + NEEDS_YOU; index += 1) {
      roots.push(
        await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
          msgtype: 'm.text',
          body: `Placeholder task ${index + 1}`,
        })
      );
    }

    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: reader.username,
      password: PASSWORD,
    });
    await seedRoomOverviewState({
      page,
      roomId,
      userId: reader.userId,
      viewMode: 'compact',
      filterState: createDefaultThreadFilterState(),
    });
    await page.evaluate((userId) => {
      localStorage.setItem(
        `compactRoomSections:${userId}`,
        JSON.stringify({ on: true, folded: [] })
      );
    }, reader.userId);
    if (ios) {
      await context.addInitScript(fakeIOS, FAKE_IOS_KEY);
      await page.evaluate((key) => localStorage.setItem(key, '1'), FAKE_IOS_KEY);
    }
    await page.goto(`/home/${encodeURIComponent(roomId)}/`);
    const card = (rootId: string) =>
      page.locator(`${COMPACT_VIEW} [data-thread-root-id="${rootId}"]`).first();
    const view = page.locator(COMPACT_VIEW);
    await expect(view).toHaveAttribute('data-compact-card-count', String(roots.length), {
      timeout: 60_000,
    });

    // An agent starts on the first WORKING threads while the reader watches, as MindRoom does.
    for (const rootId of roots.slice(0, WORKING)) {
      await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
        msgtype: 'm.text',
        body: 'Thinking...',
        'io.mindroom.stream_status': 'pending',
        ...inThread(rootId),
      });
    }
    await expect(page.locator('[data-compact-section="working"]')).toHaveText(
      new RegExp(`· ${WORKING}$`),
      { timeout: 30_000 }
    );
    const needsYou = '[data-compact-section="needsYou"]';
    await expect(view.locator(needsYou)).toHaveText(new RegExp(`· ${NEEDS_YOU}$`));
    await scrollTo(page, 0);
    await expect(view.locator(needsYou)).toBeInViewport();

    await expect(page.locator(`${COMPACT_VIEW} [data-compact-section]`).first()).toHaveAttribute(
      'data-compact-section',
      'needsYou'
    );

    // The reader enters the room from a thread's link (a notification, Activity) and leaves that
    // thread for the room: the room's address now asks for the thread's card, near the top.
    const linked = await page
      .locator(`${COMPACT_VIEW} [data-thread-root-id]`)
      .nth(1)
      .getAttribute('data-thread-root-id');
    await page.goto(`/home/${encodeURIComponent(roomId)}/?threadId=${encodeURIComponent(linked!)}`);
    await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
    await clickThreadExitButton(page);
    await expect(page).toHaveURL(/focusEvent=1/);
    // Wait for the Back slide to finish: it can still cover the room after the URL and cards
    // return.
    const pageSlide = page.locator('html[data-page-slide]');
    await expect(pageSlide).toHaveCount(0);
    await expect(card(linked!)).toBeInViewport();
    await expect(page.locator('[data-page-slide-copy]')).toHaveCount(0);

    const visitAndReturn = async (
      scrollTop: number,
      section: 'working' | 'needsYou',
      leave: () => Promise<unknown>,
      shot?: string
    ) => {
      await scrollTo(page, scrollTop);
      const before = await settledCards(page);
      const sectionIds = new Set(
        section === 'working' ? roots.slice(0, WORKING) : roots.slice(WORKING)
      );
      // The room footer can cover a card entirely inside the raw scroll clip.
      const target = await view.evaluate(
        (scroller, candidates) => {
          for (const id of candidates) {
            const button = scroller.querySelector(
              `button[data-thread-root-id="${CSS.escape(id)}"]`
            );
            if (!button) continue;
            const { x, y, width, height } = button.getBoundingClientRect();
            const point = { x: x + width / 2, y: y + height / 2 };
            if (button.contains(document.elementFromPoint(point.x, point.y))) return point;
          }
          return undefined;
        },
        Object.keys(before.offsets).filter((key) => sectionIds.has(key))
      );
      if (!target) throw new Error(`no tappable ${section} card in view at ${scrollTop}`);
      await page.touchscreen.tap(target.x, target.y);
      await expect(page).toHaveURL(/threadId=/);
      const opened = new URL(page.url()).searchParams.get('threadId')!;
      expect(sectionIds.has(opened), `the tap opens a ${section} card`).toBe(true);
      await expect(page.locator('[data-thread-context-banner]')).toBeVisible();
      await expect(pageSlide).toHaveCount(0);
      await leave();
      await expect(page).not.toHaveURL(/threadId=/);
      await expect(pageSlide).toHaveCount(0);
      await expect(card(opened)).toBeAttached();
      await expect(page.locator('[data-page-slide-copy]')).toHaveCount(0);
      const after = await settledCards(page);
      if (shot && process.env.SHOTS)
        await page.screenshot({ path: `${process.env.SHOTS}/${shot}` });
      for (const [key, offset] of Object.entries(before.offsets)) {
        expect(
          Math.abs((after.offsets[key] ?? Number.NaN) - offset),
          `${section}: row ${key} moved from ${offset} to ${after.offsets[key]} (scrollTop ${before.scrollTop} → ${after.scrollTop})`
        ).toBeLessThanOrEqual(2);
      }
    };

    await test.step('Needs you card, Back', async () => {
      await visitAndReturn(
        120,
        'needsYou',
        () => clickThreadExitButton(page),
        ios ? 'needs-you-back.png' : undefined
      );
    });
    await test.step('Working card, Back', async () => {
      await visitAndReturn(await workingScrollTop(page), 'working', () =>
        clickThreadExitButton(page)
      );
    });
    await test.step('another Working card, near the bottom, Back', async () => {
      await visitAndReturn(100_000, 'working', () => clickThreadExitButton(page));
    });
    if (!ios) {
      await test.step('Working card, browser Back', async () => {
        await visitAndReturn(await workingScrollTop(page), 'working', () => page.goBack());
      });
    }
  });
}
