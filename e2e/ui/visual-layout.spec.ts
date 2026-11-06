import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
  addRoomToSpace,
  matrixFetch,
  sendRoomMessage,
  sendStateEvent,
} from '../helpers/matrix';
import { launchWebKit } from '../helpers/webkit';

// Layout checks from the live-test lanes, against a real homeserver, in Chromium and (when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit) WebKit, in light and dark, left to right
// (English) and right to left (Arabic). Each test seeds its own account: 24 other rooms, a room
// with two agents and four threads (one long, one resolved with two tags), an Arabic room with an
// Arabic thread, and a space holding both rooms.
// - Members: between a phone and about 950 px the members panel lies over the room instead of
//   squeezing the conversation (L8-F001).
// - Thread: the expand-all toggle covers no message text at any scroll position (L8-F002, L5-F006,
//   L6-F006) and names what it does; the minimap strips never cross a model badge (L8-F003).
// - Compact cards: a resolved card with two tags is as tall as the others on a phone (L8-F005).
// - Palette: a message row shows the room before the thread in the interface's direction, also for
//   Arabic names (L8-F006), and keeps the sender's short name whole on a phone (L8-F007).
// Set VISUAL_LAYOUT_SHOTS=<directory> to save screenshots.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'visual-layout-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.VISUAL_LAYOUT_SHOTS;

const DESKTOP: BrowserContextOptions = { viewport: { width: 1440, height: 900 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const SCHEMES = ['light', 'dark'] as const;
const DIRECTIONS = ['ltr', 'rtl'] as const;
type Direction = (typeof DIRECTIONS)[number];

const ROOM_NAME = 'Launch planning';
const ARABIC_ROOM = 'غرفة فريق الإطلاق';
const ARABIC_THREAD = '📊 تقرير الأداء الأسبوعي';
const LATIN_THREAD = '✉️ Launch email draft';
const LONG_THREAD = 'Run the three steps and report what changed';
const RESOLVED_THREAD = '🧪 Staging load test before go-live';
const MODEL = {
  version: 1,
  status: 'completed',
  model: {
    config: 'large',
    display_name: 'Stub Large Model',
    id: 'stub-large',
    provider: 'openai',
  },
};
const LONG_REPLY = Array.from(
  { length: 28 },
  (_, line) =>
    `Step ${
      line + 1
    }: checked the deployment notes, compared the staging numbers with last week, ` +
    'and wrote down what moved and why it moved.'
).join('\n');

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
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

/** Retries what the server refuses with 429. */
const withRetry = async <T>(run: () => Promise<T>): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await run();
    } catch (error) {
      if (attempt > 8 || !String(error).includes('429')) throw error;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, 500 * (attempt + 1));
      });
    }
  }
};

type Account = { username: string; userId: string; token: string };

const register = async (username: string, name: string): Promise<Account> => {
  const body = await withRetry(() =>
    matrixFetch<{ user_id: string; access_token: string }>(HOMESERVER, '/register', {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    })
  );
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(body.user_id)}/displayname`, {
    method: 'PUT',
    accessToken: body.access_token,
    body: JSON.stringify({ displayname: name }),
  });
  return { username, userId: body.user_id, token: body.access_token };
};

const say = (account: Account, roomId: string, body: string, root?: string, extra = {}) =>
  withRetry(() =>
    sendRoomMessage(HOMESERVER, account.token, roomId, {
      msgtype: 'm.text',
      body,
      ...extra,
      ...(root
        ? {
            'm.relates_to': {
              rel_type: 'm.thread',
              event_id: root,
              is_falling_back: true,
              'm.in_reply_to': { event_id: root },
            },
          }
        : {}),
    })
  );

const tag = (owner: Account, roomId: string, root: string, name: string) =>
  sendStateEvent(
    HOMESERVER,
    owner.token,
    roomId,
    'com.mindroom.thread.tags',
    JSON.stringify([root, name]),
    {
      set_by: owner.userId,
      set_at: new Date().toISOString(),
    }
  );

type Seed = {
  username: string;
  roomId: string;
  arabicRoomId: string;
  spaceId: string;
  longThread: string;
};

const seed = async (label: string): Promise<Seed> => {
  const id = `${label}_${RUN}_${randomUUID().slice(0, 6)}`;
  const tester = await register(`vl_${id}`, 'Robin Tester');
  const helper = await register(`mindroom_helper_${id}`, 'Helper');
  const research = await register(`mindroom_research_${id}`, 'Research');
  await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      withRetry(() => createRoom(HOMESERVER, tester.token, { name: `Project room ${index + 1}` }))
    )
  );
  const invite = [helper.userId, research.userId];
  const roomId = await createRoom(HOMESERVER, tester.token, { name: ROOM_NAME, invite });
  const arabicRoomId = await createRoom(HOMESERVER, tester.token, { name: ARABIC_ROOM, invite });
  for (const agent of [helper, research]) {
    for (const room of [roomId, arabicRoomId]) {
      // eslint-disable-next-line no-await-in-loop
      await withRetry(() =>
        matrixFetch(HOMESERVER, `/join/${encodeURIComponent(room)}`, {
          method: 'POST',
          accessToken: agent.token,
          body: '{}',
        })
      );
    }
  }

  // A resolved thread with two tags, and two others with one tag each.
  const resolved = await say(tester, roomId, RESOLVED_THREAD);
  await say(research, roomId, 'Load test passed at 2.1k rps with p99 at 180 ms.', resolved, {
    'io.mindroom.ai_run': MODEL,
  });
  await say(tester, roomId, 'Thanks, that settles it.', resolved);
  for (const name of ['resolved', 'infra', 'launch']) {
    // eslint-disable-next-line no-await-in-loop
    await tag(tester, roomId, resolved, name);
  }
  const email = await say(tester, roomId, LATIN_THREAD);
  await say(
    research,
    roomId,
    'Subject: your workspace just got agents, launch notes inside.',
    email,
    {
      'io.mindroom.ai_run': MODEL,
    }
  );
  await tag(tester, roomId, email, 'launch');
  const chart = await say(tester, roomId, '📈 Cohort chart for slide 6');
  await say(helper, roomId, 'The chart is ready; the cohort from March is the outlier.', chart, {
    'io.mindroom.ai_run': MODEL,
  });
  await tag(tester, roomId, chart, 'metrics');

  // The long thread: questions from the person (the minimap's strips) and agent answers with a
  // model badge, one long enough to fold.
  const longThread = await say(tester, roomId, LONG_THREAD);
  for (let step = 1; step <= 7; step += 1) {
    // eslint-disable-next-line no-await-in-loop
    await say(
      tester,
      roomId,
      `Question ${step}: what did step ${step} change in the staging numbers, and should we worry about it before the launch?`,
      longThread
    );
    // eslint-disable-next-line no-await-in-loop
    await say(
      helper,
      roomId,
      step === 3
        ? LONG_REPLY
        : `Step ${step} moved the p99 latency by ${
            step * 3
          } ms; nothing to worry about before the launch.`,
      longThread,
      { 'io.mindroom.ai_run': MODEL }
    );
  }
  await say(helper, roomId, 'I thought about it and the answer is 42.', longThread, {
    'io.mindroom.ai_run': MODEL,
  });

  const arabicThread = await say(tester, arabicRoomId, ARABIC_THREAD);
  await say(
    research,
    arabicRoomId,
    'بالتأكيد. ارتفع معدل الاستخدام بنسبة 12% بعد launch وتم إصلاح الخطأ.',
    arabicThread,
    { 'io.mindroom.ai_run': MODEL }
  );

  const spaceId = await createRoom(HOMESERVER, tester.token, {
    name: 'Product Space',
    space: true,
  });
  await addRoomToSpace(HOMESERVER, tester.token, spaceId, roomId);
  await addRoomToSpace(HOMESERVER, tester.token, spaceId, arabicRoomId);
  return { username: tester.username, roomId, arabicRoomId, spaceId, longThread };
};

type Run = { page: Page; engine: string; form: string; testInfo: TestInfo; seed: Seed };

const shot = async ({ page, engine, form, testInfo }: Run, name: string) => {
  const body = await page.screenshot();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${engine}-${form}.png` });
  await testInfo.attach(`${name}-${engine}-${form}`, { body, contentType: 'image/png' });
};

/** Signs in once, then switches language (and with it the direction) and color scheme. */
const signIn = async (page: Page, data: Seed) => {
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: data.username,
    password: PASSWORD,
  });
};

const setLook = async (page: Page, direction: Direction, scheme: (typeof SCHEMES)[number]) => {
  await page.emulateMedia({ colorScheme: scheme });
  const want = direction === 'rtl' ? 'ar' : 'en';
  const now = await page.evaluate(() => localStorage.getItem('i18nextLng'));
  if (now !== want) {
    await page.evaluate((code) => localStorage.setItem('i18nextLng', code), want);
    await page.reload();
  }
  await expect(page.locator('html')).toHaveAttribute('dir', direction);
};

/** Every combination of direction and scheme, in an order that reloads only twice. */
const looks = DIRECTIONS.flatMap((direction) => SCHEMES.map((scheme) => ({ direction, scheme })));

// ---------------------------------------------------------------------------------------------
// L8-F001: members panel at tablet widths.

const conversationWidth = (page: Page) =>
  page
    .locator('[contenteditable="true"]')
    .first()
    .evaluate((editor) => {
      // The composer's card spans the conversation column.
      let node: HTMLElement | null = editor as HTMLElement;
      let widest = 0;
      for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
        widest = Math.max(widest, node.getBoundingClientRect().width);
      }
      return widest;
    });

const membersBeside = (page: Page) =>
  page.evaluate(() => {
    const panel = document.querySelector('[data-testid="resizable-members-panel"]');
    if (!panel) return false;
    return !panel.closest('[role="dialog"]');
  });

const readLocale = (code: string) =>
  JSON.parse(
    readFileSync(new URL(`../../src/app/i18n/locales/${code}.json`, import.meta.url), 'utf8')
  ) as { mindroomUi: { threads: { mindroomRoomViewHeader: Record<string, string> } } };
const HEADER_LABELS = {
  ltr: readLocale('en').mindroomUi.threads.mindroomRoomViewHeader,
  rtl: readLocale('ar').mindroomUi.threads.mindroomRoomViewHeader,
};

const checkMembers = async (run: Run) => {
  const { page, seed: data } = run;
  await signIn(page, data);
  for (const { direction, scheme } of looks) {
    const labels = HEADER_LABELS[direction];
    for (const width of [800, 900]) {
      const where = `${run.engine}, ${width} px, ${direction}, ${scheme}`;
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/home/${encodeURIComponent(data.roomId)}/`);
      await setLook(page, direction, scheme);
      await expect(page.getByText(LATIN_THREAD).first()).toBeVisible({ timeout: 60_000 });
      await expect
        .poll(() => membersBeside(page), `no members beside the room (${where})`)
        .toBe(false);
      expect(await conversationWidth(page), `conversation width (${where})`).toBeGreaterThanOrEqual(
        360
      );
      // The header's members button opens them over the room; Escape closes them.
      await page.getByRole('button', { name: labels.showMembers, exact: true }).click();
      const sheet = page.getByRole('dialog', { name: labels.members, exact: true });
      await expect(sheet.getByTestId('resizable-members-panel')).toBeVisible();
      const box = await sheet.getByTestId('resizable-members-panel').boundingBox();
      // The sheet sits at the end of the line: the right in English, the left in Arabic.
      if (direction === 'ltr') expect(Math.round((box?.x ?? 0) + (box?.width ?? 0))).toBe(width);
      else expect(Math.round(box?.x ?? -1)).toBe(0);
      if (width === 800 && scheme === 'light')
        await shot(run, `members-sheet-${width}-${direction}`);
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);
      expect(await membersBeside(page)).toBe(false);
      await shot(run, `members-room-${width}-${direction}-${scheme}`);
    }
    // The lobby of the space at 800 px.
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(`/${encodeURIComponent(data.spaceId)}/lobby/`);
    await expect(page.getByText(ARABIC_ROOM).last()).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(() => membersBeside(page), `no members beside the lobby (${direction}, ${scheme})`)
      .toBe(false);
    await shot(run, `members-lobby-800-${direction}-${scheme}`);
  }
  // Wide enough, the members stay beside the room, as the setting says.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/home/${encodeURIComponent(data.roomId)}/`);
  await expect.poll(() => membersBeside(page)).toBe(true);
};

// ---------------------------------------------------------------------------------------------
// L8-F002, L5-F006, L6-F006: the expand-all toggle; L8-F003: minimap strips and model badges.

type Clash = { scrollTop: number; text: string } | null;

/**
 * Scrolls the thread from top to bottom in small steps and answers the first position where the
 * expand-all toggle covers message text, if any.
 */
const toggleClash = (page: Page): Promise<Clash> =>
  page.evaluate(async () => {
    const toggle = Array.from(document.querySelectorAll('button')).find((button) =>
      /^\[[+-]/.test(button.textContent ?? '')
    );
    if (!toggle) throw new Error('No expand-all toggle');
    let element: HTMLElement | null = document.querySelector('[data-thread-count]');
    while (element && !/(auto|scroll)/.test(getComputedStyle(element).overflowY)) {
      element = element.parentElement;
    }
    if (!element) throw new Error('No thread scroller');
    const scroll = element;
    const frame = () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
    const overlaps = (a: DOMRect, b: DOMRect) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const end = scroll.scrollHeight - scroll.clientHeight;
    for (let top = 0; top <= end + 8; top += 8) {
      scroll.scrollTop = Math.min(top, end);
      // eslint-disable-next-line no-await-in-loop
      await frame();
      const box = toggle.getBoundingClientRect();
      const rows = document.querySelectorAll('[data-message-id]');
      for (const row of rows) {
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            if (overlaps(rect, box)) return { scrollTop: scroll.scrollTop, text: node.textContent };
          }
        }
      }
    }
    return null;
  });

/** Every model badge that a minimap strip crosses, over the whole scroll range. */
const stripClash = (page: Page): Promise<string | null> =>
  page.evaluate(async () => {
    const strips = Array.from(document.querySelectorAll('[data-minimap-strip]'));
    if (strips.length === 0) throw new Error('No minimap strips');
    let element: HTMLElement | null = document.querySelector('[data-thread-count]');
    while (element && !/(auto|scroll)/.test(getComputedStyle(element).overflowY)) {
      element = element.parentElement;
    }
    if (!element) throw new Error('No thread scroller');
    const scroll = element;
    const frame = () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
    const badges = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-message-id] span[title]')).filter(
        (span) => (span.getAttribute('aria-label') ?? '').includes('Stub Large Model')
      );
    const end = scroll.scrollHeight - scroll.clientHeight;
    let seen = 0;
    for (let top = 0; top <= end + 8; top += 8) {
      scroll.scrollTop = Math.min(top, end);
      // eslint-disable-next-line no-await-in-loop
      await frame();
      for (const badge of badges()) {
        seen += 1;
        const b = badge.getBoundingClientRect();
        for (const strip of strips) {
          const s = strip.getBoundingClientRect();
          // Horizontally: any strip, however wide it grows, against the badge.
          const across = Math.min(s.right, b.right) - Math.max(s.left, b.left);
          const down = Math.min(s.bottom, b.bottom) - Math.max(s.top, b.top);
          if (across > 0 && down > 0) {
            return `strip ${Math.round(s.left)}-${Math.round(s.right)} x ${Math.round(
              s.top
            )} crosses badge ${Math.round(b.left)}-${Math.round(b.right)} x ${Math.round(
              b.top
            )}-${Math.round(b.bottom)} at ${scroll.scrollTop}`;
          }
        }
      }
    }
    if (seen === 0) throw new Error('No model badges');
    return null;
  });

const EXPAND_LABELS = {
  expand: 'Expand all long messages',
  collapse: 'Collapse all long messages',
};

const checkThread = async (run: Run, sizes: { width: number; height: number }[]) => {
  const { page, seed: data } = run;
  await signIn(page, data);
  for (const { direction, scheme } of looks) {
    for (const size of sizes) {
      const where = `${run.engine}, ${size.width}x${size.height}, ${direction}, ${scheme}`;
      await page.setViewportSize(size);
      await page.goto(
        `/home/${encodeURIComponent(data.roomId)}/?threadId=${encodeURIComponent(data.longThread)}`
      );
      await setLook(page, direction, scheme);
      await expect(page.getByText('I thought about it and the answer is 42.')).toBeVisible({
        timeout: 60_000,
      });
      await shot(run, `thread-bottom-${size.width}-${direction}-${scheme}`);
      expect(await toggleClash(page), `toggle covers no text (${where})`).toBeNull();
      if (run.form === 'desktop') {
        expect(await stripClash(page), `strips cross no badge (${where})`).toBeNull();
      }
    }
  }
  // The toggle says what it does (English).
  await setLook(page, 'ltr', 'light');
  const expand = page.getByRole('button', { name: EXPAND_LABELS.expand, exact: true });
  await expect(expand).toBeVisible();
  await expand.click();
  await expect(
    page.getByRole('button', { name: EXPAND_LABELS.collapse, exact: true })
  ).toBeVisible();
};

// ---------------------------------------------------------------------------------------------
// L8-F005: Compact cards keep one height on a phone.

const checkCompact = async (run: Run) => {
  const { page, seed: data } = run;
  await signIn(page, data);
  for (const { direction, scheme } of looks) {
    await page.goto(`/home/${encodeURIComponent(data.roomId)}/`);
    await setLook(page, direction, scheme);
    const cards = page.locator('[data-thread-root-id]');
    await expect(cards).toHaveCount(4, { timeout: 60_000 });
    await expect(page.locator('[data-compact-card-resolution-byline="true"]')).toBeVisible();
    const heights = await cards.evaluateAll((list) =>
      list.map((card) => Math.round(card.getBoundingClientRect().height))
    );
    await shot(run, `compact-${direction}-${scheme}`);
    expect(
      Math.max(...heights) - Math.min(...heights),
      `card heights ${heights.join(', ')} (${run.engine}, ${direction}, ${scheme})`
    ).toBeLessThanOrEqual(1);
  }
};

// ---------------------------------------------------------------------------------------------
// L8-F006, L8-F007: palette message rows.

type PlaceRow = {
  sender: string;
  senderCut: boolean;
  roomLeft: number;
  threadLeft: number;
};

const messageRows = (page: Page, roomName: string, threadName: string) =>
  page.evaluate(
    ({ room, thread }) => {
      const textRect = (root: Element, text: string): DOMRect | undefined => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const at = node.textContent?.indexOf(text) ?? -1;
          if (at >= 0) {
            const range = document.createRange();
            range.setStart(node, at);
            range.setEnd(node, at + Math.min(text.length, 6));
            return range.getBoundingClientRect();
          }
        }
        return undefined;
      };
      return Array.from(document.querySelectorAll('[role="dialog"] time')).flatMap((time) => {
        const place = time.previousElementSibling;
        const sender = place?.previousElementSibling as HTMLElement | null;
        if (!place || !sender || !(place.textContent ?? '').includes(room)) return [];
        const roomRect = textRect(place, room);
        const threadRect = textRect(place, thread);
        if (!roomRect || !threadRect) return [];
        return [
          {
            sender: sender.textContent ?? '',
            senderCut: sender.scrollWidth > sender.clientWidth + 1,
            roomLeft: roomRect.left,
            threadLeft: threadRect.left,
          },
        ];
      });
    },
    { room: roomName, thread: threadName }
  ) as Promise<PlaceRow[]>;

const checkPalette = async (run: Run) => {
  const { page, seed: data } = run;
  await signIn(page, data);
  for (const { direction, scheme } of looks) {
    await page.goto(`/home/${encodeURIComponent(data.roomId)}/`);
    await setLook(page, direction, scheme);
    await expect(page.getByText(LATIN_THREAD).first()).toBeVisible({ timeout: 60_000 });
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog').last();
    await dialog.locator('input').first().fill('launch');
    await expect
      .poll(async () => (await messageRows(page, ARABIC_ROOM, 'تقرير')).length, { timeout: 30_000 })
      .toBeGreaterThan(0);
    await expect
      .poll(async () => (await messageRows(page, ROOM_NAME, 'Launch email')).length, {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    await shot(run, `palette-${direction}-${scheme}`);
    const where = `${run.engine}, ${run.form}, ${direction}, ${scheme}`;
    for (const [room, thread] of [
      [ARABIC_ROOM, 'تقرير'],
      [ROOM_NAME, 'Launch email'],
    ] as const) {
      // eslint-disable-next-line no-await-in-loop
      const [row] = await messageRows(page, room, thread);
      // The room comes first in reading order: left in English, right in Arabic.
      if (direction === 'ltr') {
        expect(row.roomLeft, `room before thread (${room}, ${where})`).toBeLessThan(row.threadLeft);
      } else {
        expect(row.roomLeft, `room before thread (${room}, ${where})`).toBeGreaterThan(
          row.threadLeft
        );
      }
      expect(row.senderCut, `sender "${row.sender}" whole (${room}, ${where})`).toBe(false);
    }
    await page.keyboard.press('Escape');
  }
};

// ---------------------------------------------------------------------------------------------

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

type Check = (run: Run) => Promise<void>;

const runIn = async (
  engine: 'chromium' | 'webkit',
  form: string,
  options: BrowserContextOptions,
  check: Check,
  { page, baseURL }: { page?: Page; baseURL?: string },
  testInfo: TestInfo
) => {
  const data = await seed(`${engine.slice(0, 2)}${form.slice(0, 2)}`);
  if (page) {
    await check({ page, engine, form, testInfo, seed: data });
    return;
  }
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({ ...options, baseURL });
    await check({ page: await context.newPage(), engine, form, testInfo, seed: data });
  } finally {
    await browser.close();
  }
};
const CASES: { name: string; form: string; options: BrowserContextOptions; check: Check }[] = [
  {
    name: 'the members panel lies over a room too narrow for it',
    form: 'tablet',
    options: { viewport: { width: 800, height: 900 } },
    check: checkMembers,
  },
  {
    name: 'the expand-all toggle covers no text and the minimap crosses no model badge',
    form: 'desktop',
    options: DESKTOP,
    check: (run) =>
      checkThread(run, [
        { width: 1440, height: 900 },
        { width: 1024, height: 768 },
        { width: 1280, height: 600 },
      ]),
  },
  {
    name: 'the expand-all toggle covers no text',
    form: 'phone',
    options: PHONE,
    check: (run) => checkThread(run, [{ width: 390, height: 844 }]),
  },
  {
    name: 'a resolved Compact card is as tall as the others',
    form: 'phone',
    options: PHONE,
    check: checkCompact,
  },
  {
    name: 'palette message rows show room, then thread, and the whole sender',
    form: 'desktop',
    options: DESKTOP,
    check: checkPalette,
  },
  {
    name: 'palette message rows show room, then thread, and the whole sender',
    form: 'phone',
    options: PHONE,
    check: checkPalette,
  },
];

for (const { name, form, options, check } of CASES) {
  test.describe(`${form}: ${name}`, () => {
    test.use(options);

    test(`${name} (Chromium, ${form})`, async ({ page, baseURL }, testInfo) => {
      test.setTimeout(420_000);
      await runIn('chromium', form, options, check, { page, baseURL }, testInfo);
    });

    test(`${name} (WebKit, ${form})`, async ({ baseURL }, testInfo) => {
      test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
      test.setTimeout(420_000);
      await runIn('webkit', form, options, check, { baseURL }, testInfo);
    });
  });
}
