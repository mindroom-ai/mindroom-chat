import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  addRoomToSpace,
  createThreadFixture,
  matrixFetch,
  setAccountData,
} from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// A voice message being recorded belongs to the account, not to the composer its microphone was
// pressed in: it goes on through a thread, the Threads page, another space and another room, and
// is sent where Send is pressed. Recorded in room A's main view, sent in a thread of room B in
// another space: one microphone capture, one voice message, in B's thread, none in A. Against the
// disposable homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh, in Chromium, whose
// microphone is a tone made in the page (as in voice-draft-reload.spec.ts).
const PASSWORD = 'voice-follows-navigation-spec-password';
const RUN = Date.now().toString(36);

test.use({
  viewport: { width: 1600, height: 1000 },
  serviceWorkers: 'block',
  launchOptions: {
    // The other launch options repeat playwright.config.ts; the scrollbars stay visible.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      '--disable-features=IsolateSandboxedIframes',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

/**
 * The page's microphone plays a 440 Hz tone, and counts how often the app asks for it: a second
 * capture would be a second recording.
 */
const countingToneMicrophone = () => {
  const devices = navigator.mediaDevices as MediaDevices | undefined;
  if (!devices) return;
  const counter = window as unknown as { voiceCaptureStarts: number };
  counter.voiceCaptureStarts = 0;
  let audio: AudioContext | undefined;
  const wake = (): AudioContext => {
    audio ??= new AudioContext();
    audio.resume().catch(() => undefined);
    return audio;
  };
  ['pointerdown', 'touchstart', 'mousedown', 'keydown'].forEach((type) =>
    window.addEventListener(type, wake, { capture: true })
  );
  const original = devices.getUserMedia.bind(devices);
  devices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    if (!constraints?.audio || constraints.video) return original(constraints);
    counter.voiceCaptureStarts += 1;
    const context = wake();
    const tone = context.createOscillator();
    tone.frequency.value = 440;
    const microphone = context.createMediaStreamDestination();
    tone.connect(microphone);
    tone.start();
    return microphone.stream;
  };
};

type RoomEvent = {
  type: string;
  content: {
    msgtype?: string;
    'm.relates_to'?: { rel_type?: string; event_id?: string };
  };
};

const seed = async () => {
  const session = await registerDisposableUser(`vfn_${RUN}`, PASSWORD);
  const token = session.accessToken;
  // The rail shows its Threads page, which holds no composer until a thread is opened.
  await setAccountData(HOMESERVER, token, session.userId, 'io.mindroom.settings', {
    showThreadsInSidebar: true,
  });
  const place = async (letter: 'A' | 'B') => {
    const spaceId = await createRoom(HOMESERVER, token, {
      name: `Example space ${letter}`,
      space: true,
    });
    const thread = await createThreadFixture(HOMESERVER, token, {
      name: `Example room ${letter}`,
      rootBody: `🧪 Example thread ${letter}`,
      replyBody: `A reply in example thread ${letter}`,
    });
    await addRoomToSpace(HOMESERVER, token, spaceId, thread.roomId);
    return {
      spaceId,
      roomId: thread.roomId,
      rootId: thread.rootId,
      name: `Example room ${letter}`,
    };
  };
  return { session, a: await place('A'), b: await place('B') };
};

const voiceMessages = async (token: string, roomId: string): Promise<RoomEvent[]> => {
  const page = await matrixFetch<{ chunk: RoomEvent[] }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=100`,
    { accessToken: token }
  );
  return page.chunk.filter(
    (event) => event.type === 'm.room.message' && event.content.msgtype === 'm.audio'
  );
};

const composer = (page: Page) => page.locator('[data-editable-name="RoomInput"]');
const capsule = (page: Page) => page.getByRole('button', { name: 'Discard voice recording' });
const indicator = (page: Page) => page.getByTestId('live-voice-recording-indicator');
const captureStarts = (page: Page) =>
  page.evaluate(() => (window as unknown as { voiceCaptureStarts: number }).voiceCaptureStarts);

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('a voice recording follows the person and is sent where Send is pressed', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  const world = await seed();
  const token = world.session.accessToken;
  await context.addInitScript(countingToneMicrophone);
  await context.grantPermissions(['microphone']);
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: world.session.username,
    password: PASSWORD,
  });
  // Both rooms show their threads as cards, which open a thread with one click.
  await page.evaluate(
    (ids) =>
      ids.forEach((id) => localStorage.setItem(`roomViewMode:${id}`, JSON.stringify('threaded'))),
    [world.a.roomId, world.b.roomId]
  );
  const nav = page.getByTestId('resizable-page-nav');
  const spaces = page.getByRole('group', { name: 'Spaces' });

  // Room A's main view, in space A: the microphone is pressed here.
  await page.goto(`/${encodeURIComponent(world.a.spaceId)}/${encodeURIComponent(world.a.roomId)}`);
  await expect(composer(page).first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Record voice message', exact: true }).first().click();
  // The browser is launched with a fake microphone, so a capture error here is a failure.
  await expect(capsule(page).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Voice Recording Error', { exact: true })).toHaveCount(0);
  await expect(indicator(page)).toHaveCount(0);

  // Into a thread of room A: the recording goes on, shown by the thread's composer.
  await page.locator(`[data-thread-root-id="${world.a.rootId}"]`).first().click();
  await expect(page.getByTestId('thread-column')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('thread-column').locator(capsule(page))).toBeVisible();

  // The Threads page has no composer until a thread is opened: the pill stands in.
  await page
    .getByRole('navigation', { name: 'Main', exact: true })
    .getByRole('button', { name: 'Threads', exact: true })
    .click();
  await expect(page).toHaveURL(/\/threads\/?$/, { timeout: 30_000 });
  await expect(indicator(page)).toBeVisible();
  await expect(indicator(page)).toHaveText(/^Recording \d+:\d\d$/);
  // Its Discard is the only one on the page: no composer shows a capsule here.
  await expect(capsule(page)).toHaveCount(1);
  await expect(indicator(page).locator(capsule(page))).toBeVisible();
  // It shows in the page's notice place, over the top of the page, not over its foot.
  await expect(page.locator('[aria-live="polite"]').filter({ has: indicator(page) })).toHaveCount(
    1
  );
  const pillBox = await indicator(page).boundingBox();
  expect(pillBox?.y ?? Infinity).toBeLessThan(120);

  // On to room B, in space B, and into its thread.
  await spaces.locator(`[data-id="${world.b.spaceId}"]`).click();
  await nav.getByRole('link', { name: world.b.name, exact: true }).click();
  await expect(composer(page).first()).toBeVisible({ timeout: 60_000 });
  await expect(indicator(page)).toHaveCount(0);
  await expect(capsule(page).first()).toBeVisible();
  await page.locator(`[data-thread-root-id="${world.b.rootId}"]`).first().click();
  const thread = page.getByTestId('thread-column');
  await expect(thread.locator(capsule(page))).toBeVisible({ timeout: 30_000 });
  // The same recording all along: its time has run on since room A.
  await expect(thread.getByText(/^0:0[3-9]$|^0:[1-5]\d$/)).toBeVisible({ timeout: 30_000 });

  // Settings cover the composers: the pill shows inside the dialog, where the focus the dialog
  // holds reaches its Discard, and goes again when the dialog closes.
  await page.keyboard.press('ControlOrMeta+,');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible({ timeout: 30_000 });
  await expect(settings.locator(indicator(page))).toBeVisible();
  await expect(indicator(page)).toHaveCount(1);
  const dialogDiscard = settings.locator(indicator(page)).locator(capsule(page));
  await dialogDiscard.focus();
  await expect(dialogDiscard).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(indicator(page)).toHaveCount(0);
  await expect(thread.locator(capsule(page))).toBeVisible();

  // Send is pressed here, so here is where it goes.
  await thread.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect
    .poll(async () => (await voiceMessages(token, world.b.roomId)).length, {
      timeout: 45_000,
    })
    .toBe(1);
  const [sent] = await voiceMessages(token, world.b.roomId);
  expect(sent?.content['m.relates_to']).toMatchObject({
    rel_type: 'm.thread',
    event_id: world.b.rootId,
  });
  expect(await voiceMessages(token, world.a.roomId)).toHaveLength(0);
  expect(await captureStarts(page)).toBe(1);
  await expect(capsule(page)).toHaveCount(0);
  await expect(indicator(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Record voice message' }).first()).toBeEnabled();

  // The voice key (Ctrl+Shift+Space) records for the account too: a tap starts a recording, and a
  // second tap sends it from the composer that has the focus.
  await thread.locator(composer(page)).click();
  await page.keyboard.press('Control+Shift+Space');
  await expect(thread.locator(capsule(page))).toBeVisible({ timeout: 15_000 });
  await expect(thread.getByText(/^0:0[1-9]$/)).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Control+Shift+Space');
  await expect
    .poll(async () => (await voiceMessages(token, world.b.roomId)).length, { timeout: 45_000 })
    .toBe(2);
  const sentByKey = await voiceMessages(token, world.b.roomId);
  sentByKey.forEach((event) =>
    expect(event.content['m.relates_to']).toMatchObject({
      rel_type: 'm.thread',
      event_id: world.b.rootId,
    })
  );
  expect(await captureStarts(page)).toBe(2);
  await expect(capsule(page)).toHaveCount(0);
});
