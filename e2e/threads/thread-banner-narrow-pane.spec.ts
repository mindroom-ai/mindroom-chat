import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { joinRoom, sendRoomMessage, sendStateEvent } from '../helpers/matrix';

// On a desktop (1400 by 900) a thread shown beside the room's messages has a narrow banner (456 px
// until its column is resized). It takes a phone's layout there, as it does on a phone: no tags
// row and no pin button (More has both), the whole title wrapping, and the buttons stacked beside a
// title as tall as them. Filling the page, the same thread's banner keeps its tags and the pin.
// Runs against the disposable homeserver of `just hs-up` (or a slot of scripts/e2e-slot.sh).
const PASSWORD = 'thread-banner-narrow-pane-spec-password';
const RUN = Date.now().toString(36);
const TITLE =
  '🧪 Example thread with a long title that wraps onto several lines in a narrow pane beside the room, so the buttons stack beside it';
const TAGS = ['alpha', 'beta'];
const LAYOUT_KEY = 'mindroom.threadColumn.layout';

test.use({ viewport: { width: 1400, height: 900 } });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const banner = (page: Page) => page.locator('[data-thread-context-banner="true"]');

const expectSymmetricBannerMargins = async (threadBanner: Locator) => {
  await expect
    .poll(() =>
      threadBanner.evaluate((element) => {
        const scroll = element.closest<HTMLElement>('[data-y-scrollbar-width]');
        if (!scroll) throw new Error('Thread banner has no scroll container');
        const bannerRect = element.getBoundingClientRect();
        const scrollRect = scroll.getBoundingClientRect();
        const left = bannerRect.left - scrollRect.left;
        const right = scrollRect.right - bannerRect.right;
        return {
          symmetric: Math.abs(left - right) <= 1,
          leftNearS300: Math.abs(left - 12) <= 1,
          rightNearS300: Math.abs(right - 12) <= 1,
          noHorizontalOverflow: scroll.scrollWidth <= scroll.clientWidth,
        };
      })
    )
    .toEqual({
      symmetric: true,
      leftNearS300: true,
      rightNearS300: true,
      noHorizontalOverflow: true,
    });
};

test('a narrow thread pane on a desktop gets the compact banner, a full one keeps its tags', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const reader = await registerDisposableUser(`bnp_reader_${RUN}`, PASSWORD);
  const agent = await registerDisposableUser(`mindroom_bnp_agent_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Example room',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: TITLE,
  });
  const replyId = await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Example reply in the thread.',
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });
  await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.notice',
    body: TITLE,
    'io.mindroom.thread_summary': {
      version: 1,
      summary: TITLE,
      generated_at: Date.now(),
      message_count: 2,
    },
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: replyId },
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
  await page.evaluate((key) => window.localStorage.setItem(key, '"beside"'), LAYOUT_KEY);
  const threadUrl = `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`;
  await page.goto(threadUrl);
  const column = page.getByTestId('thread-column');
  await expect(column).toBeVisible({ timeout: 30_000 });
  await expect(column).not.toHaveAttribute('data-filled', 'true');
  const narrow = column.locator('[data-thread-context-banner="true"]');
  const more = narrow.getByRole('button', { name: 'Thread options', exact: true });
  const resolve = narrow.getByRole('button', { name: 'Resolve', exact: true });
  await expect(more).toBeEnabled({ timeout: 30_000 });
  await expect(resolve).toBeVisible();
  expect((await narrow.boundingBox())!.width).toBeLessThan(36 * 16);
  await expectSymmetricBannerMargins(narrow);

  // No tags row, no "+ tag" and no pin button: More has them.
  for (const tag of TAGS) {
    // eslint-disable-next-line no-await-in-loop
    await expect(narrow.getByText(tag, { exact: true })).toHaveCount(0);
  }
  await expect(narrow.getByRole('button', { name: 'Add tag', exact: true })).toHaveCount(0);
  await expect(narrow.getByRole('button', { name: /^(Pin|Unpin) thread$/ })).toHaveCount(0);

  // The whole title, wrapping, with the buttons stacked beside it.
  const title = narrow.locator('[data-thread-context-summary="true"]');
  await expect(title).toHaveText(TITLE);
  const lines = await title.evaluate((element) => {
    const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
    return element.getBoundingClientRect().height / lineHeight;
  });
  expect(lines).toBeGreaterThan(1.5);
  // With no tags and no status chip, the row above the title is empty: hidden, and the title
  // has no gap above it.
  const aboveTitle = await title.evaluate((element) => {
    let column: Element | null = element;
    while (column && getComputedStyle(column).containerType !== 'inline-size') {
      column = column.parentElement;
    }
    const [eyebrow, subtitle] = [...(column?.children ?? [])];
    return {
      eyebrowChildren: eyebrow?.childNodes.length,
      eyebrow: eyebrow && getComputedStyle(eyebrow).display,
      gap: subtitle && getComputedStyle(subtitle).marginTop,
    };
  });
  expect(aboveTitle).toEqual({ eyebrowChildren: 0, eyebrow: 'none', gap: '0px' });
  await expect
    .poll(async () => {
      const [moreBox, resolveBox] = [(await more.boundingBox())!, (await resolve.boundingBox())!];
      return {
        under: resolveBox.y >= moreBox.y + moreBox.height - 0.5,
        aligned: Math.abs(resolveBox.x - moreBox.x) < 1,
      };
    })
    .toEqual({ under: true, aligned: true });

  // More lists the tags.
  await more.click();
  const menu = page.getByRole('menu');
  await expect(menu.getByText('alpha', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  // Filling the page, the banner is wide and keeps the tags beside the buttons in one row.
  await page.evaluate((key) => window.localStorage.setItem(key, '"full"'), LAYOUT_KEY);
  await page.goto(threadUrl);
  const threadBanner = banner(page).first();
  await expect(threadBanner.getByText('alpha', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(threadBanner.getByRole('button', { name: 'Add tag', exact: true })).toBeVisible();
  await expect(threadBanner.getByRole('button', { name: 'Pin thread', exact: true })).toBeVisible();
  await expectSymmetricBannerMargins(threadBanner);
  const [moreBox, resolveBox] = await Promise.all([
    threadBanner.getByRole('button', { name: 'Thread options', exact: true }).boundingBox(),
    threadBanner.getByRole('button', { name: 'Resolve', exact: true }).boundingBox(),
  ]);
  expect(Math.abs(moreBox!.y - resolveBox!.y)).toBeLessThan(1);

  // Its More lists the tags as an item, not at its top.
  await threadBanner.getByRole('button', { name: 'Thread options', exact: true }).click();
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-thread-menu-tags]')).toHaveCount(0);

  // Shown beside the messages from More, the thread's narrow banner is compact.
  await menu.getByRole('menuitem', { name: 'Show the thread beside the messages' }).click();
  await expect(column).not.toHaveAttribute('data-filled', 'true');
  const beside = column.locator('[data-thread-context-banner="true"]');
  await expect(beside.getByRole('button', { name: 'Thread options', exact: true })).toBeVisible();
  await expect(beside.getByText('alpha', { exact: true })).toHaveCount(0);
  await expect(beside.getByRole('button', { name: 'Pin thread', exact: true })).toHaveCount(0);
  await expectSymmetricBannerMargins(beside);
});
