import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { matrixFetch } from '../helpers/matrix';
import {
  DESKTOP,
  HOMESERVER,
  LAUNCH,
  PASSWORD,
  PHONE,
  RUN,
  SCHEMES,
  createOtherRooms,
  homeserverIsUp,
  join,
  register,
  say,
  seedSettings,
  setLook,
  shot,
  withRetry,
  type Account,
  type Scheme,
} from '../helpers/designChoices';
import { launchWebKit } from '../helpers/webkit';

// After a voice call MindRoom posts the call's transcript into the conversation. With its
// structured form (`io.mindroom.call_transcript`) the message shows as a call card: a phone icon,
// "Voice call" and the duration, then a transcript that starts closed and opens, by pointer,
// keyboard or tap, into a compact chat: each run of turns by one speaker under that member's
// avatar and name, someone the room does not know under the ID's localpart and a generated
// avatar. Checked in a room among 25 with realistic message lengths, in the Modern, Compact and
// Bubble message layouts and the Classic view, light and dark, English and Arabic, on a desktop
// (1440 by 900) and a phone (390 by 844, touch), in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. Copy Text copies the plain
// transcript, and a message search that matches a turn opens the transcript with the match marked.
// Set DESIGN_CHOICES_SHOTS=<directory> to save screenshots.
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const ENGINES = ['chromium', ...(WEBKIT ? ['webkit'] : [])] as const;
const ROOM_NAME = 'Team chat';
const LAYOUT = { modern: 0, compact: 1, bubble: 2 } as const;
const LAST_WORDS = 'Thanks, I will read the transcript later.';
const SEARCH_WORD = 'periwinkle';
const LONG_TURN =
  'Sure. The staging numbers look fine: the p99 latency is back under 200 ms, the error rate ' +
  'stayed flat over the weekend, and the two flaky checks in the payment flow passed ten times ' +
  `in a row after the retry fix. The only open item is the ${SEARCH_WORD} banner on the pricing ` +
  'page, which design wants to review once more before the release candidate is cut.';
// A 1 by 1 PNG, the agent's avatar picture.
const AVATAR_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

test.use({ launchOptions: LAUNCH });

type Seed = {
  username: string;
  roomId: string;
  caller: Account;
  agent: Account;
  absentId: string;
  body: string;
};

const setAvatar = async (account: Account) => {
  const response = await fetch(`${HOMESERVER}/_matrix/media/v3/upload?filename=avatar.png`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${account.token}`, 'Content-Type': 'image/png' },
    body: AVATAR_PNG,
  });
  expect(response.ok).toBe(true);
  const { content_uri: avatarUrl } = (await response.json()) as { content_uri: string };
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(account.userId)}/avatar_url`, {
    method: 'PUT',
    accessToken: account.token,
    body: JSON.stringify({ avatar_url: avatarUrl }),
  });
};

const seed = async (label: string): Promise<Seed> => {
  const id = `${label}_${RUN}_${randomUUID().slice(0, 6)}`;
  const caller = await register(`ctc_${id}`, 'Robin Tester');
  const agent = await register(`mindroom_helper_${id}`, 'Helper');
  const colleague = await register(`ctc_kai_${id}`, 'Kai Colleague');
  await setAvatar(agent);
  await createOtherRooms(caller);
  const roomId = await withRetry(() =>
    createRoom(HOMESERVER, caller.token, {
      name: ROOM_NAME,
      invite: [agent.userId, colleague.userId],
    })
  );
  await join(agent, roomId);
  await join(colleague, roomId);
  await say(colleague, roomId, 'Can someone own the release notes this week?');
  await say(
    caller,
    roomId,
    'I will call the helper about the staging numbers and post what we find here before lunch.'
  );
  const server = caller.userId.slice(caller.userId.indexOf(':') + 1);
  const absentId = `@guest_${id}:${server}`;
  const turns = [
    { sender: caller.userId, text: 'Hi, can you hear me?' },
    { sender: caller.userId, text: 'How do the staging numbers look today?' },
    { sender: agent.userId, text: LONG_TURN },
    { sender: absentId, text: 'Sorry, I joined late. Is the release still on for Thursday?' },
    { sender: caller.userId, text: 'Yes, Thursday.' },
    { sender: agent.userId, text: 'I will post the summary in this room.' },
  ];
  // The plain and HTML bodies MindRoom writes beside the structured transcript.
  const speakerLabel = (sender: string) =>
    sender === caller.userId ? 'Robin Tester' : sender === agent.userId ? 'Helper' : sender;
  const lines = turns.map((turn) => `${speakerLabel(turn.sender)}: ${turn.text}`);
  const body = ['📞 Voice call · 3 min', 'Transcript', ...lines].join('\n\n');
  const html = turns
    .map((turn) => `<p><strong>${speakerLabel(turn.sender)}</strong>: ${turn.text}</p>`)
    .join('');
  await say(agent, roomId, body, undefined, {
    format: 'org.matrix.custom.html',
    formatted_body: `<p>📞 Voice call · 3 min</p><details><summary>Transcript</summary>${html}</details>`,
    'io.mindroom.call_transcript': { duration_seconds: 187, turns },
  });
  await say(caller, roomId, LAST_WORDS);
  return { username: caller.username, roomId, caller, agent, absentId, body };
};

const newPage = async (
  engine: (typeof ENGINES)[number],
  browser: Browser,
  options: BrowserContextOptions
) => {
  const owner = engine === 'webkit' ? await launchWebKit() : browser;
  const context = await owner.newContext(options);
  const page = await context.newPage();
  return {
    page,
    context,
    close: async () => {
      await context.close();
      if (owner !== browser) await owner.close();
    },
  };
};

const openRoom = async (page: Page, data: Seed) => {
  await page.goto(`/home/${encodeURIComponent(data.roomId)}`);
  await expect(page.getByText(LAST_WORDS).first()).toBeVisible({ timeout: 30_000 });
};

/** The row of the transcript message, scrolled into view. */
const callRow = async (page: Page) => {
  const row = page
    .locator('[data-message-id]')
    .filter({ has: page.locator('[data-call-transcript], summary') })
    .last();
  await row.scrollIntoViewIfNeeded();
  return row;
};

const card = (row: Locator) => row.locator('[data-call-transcript]');
const toggle = (row: Locator) => card(row).locator('button[aria-expanded]');
const groups = (row: Locator) => card(row).locator('[data-call-transcript-group]');

/**
 * Opens the transcript as the build renders it: the card's button, or the HTML fallback's
 * summary, so screenshots of either show the turns.
 */
const openTranscript = async (row: Locator, touch: boolean) => {
  const opener = toggle(row).or(row.locator('summary')).first();
  await (touch ? opener.tap() : opener.click());
};

type Shown = { sender: string | null; name: string; texts: string[]; picture: boolean };

const shownGroups = (row: Locator): Promise<Shown[]> =>
  groups(row).evaluateAll((nodes) =>
    nodes.map((node) => ({
      sender: node.getAttribute('data-user-id'),
      name: node.querySelector('[data-call-transcript-name]')?.textContent ?? '',
      texts: Array.from(node.querySelectorAll('[data-call-transcript-text]')).map(
        (text) => text.textContent ?? ''
      ),
      picture: !!node.querySelector('img'),
    }))
  );

/**
 * What is wrong with the open card's layout, or null: the card inside its message row and the
 * timeline, every avatar the same size at the start of its group (own turns too), every text
 * beside its avatar and inside the card, and the long turn wrapped onto several lines.
 */
const layoutProblem = (row: Locator) =>
  row.evaluate((rowNode) => {
    const cardNode = rowNode.querySelector('[data-call-transcript]');
    if (!cardNode) return 'no call card';
    const rtl = getComputedStyle(cardNode).direction === 'rtl';
    const c = cardNode.getBoundingClientRect();
    const r = rowNode.getBoundingClientRect();
    if (c.left < r.left - 0.5 || c.right > r.right + 0.5) return 'card outside its message row';
    let scroller: HTMLElement | null = rowNode.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    if (scroller && scroller.scrollWidth > scroller.clientWidth + 1) {
      return `timeline scrolls sideways (${scroller.scrollWidth} > ${scroller.clientWidth})`;
    }
    const groupNodes = Array.from(cardNode.querySelectorAll('[data-call-transcript-group]'));
    if (groupNodes.length === 0) return 'no transcript groups';
    const starts = new Set<number>();
    const sizes = new Set<string>();
    for (const group of groupNodes) {
      const avatar = group.querySelector('[data-call-transcript-avatar]');
      if (!avatar) return 'a group without an avatar';
      const a = avatar.getBoundingClientRect();
      sizes.add(`${Math.round(a.width)}x${Math.round(a.height)}`);
      starts.add(Math.round(rtl ? a.right : a.left));
      for (const text of Array.from(
        group.querySelectorAll('[data-call-transcript-text], [data-call-transcript-name]')
      )) {
        const t = text.getBoundingClientRect();
        if (rtl ? t.right > a.left + 0.5 : t.left < a.right - 0.5) return 'text over its avatar';
        if (t.left < c.left - 0.5 || t.right > c.right + 0.5) return 'text outside the card';
        if (text.scrollWidth > text.clientWidth + 1) return 'text cut off sideways';
      }
    }
    if (sizes.size !== 1) return `avatars of different sizes: ${[...sizes].join(', ')}`;
    if (starts.size !== 1) return 'groups start at different edges';
    const long = Array.from(cardNode.querySelectorAll('[data-call-transcript-text]')).find(
      (node) => (node.textContent ?? '').length > 200
    );
    if (!long) return 'no long turn';
    const lineHeight = parseFloat(getComputedStyle(long).lineHeight) || 20;
    if (long.getBoundingClientRect().height < lineHeight * 2) return 'long turn not wrapped';
    return null;
  });

const checkCard = async (page: Page, data: Seed, touch: boolean, look: string, info: TestInfo) => {
  const row = await callRow(page);
  await shot(page, info, `call-transcript-${look}-closed`);
  await openTranscript(row, touch);
  await (await callRow(page)).scrollIntoViewIfNeeded();
  await shot(page, info, `call-transcript-${look}-open`);

  // The card replaces the HTML: a header with the duration, a transcript that names its turns.
  await expect(card(row)).toBeVisible();
  await expect(row.locator('details')).toHaveCount(0);
  const header = card(row).locator('[data-call-transcript-header]');
  if (look.includes('-rtl-')) await expect(header).toContainText(/[3٣]/);
  else await expect(header).toHaveText(/Voice call\s*3 min/);
  await expect(toggle(row)).toHaveAttribute('aria-expanded', 'true');
  expect(await shownGroups(row)).toEqual([
    {
      sender: data.caller.userId,
      name: 'Robin Tester',
      texts: ['Hi, can you hear me?', 'How do the staging numbers look today?'],
      picture: false,
    },
    { sender: data.agent.userId, name: 'Helper', texts: [LONG_TURN], picture: true },
    {
      sender: data.absentId,
      name: data.absentId.slice(1, data.absentId.indexOf(':')),
      texts: ['Sorry, I joined late. Is the release still on for Thursday?'],
      picture: false,
    },
    { sender: data.caller.userId, name: 'Robin Tester', texts: ['Yes, Thursday.'], picture: false },
    {
      sender: data.agent.userId,
      name: 'Helper',
      texts: ['I will post the summary in this room.'],
      picture: true,
    },
  ]);
  // The agent's picture loaded; the others show a generated avatar.
  await expect
    .poll(() =>
      groups(row)
        .locator('img')
        .evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).naturalWidth > 0)
        )
    )
    .toBe(true);
  await expect(
    groups(row).filter({ hasText: 'Sorry, I joined late' }).locator('[data-avatar-fallback-id]')
  ).toHaveAttribute('data-avatar-fallback-id', data.absentId);
  expect(await layoutProblem(row), look).toBeNull();
};

/** Closes and opens the transcript from the keyboard: Enter and Space on its button. */
const checkKeyboard = async (page: Page) => {
  const row = await callRow(page);
  const button = toggle(row);
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(groups(row)).toHaveCount(0);
  await expect(button).toContainText('6 turns');
  await page.keyboard.press('Space');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(groups(row)).toHaveCount(5);
  const controlled = await button.getAttribute('aria-controls');
  expect(controlled).toBeTruthy();
  await expect(page.locator(`[id="${controlled}"]`)).toBeVisible();
};

const look = async (
  page: Page,
  data: Seed,
  scheme: Scheme,
  direction: 'ltr' | 'rtl',
  settings: { layout?: number; classic?: boolean } = {}
) => {
  await page.evaluate(
    ({ layout, classic, roomId }) => {
      const stored = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
      localStorage.setItem('settings', JSON.stringify({ ...stored, messageLayout: layout }));
      Object.keys(localStorage)
        .filter((key) => key.startsWith('roomViewMode:') && key.endsWith(`:${roomId}`))
        .forEach((key) => localStorage.removeItem(key));
      if (classic) localStorage.setItem(`roomViewMode:${roomId}`, JSON.stringify('classic'));
      else localStorage.removeItem(`roomViewMode:${roomId}`);
    },
    { layout: settings.layout ?? LAYOUT.modern, classic: !!settings.classic, roomId: data.roomId }
  );
  await setLook(page, scheme, direction);
  await page.reload();
  await openRoom(page, data);
};

const checkCopyAndSearch = async (page: Page, data: Seed, info: TestInfo) => {
  // Copy Text copies the plain transcript MindRoom wrote.
  const row = await callRow(page);
  await card(row).locator('[data-call-transcript-header]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy Text', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(data.body);

  // A search for a word of a turn shows the card open, the word marked.
  await page.goto(`/home/search/?${new URLSearchParams({ term: SEARCH_WORD, global: 'true' })}`);
  const hit = page.locator('article [data-event-id]').filter({ hasText: 'Voice call' }).first();
  await expect(hit).toBeVisible({ timeout: 30_000 });
  await expect(toggle(hit)).toHaveAttribute('aria-expanded', 'true');
  await expect(
    card(hit).locator('[data-call-transcript-text] span').filter({ hasText: SEARCH_WORD })
  ).toHaveCount(1);
  await shot(page, info, 'call-transcript-search');
};

for (const engine of ENGINES) {
  test(`a voice call transcript shows as a call card with a chat transcript: ${engine} desktop`, async ({
    browser,
  }, testInfo) => {
    test.skip(!(await homeserverIsUp()), 'Test homeserver is not running.');
    test.setTimeout(480_000);
    const data = await seed(`${engine}_d`);
    const { page, context, close } = await newPage(engine, browser, DESKTOP);
    try {
      await seedSettings(page, { isPeopleDrawer: false });
      await loginWithPassword(page, {
        homeserver: HOMESERVER,
        username: data.username,
        password: PASSWORD,
      });
      for (const [name, layout] of Object.entries(LAYOUT)) {
        for (const scheme of SCHEMES) {
          // eslint-disable-next-line no-await-in-loop
          await look(page, data, scheme, 'ltr', { layout });
          // eslint-disable-next-line no-await-in-loop
          await checkCard(page, data, false, `${engine}-desktop-ltr-${scheme}-${name}`, testInfo);
        }
      }
      await look(page, data, 'light', 'ltr', { classic: true });
      await checkCard(page, data, false, `${engine}-desktop-ltr-light-classic`, testInfo);
      await look(page, data, 'dark', 'rtl');
      await checkCard(page, data, false, `${engine}-desktop-rtl-dark-modern`, testInfo);
      await look(page, data, 'light', 'ltr');
      await checkCard(page, data, false, `${engine}-desktop-ltr-light-keyboard`, testInfo);
      await checkKeyboard(page);
      if (engine === 'chromium') {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await checkCopyAndSearch(page, data, testInfo);
      }
    } finally {
      await close();
    }
  });

  test(`a voice call transcript opens with a tap: ${engine} phone`, async ({
    browser,
  }, testInfo) => {
    test.skip(!(await homeserverIsUp()), 'Test homeserver is not running.');
    test.setTimeout(360_000);
    const data = await seed(`${engine}_p`);
    const { page, close } = await newPage(engine, browser, PHONE);
    try {
      await loginWithPassword(page, {
        homeserver: HOMESERVER,
        username: data.username,
        password: PASSWORD,
      });
      for (const scheme of SCHEMES) {
        for (const name of ['modern', 'bubble'] as const) {
          // eslint-disable-next-line no-await-in-loop
          await look(page, data, scheme, 'ltr', { layout: LAYOUT[name] });
          // eslint-disable-next-line no-await-in-loop
          await checkCard(page, data, true, `${engine}-phone-ltr-${scheme}-${name}`, testInfo);
        }
      }
      await look(page, data, 'light', 'rtl');
      await checkCard(page, data, true, `${engine}-phone-rtl-light-modern`, testInfo);
    } finally {
      await close();
    }
  });
}
