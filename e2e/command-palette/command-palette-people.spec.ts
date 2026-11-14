import { crc32, deflateSync } from 'node:zlib';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { matrixFetch } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import { pressPaletteShortcut } from '../helpers/paletteShortcut';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// Cmd+K's People against a real homeserver and its real `POST /user_directory/search`: people the
// account shares no room with come from the server below the ones it knows, Enter asks before it
// starts a direct chat, the invite reaches the other person, and the next Enter on them opens
// that chat instead of a second one. A Matrix ID typed in full gets a "Message" row.
//
// The account sits in 26 rooms with 3 other people. Of the people it shares no room with, Quinn
// Harper, Quinn Lindqvist and Lena Reyes are in public rooms of their own, which is what lets the
// server's directory list them (Tuwunel's default), and Dana Whitfield is in no room at all.
// Set PEOPLE_SHOTS=<directory> to also save the L26 screenshots.
const SERVER_NAME = 'matrix.localhost';
const PASSWORD = 'command-palette-people-spec-password';
const SHOTS = process.env.PEOPLE_SHOTS;
const DIRECTORY_DELAY_MS = 3_000;
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit (the iPhone engine), for its own test.

type Account = { username: string; userId: string; accessToken: string; name: string };

/** Retries what the server refuses with 429, after a growing wait. */
const withRetry = async <T>(run: () => Promise<T>): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt > 8 || !String(error).includes('Matrix API 429')) throw error;
      await new Promise((resolve) => {
        setTimeout(resolve, 500 * (attempt + 1));
      });
    }
  }
};

const register = async (prefix: string, run: string, name: string): Promise<Account> => {
  const username = `${prefix}_${run}`;
  const body = await matrixFetch<{ user_id: string; access_token: string }>(
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
    body: JSON.stringify({ displayname: name }),
  });
  return { username, userId: body.user_id, accessToken: body.access_token, name };
};

/** A square PNG of one color, `edge` pixels wide. */
const solidPng = (edge: number, rgb: [number, number, number]): Buffer => {
  const chunk = (type: string, data: Buffer) => {
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const check = Buffer.alloc(4);
    check.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, check]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(edge, 0);
  header.writeUInt32BE(edge, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const line = Buffer.from([0, ...Array.from({ length: edge }, () => rgb).flat()]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: edge }, () => line)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const setAvatar = async (account: Account, rgb: [number, number, number]) => {
  const response = await fetch(`${HOMESERVER}/_matrix/media/v3/upload?filename=avatar.png`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'image/png' },
    body: solidPng(64, rgb),
  });
  expect(response.ok).toBe(true);
  const { content_uri: avatarUrl } = (await response.json()) as { content_uri: string };
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(account.userId)}/avatar_url`, {
    method: 'PUT',
    accessToken: account.accessToken,
    body: JSON.stringify({ avatar_url: avatarUrl }),
  });
};

/** A room with public join rules, which puts its members in the user directory. */
const createPublicRoom = async (owner: Account, name: string): Promise<string> => {
  const body = await withRetry(() =>
    matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
      method: 'POST',
      accessToken: owner.accessToken,
      body: JSON.stringify({ preset: 'public_chat', name, topic: `${name} for everyone` }),
    })
  );
  return body.room_id;
};

const join = (account: Account, roomId: string) =>
  withRetry(() =>
    matrixFetch(HOMESERVER, `/join/${encodeURIComponent(roomId)}`, {
      method: 'POST',
      accessToken: account.accessToken,
      body: '{}',
    })
  );

const inBatches = async <T>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<unknown>
) => {
  for (let start = 0; start < items.length; start += size) {
    await Promise.all(items.slice(start, start + size).map(work));
  }
};

const ROOM_NAMES = [
  'Design Review',
  'Release Planning',
  'Ops Handbook',
  'Frontend Guild',
  'Backend Sync',
  'Customer Calls',
  'Hiring Loop',
  'Data Science',
  'Mobile App',
  'Security Desk',
  'Docs Corner',
  'Marketing Launch',
  'Sales Pipeline',
  'Support Queue',
  'Infra Budget',
  'Quarterly Goals',
  'Team Lunch',
  'Book Club',
  'Coffee Chat',
  'Research Notes',
  'Partner Updates',
  'Billing Questions',
  'Onboarding Buddies',
  'Accessibility Audit',
  'Performance Week',
  'Hackathon Ideas',
] as const;

type Seed = Awaited<ReturnType<typeof seed>>;

const seed = async () => {
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const [viewer, harper, lindqvist, okafor, bauer, priya, reyes, whitfield] = await Promise.all([
    register('pdir_viewer', run, 'Avery Stone'),
    register('pdir_harper', run, 'Quinn Harper'),
    register('pdir_lindqvist', run, 'Quinn Lindqvist'),
    register('pdir_okafor', run, 'Quinn Okafor'),
    register('pdir_bauer', run, 'Quinn Bauer'),
    register('pdir_priya', run, 'Priya Raman'),
    register('pdir_reyes', run, 'Lena Reyes'),
    register('pdir_whitfield', run, 'Dana Whitfield'),
  ]);
  await setAvatar(harper, [214, 96, 46]);
  await setAvatar(lindqvist, [126, 72, 196]);
  await setAvatar(okafor, [46, 120, 214]);

  const rooms: string[] = [];
  await inBatches(ROOM_NAMES, 6, async (name) => {
    rooms.push(await createPublicRoom(viewer, name));
  });
  // The people the account knows share some of its rooms.
  await inBatches(
    rooms
      .slice(0, 4)
      .flatMap((roomId) => [okafor, bauer, priya].map((person) => ({ person, roomId }))),
    6,
    ({ person, roomId }) => join(person, roomId)
  );
  // The ones it does not know are each in a public room of their own.
  await createPublicRoom(harper, "Harper's Workshop");
  await createPublicRoom(lindqvist, 'Lindqvist Atelier');
  await createPublicRoom(reyes, 'Reyes Studio');

  return { viewer, harper, lindqvist, okafor, bauer, priya, reyes, whitfield };
};

let seeded: Seed | undefined;

const login = async (page: Page) => {
  if (!seeded) throw new Error('not seeded');
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seeded.viewer.username,
    password: PASSWORD,
  });
};

const palette = (page: Page) => page.getByRole('dialog', { name: 'Command palette', exact: true });
const field = (page: Page) => palette(page).getByRole('combobox');
const options = (page: Page, kind?: string) =>
  palette(page).locator(kind ? `[role="option"][data-kind="${kind}"]` : '[role="option"]');
const person = (page: Page, account: Account) =>
  palette(page).locator(`[role="option"][data-item-id="user:${account.userId}"]`);
const highlighted = (page: Page) => palette(page).locator('[role="option"][aria-selected="true"]');
const peopleSection = (page: Page) => palette(page).locator('[role="group"][data-section="users"]');
const optionIds = (page: Page) =>
  options(page).evaluateAll((rows) => rows.map((row) => row.getAttribute('data-item-id')));

const openPalette = async (page: Page) => {
  await pressPaletteShortcut(page);
  await expect(field(page)).toBeFocused();
};

const openPeopleTab = async (page: Page) => {
  await palette(page).getByRole('tab', { name: 'People', exact: true }).click();
  await expect(palette(page).getByRole('tab', { selected: true })).toHaveText('People');
};

const isDirectorySearch = (url: string) =>
  new URL(url).pathname === '/_matrix/client/v3/user_directory/search';

/** A user directory answer to the palette's search for `term`. */
const directoryAnswer = (page: Page, term: string) =>
  page.waitForResponse(
    (response) =>
      isDirectorySearch(response.url()) &&
      (response.request().postDataJSON() as { search_term?: string } | null)?.search_term === term
  );
const isCreateRoom = (url: string) => new URL(url).pathname === '/_matrix/client/v3/createRoom';

/** Counts the rooms this page asks the server to create. */
const countCreatedRooms = (page: Page) => {
  const counter = { value: 0 };
  page.on('request', (request) => {
    if (request.method() === 'POST' && isCreateRoom(request.url())) counter.value += 1;
  });
  return counter;
};

const directRooms = async (account: Account): Promise<Record<string, string[]>> => {
  try {
    return await matrixFetch<Record<string, string[]>>(
      HOMESERVER,
      `/user/${encodeURIComponent(account.userId)}/account_data/m.direct`,
      { accessToken: account.accessToken }
    );
  } catch (error) {
    if (String(error).includes('Matrix API 404')) return {};
    throw error;
  }
};

/**
 * The invites `account` sees in its sync, each with whether its invite event is marked as a
 * direct chat (undefined when the server leaves that event out of the invite state).
 */
const invitesOf = async (account: Account): Promise<Map<string, boolean | undefined>> => {
  const sync = await matrixFetch<{
    rooms?: {
      invite?: Record<
        string,
        {
          invite_state?: {
            events?: { type: string; state_key?: string; content?: { is_direct?: boolean } }[];
          };
        }
      >;
    };
  }>(HOMESERVER, '/sync?timeout=0', { accessToken: account.accessToken });
  return new Map(
    Object.entries(sync.rooms?.invite ?? {}).map(([roomId, room]) => {
      const invite = room.invite_state?.events?.find(
        (event) => event.type === 'm.room.member' && event.state_key === account.userId
      );
      return [roomId, invite && invite.content?.is_direct === true];
    })
  );
};

/** `account` sees the invite to `roomId`, marked as a direct chat when the server says. */
const expectDirectInvite = async (account: Account, roomId: string) => {
  await expect.poll(async () => (await invitesOf(account)).has(roomId)).toBe(true);
  expect((await invitesOf(account)).get(roomId)).not.toBe(false);
};

/** The room the page shows, if it shows one. */
const roomIdInUrl = (page: Page): string | undefined =>
  decodeURIComponent(new URL(page.url()).pathname).match(/\/(![^/]+)/)?.[1];

/** The row's picture has loaded, rather than the fallback letter. */
const expectAvatarLoaded = async (row: Locator) => {
  const image = row.locator('img');
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBeGreaterThan(0);
};

const shoot = async (target: Page | Locator, name: string) => {
  if (SHOTS) await target.screenshot({ path: `${SHOTS}/L26-palette-people-${name}.png` });
};

// Headless Chromium hides scrollbars; desktop browsers with classic scrollbars show them.
test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

test.describe.configure({ mode: 'serial', timeout: 180_000 });

test.beforeAll(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  const started = Date.now();
  seeded = await seed();
  console.log(`seeded ${ROOM_NAMES.length + 3} rooms and 8 people in ${Date.now() - started} ms`);
});

test('a person the account shares no room with comes from the server', async ({ page }) => {
  const { harper } = seeded!;
  await login(page);
  await openPalette(page);
  const answer = directoryAnswer(page, 'harp');
  await field(page).fill('harp');
  const body = (await (await answer).json()) as { results: { user_id: string }[] };
  expect(body.results.map((user) => user.user_id)).toContain(harper.userId);

  const row = person(page, harper);
  await expect(row).toBeVisible();
  await expect(row).toContainText('Quinn Harper');
  await expect(row).toContainText(harper.userId);
  await expectAvatarLoaded(row);
  // It sits in People on All.
  await expect(peopleSection(page).locator(`[data-item-id="user:${harper.userId}"]`)).toHaveCount(
    1
  );
});

test('Enter asks first, then starts the chat, and the other person gets the invite', async ({
  page,
}) => {
  const { viewer, harper } = seeded!;
  const created = countCreatedRooms(page);
  await login(page);
  await openPalette(page);
  await field(page).fill('harp');
  const row = person(page, harper);
  await expect(row).toBeVisible();
  await row.hover();
  await expect(row).toHaveAttribute('aria-selected', 'true');

  await field(page).press('Enter');
  const question = options(page, 'start-chat');
  await expect(question).toHaveCount(1);
  await expect(question).toContainText('Start a chat with Quinn Harper?');
  await expect(question).toContainText(`Sends an invite to ${harper.userId}.`);
  await expect(question).toHaveAttribute('aria-selected', 'true');
  await expect(options(page)).toHaveCount(1);
  await shoot(page, 'confirm');

  // Escape goes back to the people, with Quinn still highlighted; nothing was created.
  await field(page).press('Escape');
  await expect(palette(page)).toBeVisible();
  await expect(question).toHaveCount(0);
  await expect(highlighted(page)).toHaveAttribute('data-item-id', `user:${harper.userId}`);
  await expect(field(page)).toHaveValue('harp');
  expect(created.value).toBe(0);

  await field(page).press('Enter');
  await expect(question).toHaveCount(1);
  const creation = page.waitForResponse(
    (response) => isCreateRoom(response.url()) && response.request().method() === 'POST'
  );
  await field(page).press('Enter');
  const { room_id: roomId } = (await (await creation).json()) as { room_id: string };
  await expect(palette(page)).toHaveCount(0);
  await expect.poll(() => roomIdInUrl(page)).toBe(roomId);
  expect(new URL(page.url()).pathname.startsWith('/direct/')).toBe(true);
  expect(created.value).toBe(1);

  await expect.poll(async () => (await directRooms(viewer))[harper.userId]).toEqual([roomId]);
  await expectDirectInvite(harper, roomId);
  const encryption = await matrixFetch<{ algorithm: string }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/state/m.room.encryption/`,
    { accessToken: viewer.accessToken }
  );
  expect(encryption.algorithm).toBe('m.megolm.v1.aes-sha2');
});

test('the same person again opens that chat, and no second room is created', async ({ page }) => {
  const { viewer, harper } = seeded!;
  const [roomId] = (await directRooms(viewer))[harper.userId] ?? [];
  expect(roomId).toBeTruthy();
  const created = countCreatedRooms(page);
  await login(page);
  await openPalette(page);
  await field(page).fill('harp');
  const row = person(page, harper);
  // The chat makes Quinn someone the account knows: the row is there before any server answer.
  await expect(row).toBeVisible();
  await row.hover();
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await field(page).press('Enter');
  await expect(palette(page)).toHaveCount(0);
  await expect.poll(() => roomIdInUrl(page)).toBe(roomId);
  expect(created.value).toBe(0);
  expect((await directRooms(viewer))[harper.userId]).toEqual([roomId]);
});

test('a Matrix ID typed in full gets a Message row, with or without a profile', async ({
  page,
}) => {
  const { whitfield } = seeded!;
  const created = countCreatedRooms(page);
  await login(page);
  await openPalette(page);
  await openPeopleTab(page);

  // Dana is in no room, so the directory does not list her; her profile names her.
  const answer = directoryAnswer(page, whitfield.userId.slice(1));
  await field(page).fill(whitfield.userId);
  const body = (await (await answer).json()) as { results: { user_id: string }[] };
  expect(body.results.map((user) => user.user_id)).not.toContain(whitfield.userId);
  const row = person(page, whitfield);
  await expect(row).toContainText(`Message ${whitfield.userId}`);
  await expect(row).toContainText('Dana Whitfield');

  // An ID with no account behind it is still offered, with the ID alone.
  const nobody = `@pdir_nobody_${Date.now().toString(36)}:${SERVER_NAME}`;
  await field(page).fill(nobody);
  const nobodyRow = palette(page).locator(`[role="option"][data-item-id="user:${nobody}"]`);
  await expect(nobodyRow).toContainText(`Message ${nobody}`);
  await expect(nobodyRow.locator('img')).toHaveCount(0);

  // Choosing the row asks first, like any person.
  await field(page).fill(whitfield.userId);
  await expect(row).toBeVisible();
  await row.click();
  await expect(options(page, 'start-chat')).toContainText('Start a chat with Dana Whitfield?');
  await field(page).press('Escape');
  await expect(row).toBeVisible();
  expect(created.value).toBe(0);
});

test('with the directory 3 s late, local people show first and the highlight stays put', async ({
  page,
}) => {
  // Quinn Harper has a chat with the account by now, so only Quinn Lindqvist waits for the server.
  const { harper, lindqvist, okafor, bauer } = seeded!;
  await login(page);
  let answered = 0;
  page.on('response', (response) => {
    const body = response.request().postDataJSON() as { search_term?: string } | null;
    if (isDirectorySearch(response.url()) && body?.search_term === 'quinn') answered += 1;
  });
  // The real server answers, 3 seconds late.
  await page.route(
    (url) => isDirectorySearch(url.href),
    async (route) => {
      await new Promise((resolve) => {
        setTimeout(resolve, DIRECTORY_DELAY_MS);
      });
      await route.continue();
    }
  );

  await openPalette(page);
  await openPeopleTab(page);
  const typed = Date.now();
  await field(page).fill('quinn');
  await expect(person(page, okafor)).toBeVisible();
  await expect(person(page, bauer)).toBeVisible();
  await expect(person(page, harper)).toBeVisible();
  const localMs = Date.now() - typed;
  // Only People waits, with a spinner beside its title.
  await expect(peopleSection(page)).toHaveAttribute('aria-busy', 'true');
  await expect(person(page, lindqvist)).toHaveCount(0);
  expect(answered).toBe(0);
  expect(localMs).toBeLessThan(DIRECTORY_DELAY_MS);

  await field(page).press('ArrowDown');
  const before = await optionIds(page);
  const chosen = await highlighted(page).getAttribute('data-item-id');
  expect(chosen).toBe(before[1]);
  const chosenBox = await highlighted(page).boundingBox();

  await expect(person(page, lindqvist)).toBeVisible({ timeout: 15_000 });
  const serverMs = Date.now() - typed;
  expect(serverMs).toBeGreaterThanOrEqual(DIRECTORY_DELAY_MS);
  expect(answered).toBeGreaterThan(0);
  await expect(peopleSection(page)).not.toHaveAttribute('aria-busy', 'true');
  await expect(highlighted(page)).toHaveAttribute('data-item-id', chosen!);
  expect(await highlighted(page).boundingBox()).toEqual(chosenBox);
  const after = await optionIds(page);
  expect(after.slice(0, before.length)).toEqual(before);
  expect(after.indexOf(`user:${lindqvist.userId}`)).toBeGreaterThanOrEqual(before.length);
  await expectAvatarLoaded(person(page, lindqvist));
  await expectAvatarLoaded(person(page, okafor));
  await shoot(page, 'server');
  console.log(`local people ${localMs} ms after typing; server people ${serverMs} ms`);
});

test('Create Chat still starts the same kind of direct chat', async ({ page }) => {
  const { viewer, whitfield } = seeded!;
  await login(page);
  await page.goto(`/direct/create/?${new URLSearchParams({ userId: whitfield.userId })}`);
  const creation = page.waitForResponse(
    (response) => isCreateRoom(response.url()) && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const { room_id: roomId } = (await (await creation).json()) as { room_id: string };
  await expect.poll(() => roomIdInUrl(page)).toBe(roomId);
  await expect.poll(async () => (await directRooms(viewer))[whitfield.userId]).toEqual([roomId]);
  await expectDirectInvite(whitfield, roomId);
  const encryption = await matrixFetch<{ algorithm: string }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/state/m.room.encryption/`,
    { accessToken: viewer.accessToken }
  );
  expect(encryption.algorithm).toBe('m.megolm.v1.aes-sha2');
});

test.describe('on a phone', () => {
  test.use({ hasTouch: true });

  test('a server person is found and a tap starts the chat', async ({ page }) => {
    const { viewer, reyes } = seeded!;
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await openPalette(page);
    await field(page).fill('reyes');
    const row = person(page, reyes);
    await expect(row).toBeVisible();
    await expect(row).toContainText('Lena Reyes');
    await expect(row).toContainText(reyes.userId);
    const box = (await row.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    const results = palette(page).getByRole('tabpanel');
    expect(await results.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);

    await row.tap();
    const question = options(page, 'start-chat');
    await expect(question).toContainText('Start a chat with Lena Reyes?');
    await expect(question).toBeInViewport();
    const creation = page.waitForResponse(
      (response) => isCreateRoom(response.url()) && response.request().method() === 'POST'
    );
    await question.tap();
    const { room_id: roomId } = (await (await creation).json()) as { room_id: string };
    await expect(palette(page)).toHaveCount(0);
    await expect.poll(() => roomIdInUrl(page)).toBe(roomId);
    await expect.poll(async () => (await directRooms(viewer))[reyes.userId]).toEqual([roomId]);
    await expectDirectInvite(reyes, roomId);
  });
});

test('People rows and the question lay out the same in WebKit', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, "Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright's WebKit");
  const { okafor, lindqvist } = seeded!;
  // The file's launch options carry a Chromium flag WebKit refuses.
  const browser = await launchWebKit();
  try {
    const page = await (await browser.newContext({ baseURL })).newPage();
    await login(page);
    await openPalette(page);
    await openPeopleTab(page);
    await field(page).fill('quinn');
    const known = person(page, okafor);
    const found = person(page, lindqvist);
    await expect(known).toBeVisible();
    await expect(found).toBeVisible({ timeout: 15_000 });
    await expectAvatarLoaded(found);
    for (const row of [known, found]) {
      const rowBox = (await row.boundingBox())!;
      const avatarBox = (await row.locator('img').boundingBox())!;
      // A round picture inside the row, beside one line for the name and one for the ID.
      expect(Math.round(avatarBox.width)).toBe(Math.round(avatarBox.height));
      expect(avatarBox.y).toBeGreaterThanOrEqual(rowBox.y);
      expect(avatarBox.y + avatarBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height);
      expect(rowBox.height).toBeLessThanOrEqual(64);
    }
    const results = palette(page).getByRole('tabpanel');
    expect(await results.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);

    await found.click();
    await expect(options(page, 'start-chat')).toContainText('Start a chat with Quinn Lindqvist?');
    await field(page).press('Escape');
    await expect(found).toBeVisible();
  } finally {
    await browser.close();
  }
});
