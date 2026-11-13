import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  DESKTOP,
  PASSWORD,
  PHONE,
  RUN,
  SCHEMES,
  createOtherRooms,
  join,
  register,
  say,
  seedSettings,
  setLook,
  shot,
  withRetry,
} from '../helpers/designChoices';
import { launchWebKit } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  CHROMIUM_WITH_SCROLLBARS,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// In the Bubble message layout the reader's own messages sit on the end side of the conversation
// (the right in English, the left in Arabic) with their avatar beside them, while everyone else's
// stay at the start; text inside an own bubble still starts at its leading edge, and on a desktop
// no bubble grows wider than a readable 40rem (L1-F012, design decision #11). Classic and Compact
// keep every message at the start. A people room among 25 rooms with realistic message lengths,
// on a desktop (1440 by 900) and a phone (390 by 844, touch), light and dark, in Chromium and,
// when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit; one desktop check in
// Arabic. Set DESIGN_CHOICES_SHOTS=<directory> to save screenshots.
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const ENGINES = ['chromium', ...(WEBKIT ? ['webkit'] : [])] as const;
const ROOM_NAME = 'Team chat';
const LAYOUT = { classic: 0, compact: 1, bubble: 2 } as const;
/** The readable width of a bubble on a desktop, in CSS pixels at 100 % zoom. */
const READABLE_PX = 640;

const OWN_SHORT = 'Sounds good, I will take it.';
const OWN_LONG =
  'I went through the staging dashboards this morning: the p99 latency is back under 200 ms, the ' +
  'error rate stayed flat over the weekend, and the two flaky checks in the payment flow passed ' +
  'ten times in a row after the retry fix. Unless someone objects I would like to cut the release ' +
  'candidate after lunch and give support the heads-up before the end of the day.';
const OTHER_SHORT = 'Can someone own the release notes this week?';
const OTHER_LONG =
  'The design review moved to Thursday, so the onboarding copy will land a day later than planned. ' +
  'I left comments on the empty states and the error messages; most are small wording changes, but ' +
  'the permission screen needs a second look from someone who knows the new roles.';

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

type Seed = { username: string; roomId: string };

const seed = async (label: string): Promise<Seed> => {
  const id = `${label}_${RUN}_${randomUUID().slice(0, 6)}`;
  const tester = await register(`bos_${id}`, 'Robin Tester');
  const colleague = await register(`bos_kai_${id}`, 'Kai Colleague');
  const other = await register(`bos_lee_${id}`, 'Lee Reviewer');
  await createOtherRooms(tester);
  const roomId = await withRetry(() =>
    createRoom(HOMESERVER, tester.token, {
      name: ROOM_NAME,
      invite: [colleague.userId, other.userId],
    })
  );
  await join(colleague, roomId);
  await join(other, roomId);
  await say(colleague, roomId, OTHER_SHORT);
  await say(tester, roomId, OWN_SHORT);
  await say(other, roomId, OTHER_LONG);
  await say(tester, roomId, OWN_LONG);
  await say(colleague, roomId, 'Thanks, that settles it.');
  return { username: tester.username, roomId };
};

type Box = { left: number; right: number; width: number };
/** `lineStarts`: how far the text's lines start from the bubble's left edge, one per line. */
type Row = { text: string; bubble: Box; column: Box; avatar: Box | null; lineStarts: number[] };

/** Each message row's bubble (the box around its name and text), content column and avatar. */
const rows = (page: Page): Promise<Row[]> =>
  page.evaluate(
    (needles) => {
      const box = (element: Element): Box => {
        const { left, right, width } = element.getBoundingClientRect();
        return { left, right, width };
      };
      const found: Row[] = [];
      document.querySelectorAll<HTMLElement>('[data-message-id]').forEach((row) => {
        const text = needles.find((needle) => row.textContent?.includes(needle));
        if (!text) return;
        const name = row.querySelector('button[data-user-id]');
        if (!name) return;
        // The bubble: the nearest box around the name with a background of its own.
        let bubble: HTMLElement | null = name.parentElement;
        while (bubble && bubble !== row) {
          const { backgroundColor } = getComputedStyle(bubble);
          if (backgroundColor !== 'rgba(0, 0, 0, 0)' && backgroundColor !== 'transparent') break;
          bubble = bubble.parentElement;
        }
        const column = bubble?.parentElement;
        if (!bubble || bubble === row || !column) return;
        const body = Array.from(bubble.querySelectorAll<HTMLElement>('*')).find(
          (node) => node.childElementCount === 0 && node.textContent?.includes(text.slice(0, 20))
        );
        const lineStarts: number[] = [];
        if (body) {
          const range = document.createRange();
          range.selectNodeContents(body);
          const bubbleLeft = bubble.getBoundingClientRect().left;
          // Chromium adds rects for a line's wrapped end: take the leftmost rect of each line.
          const lines = new Map<number, number>();
          Array.from(range.getClientRects())
            .filter((rect) => rect.width > 0)
            .forEach((rect) => {
              const line = Math.round(rect.top);
              lines.set(line, Math.min(lines.get(line) ?? Infinity, rect.left - bubbleLeft));
            });
          lineStarts.push(...lines.values());
        }
        const avatar = row.querySelector('[data-user-id]:not(button)');
        found.push({
          text,
          bubble: box(bubble),
          column: box(column),
          avatar: avatar ? box(avatar) : null,
          lineStarts,
        });
      });
      return found;
    },
    [OWN_SHORT, OWN_LONG, OTHER_SHORT, OTHER_LONG]
  );

const openRoom = async (page: Page, data: Seed) => {
  await page.goto(`/home/${encodeURIComponent(data.roomId)}`);
  await expect(page.getByText('Thanks, that settles it.').first()).toBeVisible({
    timeout: 30_000,
  });
};

const rowOf = (all: Row[], text: string) => {
  const row = all.find((each) => each.text === text);
  if (!row) throw new Error(`No row for "${text.slice(0, 30)}"`);
  return row;
};

/** Bubble layout: own bubbles at the end side with their avatar, others' at the start. */
const checkBubble = async (page: Page, direction: 'ltr' | 'rtl', desktop: boolean) => {
  const all = await rows(page);
  const rtl = direction === 'rtl';
  const atStart = (row: Row) =>
    rtl ? row.column.right - row.bubble.right : row.bubble.left - row.column.left;
  const atEnd = (row: Row) =>
    rtl ? row.bubble.left - row.column.left : row.column.right - row.bubble.right;
  for (const text of [OTHER_SHORT, OTHER_LONG]) {
    const row = rowOf(all, text);
    expect(Math.abs(atStart(row)), `"${text.slice(0, 20)}" starts at the start`).toBeLessThan(1);
  }
  for (const text of [OWN_SHORT, OWN_LONG]) {
    const row = rowOf(all, text);
    expect(Math.abs(atEnd(row)), `own "${text.slice(0, 20)}" sits at the end`).toBeLessThan(1);
    // Its avatar is beside it on the end side.
    expect(row.avatar, 'own avatar').not.toBeNull();
    const avatar = row.avatar as Box;
    expect(rtl ? avatar.right <= row.bubble.left : avatar.left >= row.bubble.right).toBe(true);
  }
  // The long own message's English lines all start at the bubble's left padding.
  if (!rtl) {
    const { lineStarts } = rowOf(all, OWN_LONG);
    expect(lineStarts.length, 'own long message lines').toBeGreaterThan(1);
    expect(Math.max(...lineStarts) - Math.min(...lineStarts), 'left-aligned lines').toBeLessThan(1);
    expect(Math.min(...lineStarts), 'text starts at the padding').toBeLessThan(20);
  }
  // A short own message leaves the start side free, so the two sides read apart.
  expect(atStart(rowOf(all, OWN_SHORT))).toBeGreaterThan(40);
  if (desktop) {
    for (const text of [OWN_LONG, OTHER_LONG]) {
      expect(rowOf(all, text).bubble.width, 'readable width').toBeLessThanOrEqual(
        READABLE_PX + 0.5
      );
    }
  }
};

/** Classic and Compact: every message, own or not, starts at the same edge. */
const checkSameSide = async (page: Page) => {
  const starts = await page.evaluate(
    (needles) =>
      needles.map((needle) => {
        const row = Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]')).find(
          (each) => each.textContent?.includes(needle)
        );
        const name = row?.querySelector('button[data-user-id]');
        return name ? Math.round(name.getBoundingClientRect().left) : -1;
      }),
    [OWN_SHORT, OTHER_SHORT, OWN_LONG, OTHER_LONG]
  );
  expect(new Set(starts).size, `names start at ${starts.join(', ')}`).toBe(1);
};

const newPage = async (
  engine: (typeof ENGINES)[number],
  browser: Browser,
  options: BrowserContextOptions
) => {
  const owner = engine === 'webkit' ? await launchWebKit() : browser;
  // Without the service worker the page's routes see the sends in WebKit too.
  const context = await owner.newContext({ ...options, serviceWorkers: 'block' });
  const page = await context.newPage();
  return {
    page,
    close: async () => {
      await context.close();
      if (owner !== browser) await owner.close();
    },
  };
};

const setLayout = async (page: Page, layout: number) => {
  await page.evaluate((messageLayout) => {
    const stored = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
    localStorage.setItem('settings', JSON.stringify({ ...stored, messageLayout }));
  }, layout);
};

/**
 * An own message the server refuses keeps its "Not sent" line with Retry and Delete under its
 * bubble, ending where the bubble ends, not at the other side of the conversation.
 */
const checkFailedSend = async (page: Page, label: string, desktop: boolean, testInfo: TestInfo) => {
  const text = `Refused draft ${label}: the agenda for Thursday.`;
  await page.route('**/send/m.room.message/**', async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as { body?: string };
    if (!body.body?.startsWith('Refused draft')) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ errcode: 'M_UNKNOWN', error: 'injected failure' }),
    });
  });
  const composer = page.locator('[data-room-footer="true"] [contenteditable="true"]');
  await composer.click();
  await page.keyboard.type(text);
  // A phone's Enter starts a new line; its send button sends.
  if (desktop) await page.keyboard.press('Enter');
  else await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const row = page.locator('[data-message-id]').filter({ hasText: text }).last();
  const line = row
    .locator('xpath=following-sibling::*[1]')
    .filter({ hasText: 'Not sent' })
    .getByRole('button', { name: 'Delete' });
  await expect(line).toBeVisible({ timeout: 30_000 });
  await line.scrollIntoViewIfNeeded();
  await shot(page, testInfo, `bubble-${label}-not-sent`);
  const ends = await row.evaluate((element, needle) => {
    const name = element.querySelector('button[data-user-id]');
    let bubble: HTMLElement | null = name?.parentElement ?? null;
    while (bubble && bubble !== element) {
      const { backgroundColor } = getComputedStyle(bubble);
      if (backgroundColor !== 'rgba(0, 0, 0, 0)' && backgroundColor !== 'transparent') break;
      bubble = bubble.parentElement;
    }
    const next = element.nextElementSibling;
    const remove = Array.from(next?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent === needle
    );
    return {
      bubble: bubble?.getBoundingClientRect().right ?? NaN,
      line: remove?.getBoundingClientRect().right ?? NaN,
    };
  }, 'Delete');
  expect(Math.abs(ends.line - ends.bubble), 'the Not sent line ends with the bubble').toBeLessThan(
    4
  );
  await line.click();
  await expect(row).toHaveCount(0);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
};

const run = async (page: Page, data: Seed, label: string, desktop: boolean, testInfo: TestInfo) => {
  for (const scheme of SCHEMES) {
    // eslint-disable-next-line no-await-in-loop
    await setLook(page, scheme);
    // eslint-disable-next-line no-await-in-loop
    await setLayout(page, LAYOUT.bubble);
    // eslint-disable-next-line no-await-in-loop
    await page.reload();
    // eslint-disable-next-line no-await-in-loop
    await openRoom(page, data);
    // eslint-disable-next-line no-await-in-loop
    await shot(page, testInfo, `bubble-${label}-${scheme}`);
    // eslint-disable-next-line no-await-in-loop
    await checkBubble(page, 'ltr', desktop);
  }
  await checkFailedSend(page, label, desktop, testInfo);
  for (const layout of [LAYOUT.classic, LAYOUT.compact]) {
    // eslint-disable-next-line no-await-in-loop
    await setLayout(page, layout);
    // eslint-disable-next-line no-await-in-loop
    await page.reload();
    // eslint-disable-next-line no-await-in-loop
    await openRoom(page, data);
    // eslint-disable-next-line no-await-in-loop
    await checkSameSide(page);
  }
};

for (const engine of ENGINES) {
  for (const form of ['desktop', 'phone'] as const) {
    test(`own messages sit on the end side in Bubble layout only: ${engine} ${form}`, async ({
      browser,
    }, testInfo) => {
      test.skip(!(await disposableHomeserverIsUp()), 'Test homeserver is not running.');
      test.setTimeout(240_000);
      const data = await seed(`${engine}_${form}`);
      const { page, close } = await newPage(engine, browser, form === 'phone' ? PHONE : DESKTOP);
      try {
        await seedSettings(page, { isPeopleDrawer: false });
        await loginWithPassword(page, {
          homeserver: HOMESERVER,
          username: data.username,
          password: PASSWORD,
        });
        await run(page, data, `${engine}-${form}`, form === 'desktop', testInfo);
        if (form === 'desktop') {
          // Right to left mirrors it: own messages on the left.
          await setLayout(page, LAYOUT.bubble);
          await setLook(page, 'light', 'rtl');
          await openRoom(page, data);
          await shot(page, testInfo, `bubble-${engine}-${form}-rtl`);
          await checkBubble(page, 'rtl', true);
        }
      } finally {
        await close();
      }
    });
  }
}
