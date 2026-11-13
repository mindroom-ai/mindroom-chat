import { mkdirSync } from 'node:fs';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { joinRoom, matrixFetch, type MatrixSession } from '../helpers/matrix';
import { pressPaletteShortcut } from '../helpers/paletteShortcut';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Cmd+K's People must put the person whose whole name was typed first, so Enter opens their chat.
// The account has a direct chat with Alex Kim and shares a room with Alex Lim and Alex Kay, whose
// user names follow their names; typing "Alex Lim" must not leave Alex Kim, whose chat Enter would
// open, on top.
// Runs in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit,
// against the disposable homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh. Set
// PEOPLE_RANK_SHOTS=<directory> to save screenshots.
const PASSWORD = 'palette-people-ranking-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.PEOPLE_RANK_SHOTS;
const FILLER_ROOMS = 25;

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

const registerPerson = async (localpart: string, displayName: string) => {
  const username = `${localpart}_${RUN}`;
  const session = await registerDisposableUser(username, PASSWORD);
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(session.userId)}/displayname`, {
    method: 'PUT',
    accessToken: session.accessToken,
    body: JSON.stringify({ displayname: displayName }),
  });
  return { ...session, displayName };
};

/** A direct chat of `owner` with `other`, listed in the owner's m.direct. */
const createDirectChat = async (owner: MatrixSession, other: MatrixSession) => {
  const { room_id: roomId } = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
    method: 'POST',
    accessToken: owner.accessToken,
    body: JSON.stringify({
      preset: 'trusted_private_chat',
      is_direct: true,
      invite: [other.userId],
    }),
  });
  await joinRoom(HOMESERVER, other.accessToken, roomId);
  await matrixFetch(HOMESERVER, `/user/${encodeURIComponent(owner.userId)}/account_data/m.direct`, {
    method: 'PUT',
    accessToken: owner.accessToken,
    body: JSON.stringify({ [other.userId]: [roomId] }),
  });
  return roomId;
};

const seed = async () => {
  const viewer = await registerPerson('prank_viewer', 'Avery Stone');
  const kim = await registerPerson('prank_alexkim', 'Alex Kim');
  const lim = await registerPerson('prank_alexlim', 'Alex Lim');
  const kay = await registerPerson('prank_alexkay', 'Alex Kay');
  await Promise.all(
    Array.from({ length: FILLER_ROOMS }, (_, index) =>
      createRoom(HOMESERVER, viewer.accessToken, { name: `Project room ${index + 1} ${RUN}` })
    )
  );
  const dmRoomId = await createDirectChat(viewer, kim);
  const lobby = await createRoom(HOMESERVER, viewer.accessToken, {
    name: `Team lobby ${RUN}`,
    invite: [lim.userId, kay.userId],
  });
  await joinRoom(HOMESERVER, lim.accessToken, lobby);
  await joinRoom(HOMESERVER, kay.accessToken, lobby);
  return { viewer, kim, lim, kay, dmRoomId };
};

let seeded: Awaited<ReturnType<typeof seed>> | undefined;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  if (!(await disposableHomeserverIsUp())) return;
  seeded = await seed();
});

test.beforeEach(() => {
  test.skip(!seeded, `No homeserver at ${HOMESERVER}`);
});

const palette = (page: Page) => page.getByRole('dialog', { name: 'Command palette', exact: true });
const field = (page: Page) => palette(page).getByRole('combobox');
const peopleRows = (page: Page) =>
  palette(page).locator('[role="group"][data-section="users"] [role="option"]');

const checkRanking = async (page: Page, tag: string) => {
  const { viewer, kim, lim, kay, dmRoomId } = seeded!;
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: viewer.username,
    password: PASSWORD,
  });
  await pressPaletteShortcut(page);
  await expect(field(page)).toBeFocused();

  // All: the People section lists the exact match first.
  await field(page).fill('Alex Lim');
  await expect(peopleRows(page).first()).toHaveAttribute('data-item-id', `user:${lim.userId}`, {
    timeout: 20_000,
  });
  // Still first once the server's directory answered.
  await expect(palette(page).locator('[data-section="users"][aria-busy="true"]')).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(peopleRows(page).first()).toHaveAttribute('data-item-id', `user:${lim.userId}`);

  // People: the exact match is first and highlighted, also for the other names and the user name.
  await palette(page).getByRole('tab', { name: 'People', exact: true }).click();
  for (const [query, person] of [
    ['Alex Lim', lim],
    ['Alex Kay', kay],
    [lim.username, lim],
    ['Alex Kim', kim],
  ] as const) {
    await field(page).fill(query);
    await expect(peopleRows(page).first()).toHaveAttribute(
      'data-item-id',
      `user:${person.userId}`,
      {
        timeout: 20_000,
      }
    );
    await expect(palette(page).locator('[data-section="users"][aria-busy="true"]')).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(peopleRows(page).first()).toHaveAttribute('data-item-id', `user:${person.userId}`);
    await expect(peopleRows(page).first()).toHaveAttribute('aria-selected', 'true');
  }
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await field(page).fill('Alex Lim');
    await expect(peopleRows(page).first()).toHaveAttribute('data-item-id', `user:${lim.userId}`);
    await page.screenshot({ path: `${SHOTS}/people-${tag}.png` });
  }

  // Enter on the exact match asks to start a chat with Alex Lim, not Alex Kim's chat.
  await field(page).fill('Alex Lim');
  await expect(palette(page).locator('[data-section="users"][aria-busy="true"]')).toHaveCount(0, {
    timeout: 20_000,
  });
  await field(page).press('Enter');
  await expect(palette(page).locator('[role="option"][data-kind="start-chat"]')).toContainText(
    'Start a chat with Alex Lim?'
  );
  expect(decodeURIComponent(page.url())).not.toContain(dmRoomId);

  // Enter on the person with the chat still opens it.
  await field(page).press('Escape');
  await field(page).fill('Alex Kim');
  await expect(peopleRows(page).first()).toHaveAttribute('data-item-id', `user:${kim.userId}`);
  await field(page).press('Enter');
  await expect.poll(() => decodeURIComponent(page.url())).toContain(dmRoomId);
};

const inContext = async (
  browser: Browser,
  options: BrowserContextOptions,
  run: (page: Page) => Promise<void>
) => {
  const context = await browser.newContext(options);
  try {
    await run(await context.newPage());
  } finally {
    await context.close();
  }
};

const TITLE = 'People ranks the typed full name above a person with a direct chat';

test(`${TITLE} (Chromium, desktop)`, async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  await inContext(browser, { viewport: { width: 1280, height: 800 }, baseURL }, (page) =>
    checkRanking(page, 'cd')
  );
});

test(`${TITLE} (WebKit, desktop)`, async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(120_000);
  const browser = await launchWebKit();
  try {
    await inContext(browser, { viewport: { width: 1440, height: 900 }, baseURL }, (page) =>
      checkRanking(page, 'wd')
    );
  } finally {
    await browser.close();
  }
});
