import { expect, test, type Page, type Request } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  joinRoom,
  loginToMatrix,
  matrixFetch,
  sendMessageEdit,
  sendReaction,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// The "New Messages" line, the Jump to Unread pill and read receipts when another account reacts to
// an older message or edits one, in a room the reader has read. While the reader is scrolled up,
// neither puts up a line or a pill or sends a receipt, and neither moves the line above a message
// the reader later watches arrive; at the bottom, each is read at once. A new message that arrives
// while the reader is scrolled up does get the line and the pill. Each case runs in Chromium and,
// when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. Runs against the
// disposable homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh, and registers its own
// accounts.
const PASSWORD = 'unread-line-spec-password';
const RUN = Date.now().toString(36);
const HISTORY = 60;
const VIEWPORT = { width: 1400, height: 900 };
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;

test.use({
  viewport: VIEWPORT,
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const registerAndLogin = async (name: string): Promise<MatrixSession & { username: string }> => {
  const username = `unl_${name}_${RUN}`;
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

/** Moves within the app without reloading it, as its own links do. */
const openPath = (page: Page, path: string) =>
  page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);

/** How far the timeline's scroll area is above its bottom, in px. */
const scrollGap = (page: Page) =>
  page.evaluate(() => {
    let element = document.querySelector<HTMLElement>(
      '[data-testid="room-virtual-inner"]'
    )?.parentElement;
    while (element && !/auto|scroll/.test(getComputedStyle(element).overflowY)) {
      element = element.parentElement;
    }
    if (!element) throw new Error('Timeline scroller missing');
    return Math.round(element.scrollHeight - element.clientHeight - element.scrollTop);
  });

const wheelOverTimeline = async (page: Page, deltaY: number, turns: number) => {
  // The middle of the scroll area: the virtual rows inside it are far taller than the window.
  const center = await page.evaluate(() => {
    let element = document.querySelector<HTMLElement>(
      '[data-testid="room-virtual-inner"]'
    )?.parentElement;
    while (element && !/auto|scroll/.test(getComputedStyle(element).overflowY)) {
      element = element.parentElement;
    }
    if (!element) throw new Error('Timeline scroller missing');
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(center.x, center.y);
  for (let turn = 0; turn < turns; turn += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.mouse.wheel(0, deltaY);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(80);
  }
};

/** The reader turns the wheel down until the timeline is at its bottom. */
const backToBottom = async (page: Page) => {
  await expect
    .poll(
      async () => {
        const gap = await scrollGap(page);
        if (gap > 2) await wheelOverTimeline(page, 1_200, 2);
        return gap;
      },
      { timeout: 30_000 }
    )
    .toBeLessThanOrEqual(2);
};

/** IDs of the message rows that are entirely inside the scroll area, top to bottom. */
const rowsInView = (page: Page) =>
  page.evaluate(() => {
    const inner = document.querySelector<HTMLElement>('[data-testid="room-virtual-inner"]');
    let scroller = inner?.parentElement;
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    if (!scroller) return [];
    const area = scroller.getBoundingClientRect();
    return Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]'))
      .filter((row) => {
        const rect = row.getBoundingClientRect();
        return rect.height > 0 && rect.top >= area.top && rect.bottom <= area.bottom;
      })
      .map((row) => row.getAttribute('data-message-id') ?? '');
  });

/** The rows the "New Messages" lines stand above, by event ID. */
const unreadLineRows = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="separator"]'))
      .filter((separator) => separator.textContent?.includes('New Messages'))
      .map(
        (separator) =>
          separator.parentElement
            ?.querySelector<HTMLElement>('[data-message-id]')
            ?.getAttribute('data-message-id') ?? '?'
      )
  );

type Receipt = { type: string; event: string; thread?: unknown };

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/**
 * A room of `HISTORY` messages from the writer that the reader has read, open at its bottom in the
 * classic view, with the receipts the reader's client sends recorded from then on.
 */
const openReadRoom = async (page: Page, name: string) => {
  const reader = await registerAndLogin(`${name}_reader`);
  const writer = await registerAndLogin(`${name}_writer`);
  const roomName = `Harbor Log ${name} ${RUN}`;
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: roomName,
    invite: [writer.userId],
  });
  await joinRoom(HOMESERVER, writer.accessToken, roomId);

  const labels = new Map<string, string>();
  const label = (eventId: string) => labels.get(eventId) ?? eventId;
  let newest = '';
  for (let index = 1; index <= HISTORY; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const eventId = await sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
      msgtype: 'm.text',
      body: [
        `Log entry ${index}: the morning tide came in at the usual height.`,
        'Crane two loaded the containers for berth four.',
        'Nothing else to report for this watch.',
      ].join('\n'),
    });
    labels.set(eventId, `entry-${index}`);
    newest = eventId;
  }
  // The reader has read the room before opening it.
  await matrixFetch(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(newest)}`,
    { method: 'POST', accessToken: reader.accessToken, body: JSON.stringify({}) }
  );

  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await page.evaluate(
    (id) => localStorage.setItem(`roomViewMode:${id}`, JSON.stringify('classic')),
    roomId
  );

  const receipts: Receipt[] = [];
  page.on('request', (request: Request) => {
    const { pathname } = new URL(request.url());
    const receipt = /\/receipt\/([^/]+)\/([^/?]+)$/.exec(pathname);
    if (receipt) {
      const body = request.postDataJSON() as { thread_id?: unknown } | null;
      receipts.push({
        type: decodeURIComponent(receipt[1] ?? ''),
        event: label(decodeURIComponent(receipt[2] ?? '')),
        thread: body?.thread_id,
      });
    }
    if (pathname.endsWith('/read_markers')) {
      const body = (request.postDataJSON() ?? {}) as Record<string, string>;
      Object.entries(body).forEach(([type, eventId]) =>
        receipts.push({ type, event: label(eventId) })
      );
    }
  });

  const roomLink = page.getByRole('link', { name: new RegExp(roomName) });
  const observations: unknown[] = [];
  /** What the reader can see of the room's unread state now, and the receipts since last time. */
  const observe = async (stage: string) => {
    const linkText = (await roomLink.textContent()) ?? '';
    const observation = {
      stage,
      focus: await page.evaluate(() => document.hasFocus()),
      gap: await scrollGap(page),
      unreadLineAbove: (await unreadLineRows(page)).map(label),
      jumpToUnread: await page.getByRole('button', { name: 'Jump to Unread' }).count(),
      markAsRead: await page.getByRole('button', { name: 'Mark as Read', exact: true }).count(),
      sidebarHighlight: await page
        .locator('[data-highlight]')
        .filter({ has: roomLink })
        .first()
        .getAttribute('data-highlight'),
      sidebarCount: linkText.replace(roomName, '').replace(/\D/g, ''),
      receipts: receipts.splice(0),
    };
    observations.push(observation);
    return observation;
  };

  await openPath(page, `/home/${encodeURIComponent(roomId)}`);
  await expect(page.locator(`[data-message-id="${newest}"]`)).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => scrollGap(page), { timeout: 20_000 }).toBeLessThanOrEqual(2);
  await page.waitForTimeout(2_000);
  const opened = await observe('opened at the bottom');
  expect(opened.unreadLineAbove).toEqual([]);

  /** The writer reacts to `target`; resolves once the reader's timeline shows it. */
  const react = async (target: string) => {
    const reaction = await sendReaction(HOMESERVER, writer.accessToken, roomId, target, '👍');
    labels.set(reaction, 'reaction');
    await expect(
      page.locator(`[data-message-id="${target}"]`).getByRole('button', { name: '👍 1' })
    ).toBeVisible({ timeout: 30_000 });
  };
  /** The writer edits `target`; resolves once the reader's timeline shows the new text. */
  const edit = async (target: string) => {
    const editId = await sendMessageEdit(
      HOMESERVER,
      writer.accessToken,
      roomId,
      target,
      `${label(target)} corrected: the evening tide came in early.`
    );
    labels.set(editId, 'edit');
    await expect(page.locator(`[data-message-id="${target}"]`)).toContainText('corrected', {
      timeout: 30_000,
    });
  };
  /** The writer sends a new message, labelled `messageLabel` in the observations. */
  const send = async (messageLabel: string, body: string) => {
    const eventId = await sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
      msgtype: 'm.text',
      body,
    });
    labels.set(eventId, messageLabel);
    return eventId;
  };
  /** Attaches every observation to the test's report, for a run that fails. */
  const attachObservations = () =>
    test.info().attach('observations', {
      body: JSON.stringify(observations, null, 2),
      contentType: 'application/json',
    });
  return { labels, observe, react, edit, send, attachObservations };
};

/** The reader turns the wheel up until they are a few screens above the bottom. */
const scrollUp = async (page: Page) => {
  // A wheel step is the browser's own: WebKit moves less per turn than Chromium.
  await expect
    .poll(
      async () => {
        const gap = await scrollGap(page);
        if (gap <= 1_500) await wheelOverTimeline(page, -500, 2);
        return gap;
      },
      { timeout: 30_000 }
    )
    .toBeGreaterThan(1_500);
  await page.waitForTimeout(1_000);
};

/** A reaction and an edit the reader does not see: no line, pill or receipt until they come back. */
const unseenReactionAndEdit = async (page: Page, name: string) => {
  const room = await openReadRoom(page, name);
  try {
    await scrollUp(page);
    await room.observe('scrolled up');
    const visible = (await rowsInView(page)).filter((eventId) => room.labels.has(eventId));
    expect(visible.length, 'older rows in view').toBeGreaterThanOrEqual(2);

    await room.react(visible[0] ?? '');
    await page.waitForTimeout(1_500);
    const afterReaction = await room.observe('reaction to an older message');
    expect(afterReaction.unreadLineAbove).toEqual([]);
    expect(afterReaction.jumpToUnread).toBe(0);
    expect(afterReaction.sidebarHighlight).toBe('false');
    expect(afterReaction.receipts).toEqual([]);

    await room.edit(visible[1] ?? '');
    await page.waitForTimeout(1_500);
    const afterEdit = await room.observe('edit of an older message');
    expect(afterEdit.unreadLineAbove).toEqual([]);
    expect(afterEdit.jumpToUnread).toBe(0);
    expect(afterEdit.sidebarHighlight).toBe('false');
    expect(afterEdit.receipts).toEqual([]);

    // Back at the bottom, the reader reads the room up to the edit, its newest event.
    await backToBottom(page);
    await page.waitForTimeout(2_000);
    const atBottom = await room.observe('back at the bottom');
    expect(atBottom.unreadLineAbove).toEqual([]);
    expect(atBottom.receipts).toEqual([{ type: 'm.read', event: 'edit', thread: 'main' }]);

    // A message the reader watches arrive gets no line, though the reaction and the edit came
    // while they were away.
    const watched = await room.send('watched', 'Log entry: the pilot boat is back at the pier.');
    await expect(page.locator(`[data-message-id="${watched}"]`)).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2_000);
    const afterWatched = await room.observe('message arrives at the bottom');
    expect(afterWatched.unreadLineAbove).toEqual([]);
    expect(afterWatched.receipts).toEqual([{ type: 'm.read', event: 'watched', thread: 'main' }]);

    // A message missed while scrolled up gets the line above it, not above the watched one.
    await scrollUp(page);
    const missed = await room.send('missed', 'Log entry: the harbor master closed the north gate.');
    await expect(page.getByRole('button', { name: 'Jump to Unread' })).toBeVisible({
      timeout: 30_000,
    });
    await backToBottom(page);
    await expect(page.locator(`[data-message-id="${missed}"]`)).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_500);
    const back = await room.observe('back at the bottom after a missed message');
    expect(back.unreadLineAbove).toEqual(['missed']);
  } finally {
    await room.attachObservations();
  }
};

/**
 * A reaction and an edit the reader sees at the bottom are read at once, and a message that
 * arrives while they are scrolled up gets the pill, the sidebar highlight and the line.
 */
const seenReactionAndEdit = async (page: Page, name: string) => {
  const room = await openReadRoom(page, name);
  try {
    const visible = (await rowsInView(page)).filter((eventId) => room.labels.has(eventId));
    expect(visible.length, 'rows in view').toBeGreaterThanOrEqual(3);

    // Two rows in view above the newest one.
    await room.react(visible[visible.length - 3] ?? '');
    await page.waitForTimeout(1_500);
    const afterReaction = await room.observe('reaction seen at the bottom');
    expect(afterReaction.unreadLineAbove).toEqual([]);
    expect(afterReaction.receipts).toEqual([{ type: 'm.read', event: 'reaction', thread: 'main' }]);

    await room.edit(visible[visible.length - 2] ?? '');
    await page.waitForTimeout(1_500);
    const afterEdit = await room.observe('edit seen at the bottom');
    expect(afterEdit.unreadLineAbove).toEqual([]);
    expect(afterEdit.receipts).toEqual([{ type: 'm.read', event: 'edit', thread: 'main' }]);

    const watched = await room.send('watched', 'Log entry: the pilot boat is back at the pier.');
    await expect(page.locator(`[data-message-id="${watched}"]`)).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2_000);
    const afterWatched = await room.observe('message arrives at the bottom');
    expect(afterWatched.unreadLineAbove).toEqual([]);
    expect(afterWatched.receipts).toEqual([{ type: 'm.read', event: 'watched', thread: 'main' }]);

    // A message that arrives while the reader is scrolled up is unread until they come back.
    await scrollUp(page);
    const missed = await room.send('missed', 'Log entry: the harbor master closed the north gate.');
    await expect(page.getByRole('button', { name: 'Jump to Unread' })).toBeVisible({
      timeout: 30_000,
    });
    const whileAway = await room.observe('message arrives while scrolled up');
    expect(whileAway.sidebarHighlight).toBe('true');
    expect(whileAway.receipts).toEqual([]);

    await backToBottom(page);
    await expect(page.locator(`[data-message-id="${missed}"]`)).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_500);
    const back = await room.observe('back at the bottom after a missed message');
    expect(back.unreadLineAbove).toEqual(['missed']);
    expect(back.receipts).toEqual([{ type: 'm.read', event: 'missed', thread: 'main' }]);
  } finally {
    await room.attachObservations();
  }
};

const CASES = [
  {
    key: 'away',
    title: 'a reaction and an edit the reader does not see put up no line, pill or receipt',
    run: unseenReactionAndEdit,
  },
  {
    key: 'here',
    title: 'a reaction and an edit seen at the bottom are read, and a missed message gets the line',
    run: seenReactionAndEdit,
  },
];

for (const { key, title, run } of CASES) {
  test(`${title} (Chromium)`, async ({ page }) => {
    test.setTimeout(300_000);
    await run(page, `${key}c`);
  });

  test(`${title} (WebKit)`, async ({ baseURL }) => {
    test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    test.setTimeout(300_000);
    // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
    const browser = await launchWebKit();
    try {
      const context = await browser.newContext({ viewport: VIEWPORT, baseURL });
      await run(await context.newPage(), `${key}w`);
    } finally {
      await browser.close();
    }
  });
}
