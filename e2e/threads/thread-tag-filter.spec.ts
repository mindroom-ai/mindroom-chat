import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  sendStateEvent,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import { CHROMIUM_WITH_SCROLLBARS } from '../helpers/disposableAccounts';

// The thread filter bar's Tags dropdown in a room with 32 threads and 8 tags: it lists the tags,
// most used first, with their thread counts; its search narrows them; two tags chosen with the
// keyboard keep the threads that carry both (tag filters combine with AND, as they did before
// the dropdown); the button names a lone tag; the choice survives a reload; Clear brings every
// thread back; a tag the search excludes shows checked and marked; and on a phone with touch the
// People and Tags panels open inside the screen and close on a second tap of their button. A
// second press or tap on the Preset button closes its list too, and a filter toggle tapped back to
// where it started keeps no hover tint.
// Classic scrollbars are shown, in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names
// Playwright's WebKit, in WebKit.
// Set L28_SHOTS=<directory> to save the L28 screenshots (Chromium only).
const SHOTS = process.env.L28_SHOTS;
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

test.use({
  viewport: DESKTOP,
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

const TOPICS = [
  'Fix the login timeout on slow networks',
  'Profile the search API under load',
  'Redesign the settings page header',
  'Dark mode contrast on the composer',
  'Flaky upload test on the build server',
  'Write the backup and restore guide',
  'Crash when a room has no name',
  'Keyboard shortcuts for thread navigation',
  'Typo in the welcome email',
  'Rate limits for the export endpoint',
  'Update the API reference',
  'Compare vector stores for memory',
  'Duplicate notifications after reconnect',
  'Move the staging database to faster disks',
  'Broken link in the onboarding checklist',
  'Retry policy for webhook delivery',
  'New empty state illustrations',
  'Pagination for the members list',
  'Session expires during long uploads',
  'Sidebar collapses on narrow windows',
  'Translate the release notes',
  'Rotate the deploy keys',
  'Wrong time zone in scheduled tasks',
  'Icon set for the canvas toolbar',
  'Memory leak in the sync worker',
  'Document the plugin manifest fields',
  'Search highlights miss accented words',
  'Avatar upload fails above 5 MB',
  'Cache headers for static assets',
  'Disk alerts for the worker nodes',
  'Release checklist for the next version',
  'Interview notes on team workflows',
];

/** The tags of thread `index`: 62 tags over 32 threads, each tag on a different share of them. */
const tagsOf = (index: number): string[] =>
  [
    index % 2 === 0 && 'bug',
    index % 3 === 0 && 'urgent',
    index % 4 === 1 && 'backend',
    index % 4 === 3 && 'frontend',
    index % 5 === 0 && 'docs',
    index % 7 === 2 && 'design',
    index % 8 === 5 && 'infra',
    [1, 11, 31].includes(index) && 'research',
  ].filter((tag): tag is string => typeof tag === 'string');

/** The tags most used first (backend and frontend tie and go by name), with their counts. */
const TAG_COUNTS: Array<[string, number]> = [
  ['bug', 16],
  ['urgent', 11],
  ['backend', 8],
  ['frontend', 8],
  ['docs', 7],
  ['design', 5],
  ['infra', 4],
  ['research', 3],
];

const threadRelation = (rootId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: rootId },
});

/** A room with an agent and the 32 tagged threads, each a question of mine and the agent's reply. */
const seedRoom = async (homeserver: string, me: MatrixSession): Promise<string> => {
  const roomId = await createPrivateRoom(homeserver, me.accessToken, {
    name: 'Release planning',
    topic: 'Thirty-two threads and eight tags',
  });
  const agent = await registerAgentAccount(homeserver, 'helper');
  await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/invite`, {
    method: 'POST',
    accessToken: me.accessToken,
    body: JSON.stringify({ user_id: agent.userId }),
  });
  await joinRoom(homeserver, agent.accessToken, roomId);
  for (const [index, topic] of TOPICS.entries()) {
    // eslint-disable-next-line no-await-in-loop
    const rootId = await sendRoomMessage(homeserver, me.accessToken, roomId, {
      msgtype: 'm.text',
      body: topic,
    });
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(homeserver, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Looking into it: ${topic.toLowerCase()}.`,
      'm.relates_to': threadRelation(rootId),
    });
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(
      tagsOf(index).map((tag) =>
        sendStateEvent(
          homeserver,
          me.accessToken,
          roomId,
          'com.mindroom.thread.tags',
          JSON.stringify([rootId, tag]),
          { set_by: me.userId, set_at: new Date().toISOString() }
        )
      )
    );
  }
  return roomId;
};

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** The titles of the threads whose index passes `keep`. */
const topicsWhere = (keep: (index: number) => boolean) =>
  TOPICS.filter((_topic, index) => keep(index));

const expectCards = async (cards: Locator, topics: string[]) => {
  await expect(cards).toHaveCount(topics.length);
  for (const topic of topics) {
    // eslint-disable-next-line no-await-in-loop
    await expect(cards.filter({ hasText: topic })).toHaveCount(1);
  }
};

/** The seeded room's thread cards and the filter bar's Tags dropdown on `page`. */
const tagFilterOf = (page: Page) => {
  const overview = page.locator('[data-room-thread-overview]');
  const panel = overview.locator('[data-tag-filter-panel]');
  const option = (tag: string) => panel.locator(`[data-tag-option="${tag}"]`);
  return {
    cards: page.locator('[data-compact-room-view] [data-thread-root-id]'),
    overview,
    button: overview.locator('[data-tag-filter-button]'),
    panel,
    search: panel.locator('[data-tag-filter-search]'),
    options: panel.locator('[data-tag-option]'),
    option,
    box: (tag: string) => option(tag).locator('input[type="checkbox"]'),
  };
};

/**
 * The Preset button opens its list, and a second press closes it and keeps it closed. Safari
 * focuses no button on a press, so the press took the focus from the open list to nothing, the
 * list closed on that blur, and the click opened it again.
 */
const checkPresetToggle = async (page: Page, press: (target: Locator) => Promise<void>) => {
  const overview = page.locator('[data-room-thread-overview]');
  const button = overview.locator('[data-preset-button]');
  const list = overview.locator('[data-preset-dropdown]');
  await press(button);
  await expect(list).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await press(button);
  await expect(list).toHaveCount(0);
  // Not opened again a moment later either.
  await page.waitForTimeout(300);
  await expect(list).toHaveCount(0);
  await expect(button).toHaveAttribute('aria-expanded', 'false');
};

/** A button's fill. */
const fill = (button: Locator) =>
  button.evaluate((element) => getComputedStyle(element).backgroundColor);

/**
 * Taps a toggle until it is back in the state it started in, and checks that it then looks as it
 * did: a touch screen keeps :hover on the button tapped last, and the hover tint made a toggle
 * tapped off look on.
 */
const expectRestAfterTaps = async (
  page: Page,
  button: Locator,
  state: string,
  engine: string,
  name: string
) => {
  const rest = await fill(button);
  const start = await button.getAttribute(state);
  for (let taps = 0; taps < 3; taps += 1) {
    // eslint-disable-next-line no-await-in-loop
    await button.tap();
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(300);
    // eslint-disable-next-line no-await-in-loop
    if ((await button.getAttribute(state)) === start) break;
  }
  await expect(button).toHaveAttribute(state, start ?? '');
  // The fill's transition ends first.
  await page.waitForTimeout(300);
  expect.soft(await fill(button), `${engine}: ${name} looks as it did before the taps`).toBe(rest);
};

/** Everything the dropdown does, on a signed-in page that shows the seeded room. */
const checkTagFilter = async (page: Page, engine: string) => {
  const { cards, overview, button, panel, search, options, option, box } = tagFilterOf(page);
  await expect(cards).toHaveCount(TOPICS.length, { timeout: 120_000 });

  // The Tags dropdown is one of the advanced filters, beside People.
  await overview.locator('[data-thread-filter-mode-switch]').click();
  await expect(button).toHaveAttribute('data-tag-filter-count', '0');
  await expect(button).toHaveText('Tags');
  await expect(overview.locator('[data-add-tag-button]')).toHaveCount(0);
  await checkPresetToggle(page, (target) => target.click());
  if (engine === 'chromium') {
    await page.mouse.move(1, 1);
    await shot(page, 'L28-thread-tags-closed');
  }

  await button.click();
  await expect(search).toBeFocused();
  await expect(options).toHaveCount(TAG_COUNTS.length);
  expect(
    await options.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-tag-option')))
  ).toEqual(TAG_COUNTS.map(([tag]) => tag));
  for (const [tag, count] of TAG_COUNTS) {
    // eslint-disable-next-line no-await-in-loop
    await expect(option(tag)).toHaveText(`${tag}${count}`);
  }

  // Search, then choose with the keyboard: Space checks one tag, Enter the other.
  await search.fill('ur');
  await expect(options).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await expect(box('urgent')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(box('urgent')).toBeChecked();
  await expect(button).toHaveText('urgent');
  await expectCards(
    cards,
    topicsWhere((index) => index % 3 === 0)
  );
  await search.fill('BU');
  await expect(options).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await expect(box('bug')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(box('bug')).toBeChecked();
  await expect(button).toHaveAttribute('data-tag-filter-count', '2');
  await expect(button).toHaveText(/^Tags\s*2$/);
  // The threads that carry both tags.
  const both = topicsWhere((index) => index % 6 === 0);
  await expectCards(cards, both);
  await expect(overview.locator('[data-thread-count]')).toHaveText(String(both.length));

  // Up from the search wraps to the last row; Escape empties the search before it closes.
  await search.focus();
  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('');
  await expect(options).toHaveCount(TAG_COUNTS.length);
  await page.keyboard.press('ArrowUp');
  await expect(panel.locator('[data-tag-filter-clear]')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(box('research')).toBeFocused();
  if (engine === 'chromium') {
    await search.focus();
    await shot(page, 'L28-thread-tags-open');
  }
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(button).toBeFocused();

  // The choice is stored with the room's other filters.
  await page.reload();
  await expectCards(cards, both);
  await expect(button).toHaveAttribute('data-tag-filter-count', '2');

  // With the mouse: unchecking one tag names the other on the button.
  await button.click();
  await option('bug').click();
  await expect(box('bug')).not.toBeChecked();
  await expect(button).toHaveText('urgent');
  await expect(cards).toHaveCount(11);

  // Clear brings every thread back and keeps the panel open on its search.
  await panel.locator('[data-tag-filter-clear]').click();
  await expect(button).toHaveAttribute('data-tag-filter-count', '0');
  await expect(cards).toHaveCount(TOPICS.length);
  await expect(panel.locator('[data-tag-filter-clear]')).toHaveCount(0);
  await expect(search).toBeFocused();
  // A second press on the button closes the dropdown.
  await button.click();
  await expect(panel).toHaveCount(0);

  // A tag excluded in the thread search shows checked and marked; unchecking it drops that filter.
  await overview.locator('[data-search-toggle]').click();
  await overview.locator('[data-search-input]').fill('-tag:docs');
  await expect(cards).toHaveCount(TOPICS.length - 7);
  await button.click();
  await expect(box('docs')).toBeChecked();
  await expect(option('docs')).toContainText('Excluded');
  await expect(option('bug')).not.toContainText('Excluded');
  await option('docs').click();
  await expect(cards).toHaveCount(TOPICS.length);
  await expect(button).toHaveAttribute('data-tag-filter-count', '0');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
};

/**
 * On a phone with touch, a new page of `browser`: the People and Tags panels open inside the
 * screen and close on a second tap of their button, and tapping two tags filters the threads.
 */
const checkPhone = async (
  browser: Browser,
  baseURL: string | undefined,
  homeserver: string,
  credentials: { username: string; password: string },
  roomId: string,
  engine: string
) => {
  const context = await browser.newContext({ ...PHONE, baseURL });
  try {
    const page = await context.newPage();
    await loginWithPassword(page, { homeserver, ...credentials });
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    const { cards, overview, button, panel, option } = tagFilterOf(page);
    await expect(cards).toHaveCount(TOPICS.length, { timeout: 120_000 });
    await expectRestAfterTaps(
      page,
      overview.locator('[data-simple-unresolved-toggle]'),
      'aria-pressed',
      engine,
      'Unresolved'
    );
    await overview.locator('[data-thread-filter-mode-switch]').tap();
    await checkPresetToggle(page, (target) => target.tap());
    await expectRestAfterTaps(
      page,
      overview.locator('[data-filter-key="streaming"]'),
      'data-filter-state',
      engine,
      'the streaming status toggle'
    );
    for (const name of ['people', 'tag']) {
      const trigger = overview.locator(`[data-${name}-filter-button]`);
      // eslint-disable-next-line no-await-in-loop
      await trigger.tap();
      const opened = overview.locator(`[data-${name}-filter-panel]`);
      // eslint-disable-next-line no-await-in-loop
      await expect(opened).toBeVisible();
      // eslint-disable-next-line no-await-in-loop
      const bounds = await opened.boundingBox();
      expect(bounds, `${engine} ${name} panel`).not.toBeNull();
      expect(bounds!.x, `${engine} ${name} panel start`).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width, `${engine} ${name} panel end`).toBeLessThanOrEqual(
        PHONE.viewport.width
      );
      if (name === 'people') {
        // eslint-disable-next-line no-await-in-loop
        await trigger.tap();
        // eslint-disable-next-line no-await-in-loop
        await expect(opened).toHaveCount(0);
      }
    }
    await option('bug').tap();
    await option('urgent').tap();
    await expect(button).toHaveAttribute('data-tag-filter-count', '2');
    await expectCards(
      cards,
      topicsWhere((index) => index % 6 === 0)
    );
    if (engine === 'chromium') await shot(page, 'L28-thread-tags-phone');
    await button.tap();
    await expect(panel).toHaveCount(0);
  } finally {
    await context.close();
  }
};

test.describe('thread Tags filter', () => {
  test.skip(!hasPrimaryCredentials(), 'Requires a Matrix test account');

  test('searches, keeps the threads with every chosen tag, clears, and fits a phone (Chromium)', async ({
    page,
    browser,
    baseURL,
  }) => {
    // 32 threads with 62 tags, two sign-ins, a reload and a loaded machine.
    test.setTimeout(360_000);
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const me = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const roomId = await seedRoom(homeserver, me);
    await loginWithPassword(page, { homeserver, ...credentials });
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    await checkTagFilter(page, 'chromium');
    await checkPhone(browser, baseURL, homeserver, credentials, roomId, 'chromium');
  });

  test('searches, keeps the threads with every chosen tag, clears, and fits a phone (WebKit)', async ({
    baseURL,
  }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    test.setTimeout(360_000);
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const me = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const roomId = await seedRoom(homeserver, me);
    // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
    const browser = await launchWebKit();
    try {
      const context = await browser.newContext({ viewport: DESKTOP, baseURL });
      const page = await context.newPage();
      await loginWithPassword(page, { homeserver, ...credentials });
      await page.goto(`/home/${encodeURIComponent(roomId)}`);
      await checkTagFilter(page, 'webkit');
      await checkPhone(browser, baseURL, homeserver, credentials, roomId, 'webkit');
    } finally {
      await browser.close();
    }
  });
});
