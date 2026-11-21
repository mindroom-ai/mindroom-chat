import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { openSettingsFromAccountRail } from '../helpers/accounts';
import { createRoom } from '../helpers/createRoom';
import { matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// A voice message whose upload fails says "Your recording is still saved", with Retry and Discard.
// It stays saved across a reload: the reloaded room shows the same failure with Retry, and Retry
// sends one voice message. Desktop (1280 by 800, light) and phone (390 by 844 with touch, dark), in
// Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against the
// disposable homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh. The microphone is a
// tone made in the page: WebKit's mock capture device never got the recorder past 0:00.
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

const voiceEvents = async (world: Awaited<ReturnType<typeof seed>>) => {
  type Event = {
    type: string;
    content: { msgtype?: string; info?: { duration?: number }; url?: string };
  };
  const page = await matrixFetch<{ chunk: Event[] }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(world.roomId)}/messages?dir=b&limit=100`,
    { accessToken: world.session.accessToken }
  );
  return page.chunk.filter(
    (event) => event.type === 'm.room.message' && event.content.msgtype === 'm.audio'
  );
};
const voiceMessages = async (world: Awaited<ReturnType<typeof seed>>) =>
  (await voiceEvents(world)).length;

const press = async (page: Page, layout: Layout, name: string) => {
  const button = page.getByRole('button', { name, exact: true });
  if (layout.name === 'phone') await button.tap();
  else await button.click();
};

const failedRecordingSurvivesReload = async (browser: Browser, layout: Layout, label: string) => {
  const world = await seed(label);
  const context = await browser.newContext({ ...layout.options, serviceWorkers: 'block' });
  await context.addInitScript(toneMicrophone);
  try {
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

    await press(page, layout, 'Record voice message');
    const recording = page.getByRole('button', { name: 'Discard voice recording' });
    const recordingError = page.getByText('Voice Recording Error', { exact: true });
    await expect(recording.or(recordingError).first()).toBeVisible({ timeout: 15_000 });
    test.skip(await recordingError.isVisible(), 'This browser offers no microphone to record from');
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
    await press(page, layout, 'Retry');
    await expect.poll(() => voiceMessages(world), { timeout: 45_000 }).toBe(1);
    await expect(failed).toHaveCount(0);
  } finally {
    await context.close();
  }
};

const openVoiceRoom = async (context: BrowserContext, world: Awaited<ReturnType<typeof seed>>) => {
  const page = await context.newPage();
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: world.session.username,
    password: PASSWORD,
    showToolCalls: false,
  });
  await page.evaluate(
    (id) => localStorage.setItem(`roomViewMode:${id}`, JSON.stringify('threaded')),
    world.roomId
  );
  await page.goto(`/home/${encodeURIComponent(world.roomId)}`);
  await expect(page.getByRole('button', { name: 'Record voice message' })).toBeEnabled({
    timeout: 60_000,
  });
  return page;
};

const recordingSurvivesClosedPage = async (browser: Browser, layout: Layout, label: string) => {
  const world = await seed(label);
  const context = await browser.newContext({ ...layout.options, serviceWorkers: 'block' });
  await context.addInitScript(toneMicrophone);
  try {
    if (browser.browserType().name() === 'chromium') await context.grantPermissions(['microphone']);
    const page = await openVoiceRoom(context, world);
    const room = page.url();
    await press(page, layout, 'Record voice message');
    // Close without running a Stop, Discard or Send handler in the page.
    await expect(page.getByText('0:05', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(600);
    await page.close();
    expect(await voiceMessages(world)).toBe(0);

    const next = await context.newPage();
    await next.goto(room);
    const recovered = next.getByText(/^Recovered recording · 0:0[456]$/);
    await expect(recovered).toBeVisible({ timeout: 60_000 });
    await expect(next.getByRole('button', { name: 'Discard voice recording' })).toBeVisible();
    await expect(next.getByRole('button', { name: 'Record voice message' })).toBeDisabled();
    await press(next, layout, 'Send message');
    await expect.poll(() => voiceMessages(world), { timeout: 45_000 }).toBe(1);
    await expect(recovered).toHaveCount(0);

    const [voice] = await voiceEvents(world);
    expect(voice?.content.info?.duration).toBeGreaterThanOrEqual(3_900);
    expect(voice?.content.info?.duration).toBeLessThan(7_500);
    const media = voice!.content.url!.slice('mxc://'.length);
    const download = await fetch(`${HOMESERVER}/_matrix/client/v1/media/download/${media}`, {
      headers: { Authorization: `Bearer ${world.session.accessToken}` },
    });
    expect(download.ok).toBe(true);
    const file = Buffer.from(await download.arrayBuffer()).toString('base64');
    const duration = await next.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const audio = new AudioContext();
      try {
        return (await audio.decodeAudioData(bytes.buffer)).duration;
      } finally {
        await audio.close();
      }
    }, file);
    expect(duration).toBeGreaterThan(3.9);
    expect(duration).toBeLessThan(7.5);

    await next.reload();
    await expect(next.getByRole('button', { name: 'Record voice message' })).toBeEnabled({
      timeout: 60_000,
    });
    await expect(next.getByText(/Recovered recording/)).toHaveCount(0);
    await expect(next.getByText('Voice send failed', { exact: true })).toHaveCount(0);
    expect(await voiceMessages(world)).toBe(1);
  } finally {
    await context.close();
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const TITLE = 'a voice message whose send failed is still saved after a reload';
const CLOSED = 'a recording survives closing the page without stopping';
const desktop = LAYOUTS[0]!;

test('a live recording keeps going until Discard is confirmed', async ({ browser }) => {
  test.setTimeout(180_000);
  const world = await seed('live_discard');
  const context = await browser.newContext({ ...desktop.options, serviceWorkers: 'block' });
  await context.addInitScript(toneMicrophone);
  await context.grantPermissions(['microphone']);
  try {
    const page = await openVoiceRoom(context, world);
    await press(page, desktop, 'Record voice message');
    await expect(page.getByText('0:02', { exact: true })).toBeVisible({ timeout: 30_000 });
    const prompt = page.getByText('Discard voice recording?', { exact: true });
    await press(page, desktop, 'Discard voice recording');
    await expect(prompt).toBeVisible();
    await expect(page.getByText('0:04', { exact: true })).toBeVisible();
    await press(page, desktop, 'Cancel');
    await expect(prompt).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pause voice recording' })).toBeEnabled();
    await press(page, desktop, 'Discard voice recording');
    await press(page, desktop, 'Discard');
    const mic = page.getByRole('button', { name: 'Record voice message' });
    await expect(mic).toBeEnabled();
    await page.reload();
    await expect(mic).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByText(/Recovered recording/)).toHaveCount(0);
    expect(await voiceMessages(world)).toBe(0);
  } finally {
    await context.close();
  }
});

test('sign-out warns before losing a live voice recording', async ({ browser }) => {
  test.setTimeout(180_000);
  const world = await seed('sign_out');
  const context = await browser.newContext({ ...desktop.options, serviceWorkers: 'block' });
  await context.addInitScript(toneMicrophone);
  await context.grantPermissions(['microphone']);
  try {
    const page = await openVoiceRoom(context, world);
    await press(page, desktop, 'Record voice message');
    const pause = page.getByRole('button', { name: 'Pause voice recording' });
    await expect(pause).toBeEnabled({ timeout: 30_000 });
    const logout = page.getByRole('button', { name: 'Logout', exact: true }).first();
    const warning = page.getByRole('dialog', { name: 'Unsent voice recording' });
    await openSettingsFromAccountRail(page);
    await logout.click();
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: 'Cancel', exact: true }).last().click();
    await expect(warning).toHaveCount(0);
    await logout.click();
    await warning.getByRole('button', { name: 'Send it', exact: true }).click();
    await expect(logout).toHaveCount(0);
    await expect(pause).toBeEnabled();

    await openSettingsFromAccountRail(page);
    await logout.click();
    await warning.getByRole('button', { name: 'Discard and sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login(?:[/?#]|$)/, { timeout: 60_000 });
    expect(await voiceMessages(world)).toBe(0);
  } finally {
    await context.close();
  }
});

test(`${CLOSED} (Chromium)`, async ({ browser }) => {
  test.setTimeout(180_000);
  await recordingSurvivesClosedPage(browser, desktop, 'kill_c');
});

test(`${CLOSED} (WebKit)`, async () => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  const browser = await launchWebKit();
  try {
    await recordingSurvivesClosedPage(browser, desktop, 'kill_w');
  } finally {
    await browser.close();
  }
});

for (const layout of LAYOUTS) {
  test(`${TITLE} (Chromium, ${layout.name})`, async ({ browser }) => {
    test.setTimeout(180_000);
    await failedRecordingSurvivesReload(browser, layout, `c${layout.name[0]}`);
  });

  test(`${TITLE} (WebKit, ${layout.name})`, async () => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    test.setTimeout(180_000);
    const browser = await launchWebKit();
    try {
      await failedRecordingSurvivesReload(browser, layout, `w${layout.name[0]}`);
    } finally {
      await browser.close();
    }
  });
}
