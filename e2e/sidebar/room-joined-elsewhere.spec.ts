import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { joinRoom, sendRoomMessage } from '../helpers/matrix';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import { createRoom } from '../helpers/createRoom';

// A room joined on another device while this one was closed, in which more than a timeline's
// worth of messages came after the join, among them a late edit of an older message: the first
// sync of the resumed session brings the room, and it shows in the room list. The client fetches
// the edited original while it sets the room up; listed before the room was stored, the room
// showed as an empty row under Rooms until it was opened (live lane 5, L5-F029). Runs in Chromium
// and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against the
// disposable homeserver.
const PASSWORD = 'room-joined-elsewhere-spec-password';
const RUN = Date.now().toString(36);
/** More than the 20 events a /sync timeline carries, so the join is not among them. */
const MESSAGES_AFTER_JOIN = 25;

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const joinedRoomShowsAfterResume = async (page: Page, browserName: string) => {
  const reader = await registerDisposableUser(`rje_reader_${browserName}_${RUN}`, PASSWORD);
  const writer = await registerDisposableUser(`rje_writer_${browserName}_${RUN}`, PASSWORD);
  const sharedName = `Shared group ${browserName} ${RUN}`;
  // Encrypted, as the group's rooms are: the client then sets the room up in its crypto store
  // while the first sync is processed.
  const shared = await createRoom(HOMESERVER, writer.accessToken, {
    name: sharedName,
    preset: 'public_chat',
    encrypted: true,
  });
  // An account without rooms yet.
  await loginWithPassword(page, { homeserver: HOMESERVER, ...reader });
  await expect(page.getByText('Create Room', { exact: true })).toBeVisible({ timeout: 60_000 });

  // This device closes; another one joins the shared room, and the group talks on.
  await page.goto('about:blank');
  await joinRoom(HOMESERVER, reader.accessToken, shared);
  const root = await sendRoomMessage(HOMESERVER, writer.accessToken, shared, {
    msgtype: 'm.text',
    body: 'Planning thread: who brings the charts for the harbor crew?',
  });
  const agenda = await sendRoomMessage(HOMESERVER, writer.accessToken, shared, {
    msgtype: 'm.text',
    body: 'Agenda: tides, charts, the new pilot boat.',
  });
  for (let index = 1; index <= MESSAGES_AFTER_JOIN; index += 1) {
    // Every other message answers in the thread, as the group's agents do.
    const inThread = index % 2 === 0;
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, writer.accessToken, shared, {
      msgtype: 'm.text',
      body: `Planning note ${index}: the harbor crew meets at ${index} past nine.`,
      ...(inThread ? { 'm.relates_to': { rel_type: 'm.thread', event_id: root } } : {}),
    });
  }
  // A late edit of the agenda, whose original is older than the synced timeline: the client asks
  // the server for the original while it sets the room up.
  await sendRoomMessage(HOMESERVER, writer.accessToken, shared, {
    msgtype: 'm.text',
    body: '* Agenda: tides, charts, the new pilot boat, lunch.',
    'm.new_content': {
      msgtype: 'm.text',
      body: 'Agenda: tides, charts, the new pilot boat, lunch.',
    },
    'm.relates_to': { rel_type: 'm.replace', event_id: agenda },
  });

  // The original arrives a moment later, as on a slow network.
  await page.route(`**/rooms/${encodeURIComponent(shared)}/event/**`, async (route) => {
    await new Promise((resolve) => {
      setTimeout(resolve, 1_500);
    });
    await route.continue();
  });
  await page.goto('/home/');
  await expect(page.getByRole('link', { name: new RegExp(sharedName) })).toBeVisible({
    timeout: 30_000,
  });
};

test('a room joined on another device shows after the session resumes (Chromium)', async ({
  page,
  browserName,
}) => {
  test.setTimeout(180_000);
  await joinedRoomShowsAfterResume(page, browserName);
});

test('a room joined on another device shows after the session resumes (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  await onWebKitPage({ viewport: { width: 1280, height: 800 }, baseURL }, (page) =>
    joinedRoomShowsAfterResume(page, 'webkit')
  );
});
