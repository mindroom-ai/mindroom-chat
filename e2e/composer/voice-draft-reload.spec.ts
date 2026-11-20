import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// A voice recording is on disk from its first second (composer/voice/voiceRecordingJournal.ts)
// until the server has its voice message, so no way a page ends loses it, and it goes under one
// transaction ID however often it is sent, so the server posts it once:
// - A voice message whose upload fails says "Your recording is still saved", with Retry and
//   Discard. It stays saved across a reload: the reloaded room shows the same failure with Retry.
//   A Retry the server takes, but whose answer is lost, fails to the page; the next Retry in that
//   page leaves one voice message.
// - A page that is closed while it records, with no stop, Send or Discard (as a crash or an app
//   update ends it), leaves what it recorded: the next page shows "Recovered recording". Its Send
//   reaches the server, the answer is lost, and the page is reloaded: the recording is back
//   where it was going, and Retry leaves one voice message of that length, whose file decodes.
// Desktop (1280 by 800, light) and phone (390 by 844 with touch, dark), in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against the disposable
// homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh. The microphone is a tone made in
// the page: WebKit's mock capture device never got the recorder past 0:00.
const PASSWORD = 'voice-draft-reload-spec-password';
const RUN = Date.now().toString(36);

type Layout = { name: 'desktop' | 'phone'; options: BrowserContextOptions };

const LAYOUTS: Layout[] = [
  { name: 'desktop', options: { viewport: { width: 1280, height: 800 }, colorScheme: 'light' } },
  {
    name: 'phone',
    options: {
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      colorScheme: 'dark',
    },
  },
];

test.use({
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
 * The page's microphone plays a 440 Hz tone, so the recorder has real audio in any engine. Its
 * audio starts on the first touch, click or key, as a phone's browser only lets it start then.
 */
const toneMicrophone = () => {
  const devices = navigator.mediaDevices as MediaDevices | undefined;
  if (!devices) return;
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
    const context = wake();
    const tone = context.createOscillator();
    tone.frequency.value = 440;
    const microphone = context.createMediaStreamDestination();
    tone.connect(microphone);
    tone.start();
    return microphone.stream;
  };
};

const press = async (page: Page, layout: Layout, name: string) => {
  const button = page.getByRole('button', { name, exact: true });
  if (layout.name === 'phone') await button.tap();
  else await button.click();
};

const seed = async (name: string) => {
  const session = await registerDisposableUser(`vdr_${name}_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, session.accessToken, {
    name: `Field notes ${name}`,
  });
  await sendRoomMessage(HOMESERVER, session.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'I will send the dock report as a voice message after the inspection.',
  });
  return { session, roomId };
};

type VoiceEvent = {
  type: string;
  content: { msgtype?: string; url?: string; info?: { duration?: number } };
};

/** The room's voice messages, as the server has them. */
const voiceEvents = async (world: Awaited<ReturnType<typeof seed>>): Promise<VoiceEvent[]> => {
  const page = await matrixFetch<{ chunk: VoiceEvent[] }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(world.roomId)}/messages?dir=b&limit=100`,
    { accessToken: world.session.accessToken }
  );
  return page.chunk.filter(
    (event) => event.type === 'm.room.message' && event.content.msgtype === 'm.audio'
  );
};

const voiceMessages = async (world: Awaited<ReturnType<typeof seed>>): Promise<number> =>
  (await voiceEvents(world)).length;

/** Signs in and opens the room, with the microphone the browser needs for it. */
const openRoom = async (
  browser: Browser,
  context: BrowserContext,
  world: Awaited<ReturnType<typeof seed>>
): Promise<Page> => {
  // Chromium's fake microphone needs the permission; WebKit refuses its name and its mock
  // capture device needs none.
  if (browser.browserType().name() === 'chromium') {
    await context.grantPermissions(['microphone']);
  }
  const page = await context.newPage();
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: world.session.username,
    password: PASSWORD,
  });
  await page.evaluate(
    (id) => localStorage.setItem(`roomViewMode:${id}`, JSON.stringify('threaded')),
    world.roomId
  );
  await page.goto(`/home/${encodeURIComponent(world.roomId)}`);
  await expect(page.locator('[data-editable-name="RoomInput"]')).toBeVisible({
    timeout: 60_000,
  });
  return page;
};

/**
 * While `answers.lost`, the server takes a message this page sends, but the page never hears of
 * it: to the page the send failed.
 */
const loseSendAnswers = async (page: Page) => {
  const answers = { lost: false };
  await page.route(
    (url) => /\/rooms\/[^/]+\/send\/m\.room\.message\//.test(url.pathname),
    async (route) => {
      if (!answers.lost || route.request().method() !== 'PUT') {
        await route.continue();
        return;
      }
      await route.fetch();
      await route.abort('failed');
    }
  );
  return answers;
};

const micIsFree = (page: Page) =>
  expect(page.getByRole('button', { name: 'Record voice message' })).toBeEnabled({
    timeout: 30_000,
  });

/** Starts a recording; skips the test in a browser that has nothing to record from. */
const startRecording = async (page: Page, layout: Layout) => {
  await press(page, layout, 'Record voice message');
  const recording = page.getByRole('button', { name: 'Discard voice recording' });
  const recordingError = page.getByText('Voice Recording Error', { exact: true });
  await expect(recording.or(recordingError).first()).toBeVisible({ timeout: 15_000 });
  test.skip(await recordingError.isVisible(), 'This browser offers no microphone to record from');
};

const failedRecordingSurvivesReload = async (browser: Browser, layout: Layout, label: string) => {
  const world = await seed(label);
  const context = await browser.newContext({ ...layout.options, serviceWorkers: 'block' });
  await context.addInitScript(toneMicrophone);
  try {
    const page = await openRoom(browser, context, world);

    // The first upload fails on the server.
    let uploads = 0;
    // Media uploads only, not the encryption keys' /keys/upload.
    const isMediaUpload = (url: URL) =>
      /\/media\/(v3|r0)\/upload$|\/v1\/media\/upload$/.test(url.pathname);
    await page.route(isMediaUpload, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      uploads += 1;
      if (uploads === 1) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ errcode: 'M_UNKNOWN', error: 'injected' }),
        });
        return;
      }
      await route.continue();
    });

    await startRecording(page, layout);
    await page.waitForTimeout(1_500);
    await press(page, layout, 'Send message');

    const failed = page.getByText('Voice send failed', { exact: true });
    await expect(failed).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Your recording is still saved.', { exact: true })).toBeVisible();
    expect(await voiceMessages(world)).toBe(0);

    await page.reload();
    await expect(page.locator('[data-editable-name="RoomInput"]')).toBeVisible({
      timeout: 60_000,
    });
    // Still saved: the room shows the same failure, with Retry.
    await expect(failed).toBeVisible({ timeout: 30_000 });

    // The server takes this Retry, but its answer is lost: to the page it failed again.
    const answers = await loseSendAnswers(page);
    answers.lost = true;
    await press(page, layout, 'Retry');
    await expect.poll(() => voiceMessages(world), { timeout: 45_000 }).toBe(1);
    await expect(failed).toBeVisible({ timeout: 30_000 });
    // The next Retry is the same event to the server, which still has one.
    answers.lost = false;
    await press(page, layout, 'Retry');
    await expect(failed).toHaveCount(0);
    await micIsFree(page);
    expect(await voiceMessages(world)).toBe(1);
  } finally {
    await context.close();
  }
};

const recordingSurvivesClosedPage = async (browser: Browser, layout: Layout, label: string) => {
  const world = await seed(label);
  const context = await browser.newContext({ ...layout.options, serviceWorkers: 'block' });
  await context.addInitScript(toneMicrophone);
  try {
    const page = await openRoom(browser, context, world);
    await startRecording(page, layout);
    // Five seconds of the tone, which reach the disk a chunk a second.
    await expect(page.getByText('0:05', { exact: true })).toBeVisible({ timeout: 30_000 });
    // The page goes mid-recording and runs nothing on its way out: no stop, Send or Discard.
    await page.close();
    expect(await voiceMessages(world)).toBe(0);

    // The next page of the same browser profile finds what the first one wrote.
    const next = await context.newPage();
    await next.goto(`/home/${encodeURIComponent(world.roomId)}`);
    await expect(next.locator('[data-editable-name="RoomInput"]')).toBeVisible({
      timeout: 60_000,
    });
    const recovered = next.getByText('Recovered recording ·', { exact: true });
    await expect(recovered).toBeVisible({ timeout: 30_000 });
    // Nothing failed, so nothing asks for a Retry: it waits for Send, or Discard.
    await expect(next.getByText('Voice send failed', { exact: true })).toHaveCount(0);
    await expect(next.getByRole('button', { name: 'Discard voice recording' })).toBeVisible();
    expect(await voiceMessages(world)).toBe(0);

    // The server takes it, but its answer is lost: to the page the send failed.
    const answers = await loseSendAnswers(next);
    answers.lost = true;
    await press(next, layout, 'Send message');
    await expect.poll(() => voiceMessages(world), { timeout: 45_000 }).toBe(1);
    const failed = next.getByText('Voice send failed', { exact: true });
    await expect(failed).toBeVisible({ timeout: 30_000 });
    // After a reload it is back where it was going, with Retry: the same event to the server.
    answers.lost = false;
    await next.reload();
    await expect(next.locator('[data-editable-name="RoomInput"]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(failed).toBeVisible({ timeout: 30_000 });
    await expect(recovered).toHaveCount(0);
    await press(next, layout, 'Retry');
    await expect(failed).toHaveCount(0);
    await micIsFree(next);
    expect(await voiceMessages(world)).toBe(1);
    const [voice] = await voiceEvents(world);
    // About the five seconds that were recorded: at most the last second is lost.
    const duration = voice!.content.info?.duration ?? 0;
    expect(duration).toBeGreaterThanOrEqual(3_900);
    expect(duration).toBeLessThan(7_500);

    // The chunks, put together, are a file a player can decode.
    const [server, mediaId] = voice!.content.url!.slice('mxc://'.length).split('/');
    const download = await fetch(
      `${HOMESERVER}/_matrix/client/v1/media/download/${server}/${mediaId}`,
      { headers: { Authorization: `Bearer ${world.session.accessToken}` } }
    );
    expect(download.ok).toBe(true);
    const file = Buffer.from(await download.arrayBuffer()).toString('base64');
    const decodedSeconds = await next.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const audio = await new AudioContext().decodeAudioData(bytes.buffer);
      return audio.duration;
    }, file);
    expect(decodedSeconds).toBeGreaterThan(3.9);
    expect(decodedSeconds).toBeLessThan(7.5);

    // Sent, it left the disk: another page load brings nothing back, and nothing is sent twice.
    await next.reload();
    await expect(next.locator('[data-editable-name="RoomInput"]')).toBeVisible({
      timeout: 60_000,
    });
    await micIsFree(next);
    await expect(recovered).toHaveCount(0);
    await expect(failed).toHaveCount(0);
    expect(await voiceMessages(world)).toBe(1);
  } finally {
    await context.close();
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const CASES = [
  {
    title: 'a voice message whose send failed is still saved after a reload, and sent once',
    label: 'f',
    run: failedRecordingSurvivesReload,
  },
  {
    title: 'a recording whose page was closed mid-recording is recovered and sent once',
    label: 'k',
    run: recordingSurvivesClosedPage,
  },
];

for (const { title, label, run } of CASES) {
  for (const layout of LAYOUTS) {
    test(`${title} (Chromium, ${layout.name})`, async ({ browser }) => {
      test.setTimeout(180_000);
      await run(browser, layout, `${label}c${layout.name[0]}`);
    });

    test(`${title} (WebKit, ${layout.name})`, async () => {
      test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
      test.setTimeout(180_000);
      const browser = await launchWebKit();
      try {
        await run(browser, layout, `${label}w${layout.name[0]}`);
      } finally {
        await browser.close();
      }
    });
  }
}
