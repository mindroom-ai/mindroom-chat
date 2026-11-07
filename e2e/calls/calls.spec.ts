import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { buildLoginPath } from '../env';
import { defined } from '../../src/test/utils/defined';

// Calls over MatrixRTC and LiveKit between real browser sessions with fake microphones and
// cameras: a direct chat call that rings (card, ringtone, system notification), is answered,
// carries sound both ways (encrypted too), mutes, shows video and survives a reload; a group
// room whose admin lets members call, with a shared screen; leftover memberships withdrawn at
// start; a second tab of the same session, which answers busy (on Join, on two Joins at the same
// moment, and on a ring's Answer); a call to a MindRoom agent, which runs in the agent call room
// with the conversation as its origin; an encrypted agent call whose agent hears the caller
// although the session's own send of the caller's key fails, and again when called again; and a
// call whose panel could not load, ended from that panel's failure view. Needs the slot's LiveKit
// server and authorization service (scripts/e2e-rtc.sh), which --rtc starts before the slot's
// homeserver and stops afterwards:
//   scripts/e2e-slot.sh <slot> --rtc npx playwright test e2e/calls/calls.spec.ts
// scripts/e2e-suite.sh gives --rtc to every spec that names scripts/e2e-rtc.sh, as this one does.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'calls-spec-password';
const RUN = Date.now().toString(36);

test.use({
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      '--disable-features=IsolateSandboxedIframes',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
});

type Session = { userId: string; token: string };

const matrix = async <T>(
  path: string,
  init: { token?: string; body?: unknown; method?: string } = {}
): Promise<T> => {
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  expect(response.ok, `${path} answered ${response.status}`).toBe(true);
  return (await response.json()) as T;
};

const register = async (username: string, displayName: string): Promise<Session> => {
  const { access_token: token, user_id: userId } = await matrix<{
    access_token: string;
    user_id: string;
  }>('/register', {
    body: { username, password: PASSWORD, auth: { type: 'm.login.dummy' } },
  });
  await matrix(`/profile/${encodeURIComponent(userId)}/displayname`, {
    token,
    method: 'PUT',
    body: { displayname: displayName },
  });
  return { userId, token };
};

const callServiceIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/.well-known/matrix/client`, {
      signal: AbortSignal.timeout(2_000),
    });
    const body = (await response.json()) as Record<string, unknown>;
    const foci = body['org.matrix.msc4143.rtc_foci'] as { livekit_service_url?: string }[];
    const url = foci?.[0]?.livekit_service_url;
    if (!url) return false;
    return (await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2_000) })).ok;
  } catch {
    return false;
  }
};

/** A direct chat between two people, both with full power, as this client creates them. */
const createDirectChat = async (owner: Session, guest: Session, encrypted: boolean) => {
  const { room_id: roomId } = await matrix<{ room_id: string }>('/createRoom', {
    token: owner.token,
    body: {
      preset: 'trusted_private_chat',
      is_direct: true,
      invite: [guest.userId],
      initial_state: encrypted
        ? [
            {
              type: 'm.room.encryption',
              state_key: '',
              content: { algorithm: 'm.megolm.v1.aes-sha2' },
            },
          ]
        : [],
    },
  });
  await matrix(`/join/${encodeURIComponent(roomId)}`, { token: guest.token, body: {} });
  for (const [me, other] of [
    [owner, guest],
    [guest, owner],
  ] as const) {
    // eslint-disable-next-line no-await-in-loop
    await matrix(`/user/${encodeURIComponent(me.userId)}/account_data/m.direct`, {
      token: me.token,
      method: 'PUT',
      body: { [other.userId]: [roomId] },
    });
  }
  return roomId;
};

/**
 * Records what a ring does on a page whose window is in the background: the system
 * notifications it shows (and closes) and the notes its ringtone starts.
 */
const recordRingAlerts = () => {
  const record = {
    notes: 0,
    notifications: [] as { title: string; body: string; closed: boolean }[],
  };
  (window as unknown as { ringAlerts: typeof record }).ringAlerts = record;
  document.hasFocus = () => false;
  class RecordedNotification {
    static permission = 'granted';

    static requestPermission = async () => 'granted';

    onclick: (() => void) | null = null;

    private entry: { title: string; body: string; closed: boolean };

    constructor(title: string, options?: { body?: string }) {
      this.entry = { title, body: options?.body ?? '', closed: false };
      record.notifications.push(this.entry);
    }

    close() {
      this.entry.closed = true;
    }
  }
  Object.defineProperty(window, 'Notification', { value: RecordedNotification, writable: true });
  const createOscillator = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function recordedOscillator(this: AudioContext) {
    record.notes += 1;
    return createOscillator.call(this);
  };
};

type RingAlerts = {
  notes: number;
  notifications: { title: string; body: string; closed: boolean }[];
};
const ringAlerts = (page: Page) =>
  page.evaluate(() => (window as unknown as { ringAlerts: RingAlerts }).ringAlerts);

/** Records every media track the page gets from the microphone or camera, and their copies. */
const recordMediaTracks = () => {
  const tracks: MediaStreamTrack[] = [];
  (window as unknown as { mediaTracks: MediaStreamTrack[] }).mediaTracks = tracks;
  const { getUserMedia } = MediaDevices.prototype;
  MediaDevices.prototype.getUserMedia = async function recordedGetUserMedia(
    this: MediaDevices,
    constraints?: MediaStreamConstraints
  ) {
    const stream = await getUserMedia.call(this, constraints);
    tracks.push(...stream.getTracks());
    return stream;
  };
  const { clone } = MediaStreamTrack.prototype;
  MediaStreamTrack.prototype.clone = function recordedClone(this: MediaStreamTrack) {
    const copy = clone.call(this);
    tracks.push(copy);
    return copy;
  };
};

/** How many of the recorded media tracks still hold the microphone or camera. */
const liveMediaTracks = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { mediaTracks: MediaStreamTrack[] }).mediaTracks.filter(
        (track) => track.readyState === 'live'
      ).length
  );

/** The call panel's code: its chunk in the production build, its module on the dev server. */
const CALL_PANEL_CODE = /\/(assets\/CallPanel-[^/]*\.js|src\/app\/calls\/CallPanel\.tsx)(\?|$)/;

const signIn = async (browser: Browser, username: string, init?: () => void): Promise<Page> => {
  const context = await browser.newContext({ permissions: ['microphone', 'camera'] });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  await page.goto(buildLoginPath(HOMESERVER));
  await expect(page.locator('input[name="serverInput"]')).toBeVisible({ timeout: 90_000 });
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  return page;
};

const openRoom = async (page: Page, roomId: string) => {
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  await expect(
    page.locator('[data-room-call-button], [data-agent-call-button]').first()
  ).toBeVisible({
    timeout: 60_000,
  });
};

const callPanel = (page: Page) => page.getByTestId('call-panel');
const tileOf = (page: Page, userId: string) => page.locator(`[data-call-tile="${userId}"]`);

/**
 * The loudest level of the other people's sound this page plays, sampled for a moment. Silence
 * (or undecryptable frames) stays near 0; the fake microphone's beeps reach well above it.
 */
const remoteSoundLevel = (page: Page) =>
  page.evaluate(async () => {
    const elements = [...document.querySelectorAll<HTMLAudioElement>('[data-call-audio] audio')];
    const streams = elements
      .map((element) => element.srcObject)
      .filter((stream): stream is MediaStream => stream instanceof MediaStream);
    if (streams.length === 0) return 0;
    const context = new AudioContext();
    await context.resume();
    const analysers = streams.map((stream) => {
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context.createMediaStreamSource(stream).connect(analyser);
      return analyser;
    });
    const samples = new Float32Array(2048);
    let loudest = 0;
    const until = performance.now() + 3000;
    while (performance.now() < until) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
      analysers.forEach((analyser) => {
        analyser.getFloatTimeDomainData(samples);
        samples.forEach((value) => {
          loudest = Math.max(loudest, Math.abs(value));
        });
      });
    }
    await context.close();
    return loudest;
  });

test.describe('calls', () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeEach(async () => {
    test.skip(!(await callServiceIsUp()), 'needs scripts/e2e-rtc.sh and its homeserver setting');
  });

  for (const encrypted of [false, true]) {
    test(`a direct chat call rings, connects and carries sound both ways${
      encrypted ? ' in an encrypted room' : ''
    }`, async ({ browser }) => {
      const suffix = `${RUN}${encrypted ? 'e' : 'p'}`;
      const alice = await register(`alice${suffix}`, 'Alice Call');
      const bob = await register(`bob${suffix}`, 'Bob Call');
      const roomId = await createDirectChat(alice, bob, encrypted);

      const alicePage = await signIn(browser, `alice${suffix}`);
      const bobPage = await signIn(browser, `bob${suffix}`, recordRingAlerts);
      await openRoom(alicePage, roomId);
      await bobPage.goto('/home/');

      // Alice opens the call panel and joins: the empty call rings Bob.
      await alicePage.locator('[data-room-call-button]').click();
      await expect(callPanel(alicePage)).toBeVisible();
      await expect(callPanel(alicePage)).toContainText('Be the first to hop in');
      await callPanel(alicePage).getByRole('button', { name: 'Join', exact: true }).click();
      await expect(tileOf(alicePage, alice.userId)).toHaveAttribute('data-connected', 'true', {
        timeout: 60_000,
      });
      await expect(alicePage.locator('[data-call-tab]')).toBeVisible();

      const ring = bobPage.getByRole('alertdialog', { name: 'Incoming Call' });
      await expect(ring).toBeVisible({ timeout: 60_000 });
      await expect(ring).toContainText('Alice Call is calling');
      // Bob's window is in the background: the ring also rings and shows a system notification.
      await expect.poll(async () => (await ringAlerts(bobPage)).notes).toBeGreaterThan(0);
      expect((await ringAlerts(bobPage)).notifications).toEqual([
        { title: 'Incoming Call', body: 'Alice Call is calling', closed: false },
      ]);
      await ring.getByRole('button', { name: 'Answer' }).click();
      await expect
        .poll(async () => (await ringAlerts(bobPage)).notifications[0]?.closed)
        .toBe(true);
      // Answering stops the ringtone: no more notes are scheduled.
      const notesAtAnswer = (await ringAlerts(bobPage)).notes;
      await bobPage.waitForTimeout(3_000);
      expect((await ringAlerts(bobPage)).notes).toBe(notesAtAnswer);

      // Both see both, connected, and hear each other.
      for (const page of [alicePage, bobPage]) {
        // eslint-disable-next-line no-await-in-loop
        await expect(callPanel(page).locator('[data-call-tile]')).toHaveCount(2, {
          timeout: 60_000,
        });
        // eslint-disable-next-line no-await-in-loop
        await expect(
          callPanel(page).locator('[data-call-tile][data-connected="true"]')
        ).toHaveCount(2, { timeout: 60_000 });
      }
      await expect.poll(() => remoteSoundLevel(bobPage), { timeout: 60_000 }).toBeGreaterThan(0.05);
      await expect
        .poll(() => remoteSoundLevel(alicePage), { timeout: 60_000 })
        .toBeGreaterThan(0.05);

      // Alice mutes; Bob sees it on her tile.
      await callPanel(alicePage).getByRole('button', { name: 'Turn Off Microphone' }).click();
      await expect(
        tileOf(bobPage, alice.userId).getByRole('img', { name: 'Microphone off' })
      ).toBeVisible({
        timeout: 30_000,
      });

      // Bob starts his camera; Alice sees his video.
      await callPanel(bobPage).getByRole('button', { name: 'Start Camera' }).click();
      await expect(tileOf(alicePage, bob.userId).locator('video')).toBeVisible({ timeout: 30_000 });

      // The device menu lists the fake devices.
      await callPanel(bobPage).getByRole('button', { name: 'Settings' }).click();
      const devices = bobPage.getByRole('menu', { name: 'Devices' });
      await expect(devices.getByRole('menuitemradio').first()).toBeVisible();
      await bobPage.keyboard.press('Escape');

      // Alice reloads: her page takes the call up again, still muted, and Bob hears her again
      // once she unmutes.
      await alicePage.reload();
      await expect(tileOf(alicePage, alice.userId)).toHaveAttribute('data-connected', 'true', {
        timeout: 90_000,
      });
      await expect(alicePage.locator('[data-call-tab]')).toBeVisible();
      await expect(
        callPanel(alicePage).locator('[data-call-tile][data-connected="true"]')
      ).toHaveCount(2, { timeout: 60_000 });
      await expect(tileOf(bobPage, alice.userId)).toHaveAttribute('data-connected', 'true', {
        timeout: 60_000,
      });
      await expect(
        tileOf(bobPage, alice.userId).getByRole('img', { name: 'Microphone off' })
      ).toBeVisible({ timeout: 30_000 });
      await callPanel(alicePage).getByRole('button', { name: 'Turn On Microphone' }).click();
      await expect.poll(() => remoteSoundLevel(bobPage), { timeout: 60_000 }).toBeGreaterThan(0.05);

      // Alice hangs up: Bob is alone, and the room shows one person in the call.
      await callPanel(alicePage).getByRole('button', { name: 'End' }).click();
      await expect(tileOf(bobPage, alice.userId)).toHaveCount(0, { timeout: 30_000 });
      await expect(alicePage.locator('[data-call-tab]')).toHaveCount(0);
      await expect(callPanel(alicePage)).toContainText('1 person in the call', { timeout: 30_000 });
      await callPanel(bobPage).getByRole('button', { name: 'End' }).click();
      await expect(callPanel(alicePage)).toContainText('Be the first to hop in', {
        timeout: 30_000,
      });
    });
  }

  test('a call whose panel could not load ends from the panel that says so', async ({
    browser,
  }) => {
    const alice = await register(`alicef${RUN}`, 'Alice Panel');
    const bob = await register(`bobf${RUN}`, 'Bob Panel');
    const roomId = await createDirectChat(alice, bob, false);
    const alicePage = await signIn(browser, `alicef${RUN}`);
    const bobPage = await signIn(browser, `bobf${RUN}`, recordMediaTracks);
    // Bob's network drops the call panel's code, the moment it is first needed: on his answer.
    await bobPage.context().route(CALL_PANEL_CODE, (route) => route.abort('internetdisconnected'));
    await openRoom(alicePage, roomId);
    await bobPage.goto('/home/');

    await alicePage.locator('[data-room-call-button]').click();
    await callPanel(alicePage).getByRole('button', { name: 'Join', exact: true }).click();
    const ring = bobPage.getByRole('alertdialog', { name: 'Incoming Call' });
    await expect(ring).toBeVisible({ timeout: 60_000 });
    await ring.getByRole('button', { name: 'Answer' }).click();

    // Bob is in the call with his microphone on, and his call panel only says it could not load.
    const unavailable = bobPage
      .getByTestId('resizable-call-panel')
      .locator('[data-part-unavailable]');
    await expect(unavailable).toContainText("This couldn't load", { timeout: 60_000 });
    await expect(tileOf(alicePage, bob.userId)).toHaveAttribute('data-connected', 'true', {
      timeout: 60_000,
    });
    await expect.poll(() => liveMediaTracks(bobPage)).toBeGreaterThan(0);

    // End there ends his call: Alice sees him leave, and his microphone is released.
    await unavailable.getByRole('button', { name: 'End' }).click();
    await expect(tileOf(alicePage, bob.userId)).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(() => liveMediaTracks(bobPage)).toBe(0);
    await expect(bobPage.locator('[data-call-tab]')).toHaveCount(0);
    await expect(unavailable.getByRole('button', { name: 'End' })).toHaveCount(0);
    await callPanel(alicePage).getByRole('button', { name: 'End' }).click();
  });

  test('members join a group room call once its admin lets them, and see a shared screen', async ({
    browser,
  }) => {
    const alice = await register(`aliceg${RUN}`, 'Alice Admin');
    const bob = await register(`bobg${RUN}`, 'Bob Member');
    // A room as other clients make it: private_chat keeps call membership at the moderator level.
    const { room_id: roomId } = await matrix<{ room_id: string }>('/createRoom', {
      token: alice.token,
      body: { name: 'Standup', preset: 'private_chat', invite: [bob.userId] },
    });
    await matrix(`/join/${encodeURIComponent(roomId)}`, { token: bob.token, body: {} });

    const bobPage = await signIn(browser, `bobg${RUN}`);
    await openRoom(bobPage, roomId);
    await bobPage.locator('[data-room-call-button]').click();
    await expect(callPanel(bobPage)).toContainText("You don't have permission to join!", {
      timeout: 30_000,
    });

    // Alice, the room's admin, is told and fixes it in the room's settings.
    const alicePage = await signIn(browser, `aliceg${RUN}`);
    await openRoom(alicePage, roomId);
    await alicePage.locator('[data-room-call-button]').click();
    const notice = callPanel(alicePage).getByText("Members of this room can't join its calls.");
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(
      callPanel(alicePage).getByRole('button', { name: 'Let members join' })
    ).toBeVisible();
    await alicePage
      .getByRole('banner')
      .filter({ hasText: 'Standup' })
      .getByRole('button', { name: 'More Options' })
      .click();
    await alicePage.getByRole('menuitem', { name: 'Room Settings', exact: true }).click();
    await alicePage.getByRole('button', { name: 'Permissions', exact: true }).click();
    await alicePage.getByRole('button', { name: 'Start or Join Call: Moderator' }).click();
    await alicePage
      .locator('[aria-label="Start or Join Call"]')
      .getByText('Member', { exact: true })
      .click();
    await expect(alicePage.getByRole('button', { name: 'Start or Join Call: Member' })).toBeVisible(
      { timeout: 30_000 }
    );
    await alicePage.keyboard.press('Escape');
    await expect(notice).toHaveCount(0, { timeout: 30_000 });

    // Bob can join now; Alice joins too and shares her screen, which Bob sees across his panel.
    await callPanel(bobPage).getByRole('button', { name: 'Join', exact: true }).click({
      timeout: 30_000,
    });
    await callPanel(alicePage).getByRole('button', { name: 'Join', exact: true }).click();
    for (const page of [alicePage, bobPage]) {
      // eslint-disable-next-line no-await-in-loop
      await expect(callPanel(page).locator('[data-call-tile][data-connected="true"]')).toHaveCount(
        2,
        { timeout: 60_000 }
      );
    }
    await callPanel(alicePage).getByRole('button', { name: 'Start Screenshare' }).click();
    const shared = callPanel(bobPage).locator(`[data-call-screen="${alice.userId}"]`);
    await expect(shared).toHaveAccessibleName("Alice Admin's screen", { timeout: 30_000 });
    await expect(shared.locator('video')).toBeVisible();
    await expect
      .poll(() => shared.locator('video').evaluate((video: HTMLVideoElement) => video.videoWidth))
      .toBeGreaterThan(0);
    await expect(
      callPanel(alicePage).locator(`[data-call-screen="${alice.userId}"]`)
    ).toBeVisible();
    await callPanel(alicePage).getByRole('button', { name: 'Stop Screenshare' }).click();
    await expect(shared).toHaveCount(0, { timeout: 30_000 });

    await callPanel(alicePage).getByRole('button', { name: 'End' }).click();
    await callPanel(bobPage).getByRole('button', { name: 'End' }).click();
  });

  test('a membership this device left behind is withdrawn when the app starts', async ({
    browser,
  }) => {
    const alice = await register(`alicel${RUN}`, 'Alice Leftover');
    const bob = await register(`bobl${RUN}`, 'Bob Leftover');
    const roomId = await createDirectChat(alice, bob, false);
    const alicePage = await signIn(browser, `alicel${RUN}`);
    await openRoom(alicePage, roomId);

    // A crashed tab's membership: the browser session's device, in the call, never withdrawn.
    const { devices } = await matrix<{ devices: { device_id: string }[] }>('/devices', {
      token: alice.token,
    });
    const { device_id: apiDevice } = await matrix<{ device_id: string }>('/account/whoami', {
      token: alice.token,
    });
    const browserDevice = devices.find((device) => device.device_id !== apiDevice)?.device_id;
    expect(browserDevice).toBeTruthy();
    const stateKey = `_${alice.userId}_${browserDevice}_m.call`;
    const statePath = `/rooms/${encodeURIComponent(
      roomId
    )}/state/org.matrix.msc3401.call.member/${encodeURIComponent(stateKey)}`;
    await matrix(statePath, {
      token: alice.token,
      method: 'PUT',
      body: {
        application: 'm.call',
        call_id: '',
        scope: 'm.room',
        device_id: browserDevice,
        expires: 14_400_000,
        focus_active: { type: 'livekit', focus_selection: 'oldest_membership' },
        foci_preferred: [],
      },
    });
    await expect(alicePage.locator('[data-room-call-button]')).toHaveAttribute(
      'aria-label',
      /1 person/,
      { timeout: 30_000 }
    );

    await alicePage.reload();
    await expect
      .poll(async () => matrix<Record<string, unknown>>(statePath, { token: alice.token }), {
        timeout: 90_000,
      })
      .toEqual({});
  });

  test("a second tab of the same session answers busy and leaves the first tab's call alone", async ({
    browser,
  }) => {
    const alice = await register(`alicet${RUN}`, 'Alice Tabs');
    const bob = await register(`bobt${RUN}`, 'Bob Tabs');
    const roomId = await createDirectChat(alice, bob, false);
    const firstTab = await signIn(browser, `alicet${RUN}`);
    await openRoom(firstTab, roomId);
    await firstTab.locator('[data-room-call-button]').click();
    await callPanel(firstTab).getByRole('button', { name: 'Join', exact: true }).click();
    await expect(tileOf(firstTab, alice.userId)).toHaveAttribute('data-connected', 'true', {
      timeout: 60_000,
    });

    // The same session in another tab shares the device, and with it the call membership.
    const secondTab = await firstTab.context().newPage();
    await openRoom(secondTab, roomId);
    await secondTab.locator('[data-room-call-button]').click();
    await expect(callPanel(secondTab)).toContainText('1 person in the call', { timeout: 30_000 });
    await callPanel(secondTab).getByRole('button', { name: 'Join', exact: true }).click();
    await expect(callPanel(secondTab)).toContainText('Already in another call', {
      timeout: 30_000,
    });

    // The first tab's membership stays: it was not withdrawn to make room for the second tab.
    const { devices } = await matrix<{ devices: { device_id: string }[] }>('/devices', {
      token: alice.token,
    });
    const { device_id: apiDevice } = await matrix<{ device_id: string }>('/account/whoami', {
      token: alice.token,
    });
    const browserDevice = devices.find((device) => device.device_id !== apiDevice)?.device_id;
    const membership = () =>
      matrix<Record<string, unknown>>(
        `/rooms/${encodeURIComponent(
          roomId
        )}/state/org.matrix.msc3401.call.member/${encodeURIComponent(
          `_${alice.userId}_${defined(browserDevice, "the browser's device")}_m.call`
        )}`,
        { token: alice.token }
      );
    await secondTab.waitForTimeout(3_000);
    expect(await membership()).toMatchObject({ device_id: browserDevice });
    await expect(tileOf(firstTab, alice.userId)).toHaveAttribute('data-connected', 'true');
    await callPanel(firstTab).getByRole('button', { name: 'End' }).click();
  });

  test('two tabs of the same session that press Join at the same moment: one joins, the other answers busy', async ({
    browser,
  }) => {
    const alice = await register(`alicej${RUN}`, 'Alice Join');
    const bob = await register(`bobj${RUN}`, 'Bob Join');
    const roomId = await createDirectChat(alice, bob, false);
    const firstTab = await signIn(browser, `alicej${RUN}`);
    const secondTab = await firstTab.context().newPage();
    const tabs = [firstTab, secondTab];
    for (const tab of tabs) {
      // eslint-disable-next-line no-await-in-loop
      await openRoom(tab, roomId);
      // eslint-disable-next-line no-await-in-loop
      await tab.locator('[data-room-call-button]').click();
      // eslint-disable-next-line no-await-in-loop
      await expect(callPanel(tab).getByRole('button', { name: 'Join', exact: true })).toBeEnabled({
        timeout: 30_000,
      });
    }

    // Both press Join at the same agreed moment, within a millisecond or so of each other.
    const at = Date.now() + 1_500;
    await Promise.all(
      tabs.map((tab) =>
        tab.evaluate(async (moment) => {
          const join = [
            ...document.querySelectorAll<HTMLButtonElement>('[data-testid="call-panel"] button'),
          ].find((button) => button.textContent?.trim() === 'Join');
          if (!join) throw new Error('no Join button');
          while (Date.now() < moment) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => {
              setTimeout(resolve, 0);
            });
          }
          join.click();
        }, at)
      )
    );

    // Counted, not read: the busy tab shows no tile at all.
    const connected = async () => {
      const counts = await Promise.all(
        tabs.map(async (tab) =>
          tab.locator(`[data-call-tile="${alice.userId}"][data-connected="true"]`).count()
        )
      );
      return counts.reduce((sum, count) => sum + count, 0);
    };
    await expect.poll(connected, { timeout: 60_000 }).toBe(1);
    const busyTabs = async () =>
      Promise.all(
        tabs.map(async (tab) => callPanel(tab).getByText('Already in another call').isVisible())
      );
    await expect.poll(async () => (await busyTabs()).filter(Boolean).length).toBe(1);
    const busy = await busyTabs();
    // A while later still one call: the busy tab did not join on top of the other.
    await firstTab.waitForTimeout(3_000);
    expect(await connected()).toBe(1);
    const inCall = defined(tabs[busy.indexOf(false)], 'the tab in the call');
    await callPanel(inCall).getByRole('button', { name: 'End' }).click();
  });

  test('answering a ring in a second tab while the first is in a call says so in the call panel', async ({
    browser,
  }) => {
    const alice = await register(`alicer${RUN}`, 'Alice Ring');
    const bob = await register(`bobr${RUN}`, 'Bob Ring');
    const carol = await register(`carolr${RUN}`, 'Carol Ring');
    const bobRoom = await createDirectChat(alice, bob, false);
    const carolRoom = await createDirectChat(alice, carol, false);
    const firstTab = await signIn(browser, `alicer${RUN}`);
    await openRoom(firstTab, bobRoom);
    await firstTab.locator('[data-room-call-button]').click();
    await callPanel(firstTab).getByRole('button', { name: 'Join', exact: true }).click();
    await expect(tileOf(firstTab, alice.userId)).toHaveAttribute('data-connected', 'true', {
      timeout: 60_000,
    });
    const secondTab = await firstTab.context().newPage();
    await secondTab.goto('/home/');

    // Carol calls Alice from another client: her membership, then a ring that mentions Alice.
    const { device_id: carolDevice } = await matrix<{ device_id: string }>('/account/whoami', {
      token: carol.token,
    });
    await matrix(
      `/rooms/${encodeURIComponent(
        carolRoom
      )}/state/org.matrix.msc3401.call.member/${encodeURIComponent(
        `_${carol.userId}_${carolDevice}_m.call`
      )}`,
      {
        token: carol.token,
        method: 'PUT',
        body: {
          application: 'm.call',
          call_id: '',
          scope: 'm.room',
          device_id: carolDevice,
          expires: 14_400_000,
          focus_active: { type: 'livekit', focus_selection: 'oldest_membership' },
          foci_preferred: [],
        },
      }
    );
    await matrix(
      `/rooms/${encodeURIComponent(carolRoom)}/send/org.matrix.msc4075.rtc.notification/ring${RUN}`,
      {
        token: carol.token,
        method: 'PUT',
        body: {
          notification_type: 'ring',
          'm.mentions': { user_ids: [alice.userId] },
          sender_ts: Date.now(),
          lifetime: 60_000,
        },
      }
    );

    const ring = secondTab.getByRole('alertdialog', { name: 'Incoming Call' });
    await expect(ring).toBeVisible({ timeout: 60_000 });
    await ring.getByRole('button', { name: 'Answer' }).click();

    // The second tab opens Carol's room with its call panel, which says why the call did not
    // start and offers Join again; the first tab's call goes on.
    await expect(callPanel(secondTab)).toContainText('Carol Ring', { timeout: 30_000 });
    await expect(callPanel(secondTab)).toContainText('Already in another call', {
      timeout: 30_000,
    });
    await expect(
      callPanel(secondTab).getByRole('button', { name: 'Join', exact: true })
    ).toBeVisible();
    await expect(ring).toHaveCount(0);
    await expect(tileOf(firstTab, alice.userId)).toHaveAttribute('data-connected', 'true');
    await callPanel(firstTab).getByRole('button', { name: 'End' }).click();
  });

  test("an agent hears the caller although the session's own send of the caller's key fails, and again when called again", async ({
    browser,
  }) => {
    const alice = await register(`alicek${RUN}`, 'Alice Again');
    const agent = await register(`mindroom_again${RUN}`, 'Again');
    await matrix(`/presence/${encodeURIComponent(agent.userId)}/status`, {
      token: agent.token,
      method: 'PUT',
      body: { presence: 'online', status_msg: '📞 Voice calls' },
    });
    // An encrypted conversation, so the call room and its media are encrypted too.
    const { room_id: roomId } = await matrix<{ room_id: string }>('/createRoom', {
      token: alice.token,
      body: {
        name: 'Encrypted planning',
        preset: 'private_chat',
        invite: [agent.userId],
        initial_state: [
          {
            type: 'm.room.encryption',
            state_key: '',
            content: { algorithm: 'm.megolm.v1.aes-sha2' },
          },
        ],
      },
    });
    await matrix(`/join/${encodeURIComponent(roomId)}`, { token: agent.token, body: {} });
    const alicePage = await signIn(browser, `alicek${RUN}`);
    const agentPage = await signIn(browser, `mindroom_again${RUN}`);
    // Alice's device cannot claim one-time keys, so it cannot start an Olm session with the agent:
    // the session's send of her media key fails, and it counts the key as shared all the same.
    // The agent's key reaching her starts a session the other way, and her key goes again.
    await alicePage.route('**/keys/claim', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ errcode: 'M_UNKNOWN', error: 'refused by the test' }),
      })
    );
    await openRoom(alicePage, roomId);
    const callAgent = alicePage.getByRole('button', { name: 'Call Again' });
    await expect(callAgent).toBeVisible({ timeout: 60_000 });

    // The agent's stand-in joins the call room's call, as the agent does once Alice is in it.
    const agentJoins = async () => {
      const join = callPanel(agentPage).getByRole('button', { name: 'Join', exact: true });
      if (!(await join.isVisible())) await agentPage.locator('[data-room-call-button]').click();
      await join.click();
      await expect(tileOf(alicePage, agent.userId)).toHaveAttribute('data-connected', 'true', {
        timeout: 60_000,
      });
    };
    const bothHear = async () => {
      await expect
        .poll(() => remoteSoundLevel(agentPage), { timeout: 60_000 })
        .toBeGreaterThan(0.05);
      await expect
        .poll(() => remoteSoundLevel(alicePage), { timeout: 60_000 })
        .toBeGreaterThan(0.05);
    };
    const bothEnd = async () => {
      await callPanel(alicePage).getByRole('button', { name: 'End' }).click();
      await callPanel(agentPage).getByRole('button', { name: 'End' }).click();
      await expect(alicePage.locator('[data-call-tab]')).toHaveCount(0);
    };

    await callAgent.click();
    let callRoomId = '';
    await expect
      .poll(
        async () => {
          const { rooms } = await matrix<{ rooms: { invite?: Record<string, unknown> } }>(
            '/sync?timeout=0',
            { token: agent.token }
          );
          callRoomId = Object.keys(rooms.invite ?? {})[0] ?? '';
          return callRoomId;
        },
        { timeout: 60_000 }
      )
      .not.toBe('');
    await matrix(`/join/${encodeURIComponent(callRoomId)}`, { token: agent.token, body: {} });
    await agentPage.goto(`/home/${encodeURIComponent(callRoomId)}/`);
    await expect(agentPage.locator('[data-room-call-button]')).toBeVisible({ timeout: 60_000 });
    await agentJoins();
    await bothHear();
    await bothEnd();

    // Called again, the agent's device, in the call before, gets Alice's new key and hears her.
    await callAgent.click();
    await expect(tileOf(alicePage, alice.userId)).toHaveAttribute('data-connected', 'true', {
      timeout: 60_000,
    });
    await agentJoins();
    await bothHear();
    await bothEnd();
  });

  test('calling an agent uses its call room with the conversation as origin', async ({
    browser,
  }) => {
    const alice = await register(`alicea${RUN}`, 'Alice Caller');
    const agent = await register(`mindroom_helper${RUN}`, 'Helper');
    await matrix(`/presence/${encodeURIComponent(agent.userId)}/status`, {
      token: agent.token,
      method: 'PUT',
      body: { presence: 'online', status_msg: '📞 Voice calls' },
    });
    const { room_id: roomId } = await matrix<{ room_id: string }>('/createRoom', {
      token: alice.token,
      body: { name: 'Planning', preset: 'private_chat', invite: [agent.userId] },
    });
    await matrix(`/join/${encodeURIComponent(roomId)}`, { token: agent.token, body: {} });

    const alicePage = await signIn(browser, `alicea${RUN}`);
    await openRoom(alicePage, roomId);
    const callAgent = alicePage.getByRole('button', { name: 'Call Helper' });
    await expect(callAgent).toBeVisible({ timeout: 60_000 });
    await callAgent.click();

    // The call runs in the call room, shown beside the conversation it is about.
    await expect(callPanel(alicePage)).toContainText('Call with Helper', { timeout: 60_000 });
    await expect(tileOf(alicePage, alice.userId)).toHaveAttribute('data-connected', 'true', {
      timeout: 60_000,
    });
    // The agent shows from the start, waiting until it joins.
    await expect(tileOf(alicePage, agent.userId)).toHaveAttribute('data-connected', 'false');
    await expect(tileOf(alicePage, agent.userId)).toContainText('Waiting for Helper');

    // The agent was invited to the call room, which names Alice's conversation as the origin.
    const { rooms } = await matrix<{ rooms: { invite: Record<string, unknown> } }>(
      '/sync?timeout=0',
      { token: agent.token }
    );
    const callRoomId = defined(Object.keys(rooms.invite)[0], 'an invite to the call room');
    await matrix(`/join/${encodeURIComponent(callRoomId)}`, { token: agent.token, body: {} });
    const origin = await matrix<Record<string, unknown>>(
      `/rooms/${encodeURIComponent(callRoomId)}/state/io.mindroom.agent_call/`,
      { token: agent.token }
    );
    expect(origin).toMatchObject({
      version: 1,
      agent_user_id: agent.userId,
      creator_user_id: alice.userId,
      ephemeral: false,
      origin: { room_id: roomId, thread_id: null },
    });

    // The agent joins the call from its own session, and Alice sees and hears it.
    const agentPage = await signIn(browser, `mindroom_helper${RUN}`);
    await agentPage.goto(`/home/${encodeURIComponent(callRoomId)}/`);
    await agentPage.locator('[data-room-call-button]').click();
    await callPanel(agentPage).getByRole('button', { name: 'Join', exact: true }).click();
    await expect(tileOf(alicePage, agent.userId)).toHaveAttribute('data-connected', 'true', {
      timeout: 60_000,
    });
    await expect.poll(() => remoteSoundLevel(alicePage), { timeout: 60_000 }).toBeGreaterThan(0.05);

    // A failure notice from the agent shows in the panel until dismissed.
    await matrix(`/rooms/${encodeURIComponent(callRoomId)}/send/m.room.message/fail${RUN}`, {
      token: agent.token,
      method: 'PUT',
      body: {
        msgtype: 'm.notice',
        body: 'Voice call error: the speech service rejected its key.',
        'chat.mindroom.call_failure': { version: 1 },
      },
    });
    const failure = callPanel(alicePage).getByText('the speech service rejected its key');
    await expect(failure).toBeVisible({ timeout: 30_000 });
    await alicePage.getByRole('button', { name: 'Dismiss voice call error' }).click();
    await expect(failure).toHaveCount(0);

    // Hanging up keeps the call room for the next call but clears this call's origin.
    await callPanel(alicePage).getByRole('button', { name: 'End' }).click();
    await expect(alicePage.locator('[data-call-tab]')).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (
            await matrix<Record<string, unknown>>(
              `/rooms/${encodeURIComponent(callRoomId)}/state/io.mindroom.agent_call/`,
              { token: agent.token }
            )
          ).origin,
        { timeout: 30_000 }
      )
      .toBeUndefined();
  });
});
