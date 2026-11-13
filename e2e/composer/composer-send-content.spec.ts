import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { activeAccountButton } from '../helpers/auth';
import { buildLoginPath } from '../env';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { leaveCompactView } from '../helpers/roomViewSwitch';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// What the composer sends and keeps, against the disposable homeserver of `just hs-up` or a slot
// of scripts/e2e-slot.sh, in Chromium and WebKit, on a desktop and on a phone, in a room with a
// day of messages for an account in 26 rooms:
// - after a reload, a draft keeps its reply target and names the staged files it lost;
// - `@room` is offered to someone who may notify the room and sends `m.mentions.room`; a member
//   below that level is not offered it;
// - a space typed after a picked mention does not double the one the pick added;
// - a Markdown table goes out as an HTML table;
// - Markdown links take the deployment's extra URI schemes (`obsidian`), as received ones do;
// - an unknown `/command` is refused with a notice and stays in the composer, unsent.
// COMPOSER_CONTENT_SHOTS names a directory for screenshots.

const PASSWORD = 'composer-content-password';
const SHOTS = process.env.COMPOSER_CONTENT_SHOTS;
const BASE_URL = `http://127.0.0.1:${process.env.E2E_PORT ?? process.env.E2E_APP_PORT ?? '4200'}`;
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

type RoomEvent = { type: string; sender: string; content: Record<string, unknown> };
type Session = { username: string; userId: string; accessToken: string };

const register = async (localpart: string, displayName: string): Promise<Session> => {
  const username = `${localpart}_${Date.now().toString(36)}`;
  const body = await matrixFetch<{ access_token: string; user_id: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(body.user_id)}/displayname`, {
    method: 'PUT',
    accessToken: body.access_token,
    body: JSON.stringify({ displayname: displayName }),
  });
  return { username, userId: body.user_id, accessToken: body.access_token };
};

const SEED_LINES = [
  'Morning! I pushed the release notes draft; the changelog section still needs the migration steps.',
  'Thanks. I will read it after the standup and leave comments inline where the wording is unclear.',
  'The staging deploy finished at 09:40 and the health checks have been green since then.',
  'Can someone confirm that the backup job ran last night? The dashboard shows a gap around 02:00.',
  'It ran, the gap is the metrics exporter restarting. The archive is in the usual bucket.',
];

/** An admin who created the room, a member at power 0, 25 more rooms, and a day of messages. */
const seedWorld = async (tag: string) => {
  const admin = await register(`cc_admin_${tag}`, 'Robin Admin');
  const member = await register(`cc_member_${tag}`, 'Wren Member');
  const roomId = await createRoom(HOMESERVER, admin.accessToken, {
    name: `Release desk ${tag}`,
    invite: [member.userId],
  });
  await joinRoom(HOMESERVER, member.accessToken, roomId);
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      createRoom(HOMESERVER, admin.accessToken, { name: `Project ${index + 1} ${tag}` })
    )
  );
  for (let index = 0; index < 30; index += 1) {
    const sender = index % 2 === 0 ? member : admin;
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, sender.accessToken, roomId, {
      msgtype: 'm.text',
      body: SEED_LINES[index % SEED_LINES.length] ?? '',
    });
  }
  return { admin, member, roomId };
};

const signIn = async (page: Page, username: string) => {
  await page.goto(buildLoginPath(HOMESERVER));
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(HOMESERVER, {
    timeout: 60_000,
  });
  await page.locator('input[name="usernameInput"]').fill(username);
  await page.locator('input[name="passwordInput"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(activeAccountButton(page)).toBeVisible({
    timeout: 120_000,
  });
};

const composer = (page: Page) => page.locator('[data-editable-name="RoomInput"]');

const openRoom = async (page: Page, roomId: string) => {
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  await expect(composer(page)).toBeVisible({ timeout: 60_000 });
  // The Full view shows sent messages as rows, the plainest place to read what was sent.
  await leaveCompactView(page);
};

const latestMessages = async (token: string, roomId: string) => {
  const { chunk } = await matrixFetch<{ chunk: RoomEvent[] }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=50`,
    { accessToken: token }
  );
  return chunk.filter((event) => event.type === 'm.room.message');
};

/** The event of the message whose body starts with `marker`, once the server has it. */
const sentEvent = async (token: string, roomId: string, marker: string) => {
  let found: RoomEvent | undefined;
  await expect
    .poll(
      async () => {
        found = (await latestMessages(token, roomId)).find((event) =>
          String(event.content.body).startsWith(marker)
        );
        return found !== undefined;
      },
      { timeout: 30_000, message: `the server has "${marker}"` }
    )
    .toBe(true);
  return found as RoomEvent;
};

type Form = 'desktop' | 'phone';

/** Sends what the composer holds: Enter on a desktop, the Send button on a phone. */
const sendComposer = async (page: Page, form: Form) => {
  if (form === 'phone') await page.getByRole('button', { name: 'Send message' }).click();
  else await page.keyboard.press('Enter');
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A row of the mention menu (an option of its list box): its name and what it names, a Matrix ID
 * or what `@room` does.
 */
const suggestionRow = (page: Page, label: string, detail: string) =>
  page.getByRole('option', { name: new RegExp(`${escapeRegex(label)}.*${escapeRegex(detail)}`) });

/** Picks a suggestion of the open mention menu: Enter on a desktop, a tap on a phone. */
const pickSuggestion = async (page: Page, form: Form, suggestion: Locator) => {
  await expect(suggestion).toBeVisible({ timeout: 20_000 });
  if (form === 'phone') await suggestion.tap();
  else await page.keyboard.press('Enter');
  await expect(suggestion).toHaveCount(0);
  // Typing goes on in the text box, after the pill: a tap leaves the focus there.
  await expect(composer(page)).toBeFocused();
};

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

type World = Awaited<ReturnType<typeof seedWorld>>;
type Check = (page: Page, world: World, context: CheckContext) => Promise<void>;
type CheckContext = {
  browser: Browser;
  options: BrowserContextOptions;
  form: Form;
  tag: string;
  where: string;
};

/** Seeds a room, signs its admin in on a desktop or a phone, opens the room, runs `check`. */
const inComposer = async (browser: Browser, engine: string, form: Form, check: Check) => {
  const tag = `${engine[0]}${form[0]}${Math.random().toString(36).slice(2, 6)}`;
  const world = await seedWorld(tag);
  const viewport = form === 'phone' ? PHONE : DESKTOP;
  const options: BrowserContextOptions = {
    viewport,
    hasTouch: form === 'phone',
    baseURL: BASE_URL,
  };
  const context = await browser.newContext(options);
  try {
    const page = await context.newPage();
    await signIn(page, world.admin.username);
    await openRoom(page, world.roomId);
    await composer(page).click();
    await check(page, world, { browser, options, form, tag, where: `${engine} ${form}` });
  } finally {
    await context.close();
  }
};

// @room: offered to the room's creator, inserted as a pill, sent as an intentional mention; a
// member at power 0 is not offered it.
const roomMention: Check = async (page, world, { browser, options, form, tag, where }) => {
  const marker = `R${tag}`;
  await page.keyboard.type(`${marker} please read @roo`);
  await shot(page, `room-mention-${tag}`);
  await pickSuggestion(page, form, suggestionRow(page, '@room', 'Notify everyone'));
  await page.keyboard.type('before noon');
  await sendComposer(page, form);
  const event = await sentEvent(world.admin.accessToken, world.roomId, marker);
  expect(event.content.body, `${where}: @room body`).toBe(
    `${marker} please read @room before noon`
  );
  expect(event.content['m.mentions'], `${where}: @room mentions`).toEqual({ room: true });

  const memberContext = await browser.newContext(options);
  try {
    const memberPage = await memberContext.newPage();
    await signIn(memberPage, world.member.username);
    await openRoom(memberPage, world.roomId);
    await composer(memberPage).click();
    await memberPage.keyboard.type('please read @Rob');
    await expect(suggestionRow(memberPage, 'Robin Admin', world.admin.userId)).toBeVisible({
      timeout: 20_000,
    });
    for (let count = 0; count < 3; count += 1) {
      // eslint-disable-next-line no-await-in-loop
      await memberPage.keyboard.press('Backspace');
    }
    await memberPage.keyboard.type('roo');
    // The mention menu answers within a frame or two; give it a generous moment.
    await memberPage.waitForTimeout(1_500);
    await expect(suggestionRow(memberPage, '@room', 'Notify everyone')).toHaveCount(0);
    await shot(memberPage, `room-mention-member-${tag}`);
  } finally {
    await memberContext.close();
  }
};

// A member pill, then a typed space: one space after `@` and the name in the plain body.
const spaceAfterPill: Check = async (page, world, { form, tag, where }) => {
  const marker = `U${tag}`;
  await page.keyboard.type(`${marker} hello @Wren`);
  await pickSuggestion(page, form, suggestionRow(page, 'Wren Member', world.member.userId));
  await page.keyboard.type(' and thanks');
  await shot(page, `space-after-pill-${tag}`);
  await sendComposer(page, form);
  const event = await sentEvent(world.admin.accessToken, world.roomId, marker);
  expect(event.content.body, `${where}: one space after a pill`).toBe(
    `${marker} hello @Wren Member and thanks`
  );
  expect(event.content['m.mentions'], `${where}: user mentions`).toEqual({
    user_ids: [world.member.userId],
  });
};

// A Markdown table goes out as a table and shows as one.
const markdownTable: Check = async (page, world, { form, tag, where }) => {
  const marker = `T${tag}`;
  const rows = [
    `${marker} release table`,
    '| Service | Status |',
    '| --- | --- |',
    '| api | green |',
    '| worker | **amber** |',
  ];
  for (const [index, row] of rows.entries()) {
    // eslint-disable-next-line no-await-in-loop
    if (index > 0) await page.keyboard.press('Shift+Enter');
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.type(row);
  }
  await sendComposer(page, form);
  const event = await sentEvent(world.admin.accessToken, world.roomId, marker);
  expect(String(event.content.formatted_body), `${where}: a table is sent`).toContain(
    '<table data-md="|"><thead><tr><th>Service</th><th>Status</th></tr></thead>'
  );
  const row = page.locator('[data-message-id]').filter({ hasText: marker }).last();
  await expect(row.locator('table th').first(), `${where}: the table shows`).toHaveText('Service', {
    timeout: 30_000,
  });
  await expect(row.locator('table td strong')).toHaveText('amber');
  await shot(page, `table-${tag}`);
};

// Markdown links take the configured `obsidian` scheme; `javascript:` stays text.
const configuredLinks: Check = async (page, world, { form, tag, where }) => {
  const marker = `L${tag}`;
  await page.keyboard.type(
    `${marker} notes in [the vault](obsidian://open?vault=release) and [docs](https://example.org/docs), not [this](javascript:alert(1))`
  );
  await sendComposer(page, form);
  const event = await sentEvent(world.admin.accessToken, world.roomId, marker);
  const html = String(event.content.formatted_body);
  expect(html, `${where}: obsidian link sent`).toContain(
    '<a data-md href="obsidian://open?vault=release">the vault</a>'
  );
  expect(html, `${where}: https link sent`).toContain(
    '<a data-md href="https://example.org/docs">docs</a>'
  );
  expect(html, `${where}: javascript link refused`).not.toContain('href="javascript');
  const row = page.locator('[data-message-id]').filter({ hasText: marker }).last();
  await expect(row.locator('a[href="obsidian://open?vault=release"]')).toHaveText('the vault', {
    timeout: 30_000,
  });
  await shot(page, `links-${tag}`);
};

// An unknown command is refused with a notice and stays in the composer, unsent.
const unknownCommand: Check = async (page, world, { form, tag, where }) => {
  const before = (await latestMessages(world.admin.accessToken, world.roomId)).length;
  // A command name is letters only.
  const name = `foobar${tag.replace(/[^a-z]/g, '')}`;
  const typed = `/${name} unknown command`;
  await page.keyboard.type(typed);
  await sendComposer(page, form);
  await expect(
    page.getByRole('alert').filter({ hasText: `/${name} is not a command.` }),
    `${where}: unknown command refused`
  ).toBeVisible({ timeout: 10_000 });
  await expect(composer(page)).toContainText(typed);
  await shot(page, `unknown-command-${tag}`);
  // Long enough for a send to reach the server.
  await page.waitForTimeout(2_000);
  expect((await latestMessages(world.admin.accessToken, world.roomId)).length).toBe(before);
};

// A 1 by 1 pixel PNG, for an image card.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64'
);

// After a reload, a draft keeps its reply target, and names the staged files it could not keep.
const draftAfterReload: Check = async (page, world, { form, tag, where }) => {
  const original = `O${tag} original message to answer`;
  const originalId = await sendRoomMessage(HOMESERVER, world.member.accessToken, world.roomId, {
    msgtype: 'm.text',
    body: original,
  });
  const row = page.locator('[data-message-id]').filter({ hasText: original }).last();
  await expect(row).toBeVisible({ timeout: 30_000 });
  const reply = row.getByRole('button', { name: 'Reply', exact: true });
  if (form === 'phone') {
    await row.getByText(original).tap();
    await reply.tap();
  } else {
    await row.getByText(original).hover();
    await reply.click();
  }
  const cancelReply = page.getByRole('button', { name: 'Cancel reply' });
  await expect(cancelReply).toBeVisible();

  const chooser = page.waitForEvent('filechooser');
  if (form === 'phone') {
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Attach files' }).click();
  } else {
    await page.getByRole('button', { name: 'Attach files' }).click();
  }
  await (
    await chooser
  ).setFiles([
    {
      name: 'notes01.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Release notes, part one.'),
    },
    { name: 'sample.png', mimeType: 'image/png', buffer: PNG },
  ]);
  await expect(page.getByText('notes01.txt', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('sample.png', { exact: true })).toBeVisible();
  const caption = `D${tag} caption with reply`;
  await composer(page).click();
  await page.keyboard.type(caption);
  await shot(page, `draft-staged-${tag}`);

  await page.reload();
  await expect(composer(page)).toContainText(caption, { timeout: 60_000 });
  await expect(cancelReply, `${where}: the reply bar comes back`).toBeVisible({
    timeout: 20_000,
  });
  const notice = page.getByRole('status').filter({ hasText: 'notes01.txt' });
  await expect(notice, `${where}: the lost files are named`).toContainText('sample.png');
  // A wrapped notice keeps its dismiss button at full size.
  const dismiss = await notice.getByRole('button', { name: 'Dismiss' }).boundingBox();
  expect(dismiss?.width, `${where}: dismiss button width`).toBeGreaterThanOrEqual(24);
  expect(dismiss?.height, `${where}: dismiss button height`).toBeGreaterThanOrEqual(24);
  await shot(page, `draft-reloaded-${tag}`);

  await composer(page).click();
  await page.keyboard.press('End');
  await sendComposer(page, form);
  const sent = await sentEvent(world.admin.accessToken, world.roomId, caption);
  const relation = sent.content['m.relates_to'] as
    | { 'm.in_reply_to'?: { event_id?: string } }
    | undefined;
  expect(relation?.['m.in_reply_to']?.event_id, `${where}: sent as the reply`).toBe(originalId);
  await expect(notice, `${where}: sending answers the notice`).toHaveCount(0);
  await expect(cancelReply).toHaveCount(0);
};

const CHECKS: Array<[string, Check]> = [
  ['keeps the reply and names the lost files of a draft after a reload', draftAfterReload],
  ['offers @room only to who may notify the room, and sends m.mentions.room', roomMention],
  ['sends one space after a picked mention when a space is typed', spaceAfterPill],
  ['sends a Markdown table as a table', markdownTable],
  ['sends Markdown links with the configured extra schemes', configuredLinks],
  ['refuses an unknown slash command and keeps the text', unknownCommand],
];

// Each test has its own accounts and room, so they may run side by side.
test.describe.configure({ mode: 'parallel' });

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

for (const [title, check] of CHECKS) {
  for (const form of ['desktop', 'phone'] as const) {
    test(`composer ${title} (Chromium, ${form})`, async ({ browser }) => {
      test.setTimeout(240_000);
      await inComposer(browser, 'chromium', form, check);
    });

    test(`composer ${title} (WebKit, ${form})`, async () => {
      test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
      test.setTimeout(240_000);
      const browser = await launchWebKit();
      try {
        await inComposer(browser, 'webkit', form, check);
      } finally {
        await browser.close();
      }
    });
  }
}
