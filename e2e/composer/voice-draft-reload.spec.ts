import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { loginToMatrix, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
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
  const username = `vdr_${name}_${RUN}`;
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  expect(response.ok, `registering ${username}`).toBe(true);
  const session = await loginToMatrix(HOMESERVER, username, PASSWORD);
  const roomId = await createRoom(HOMESERVER, session.accessToken, {
    name: `Field notes ${name}`,
  });
  await sendRoomMessage(HOMESERVER, session.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'I will send the dock report as a voice message after the inspection.',
  });
  return { username, session, roomId };
};

const voiceMessages = async (world: Awaited<ReturnType<typeof seed>>): Promise<number> => {
  const page = await matrixFetch<{ chunk: { type: string; content: { msgtype?: string } }[] }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(world.roomId)}/messages?dir=b&limit=100`,
    { accessToken: world.session.accessToken }
  );
  return page.chunk.filter(
    (event) => event.type === 'm.room.message' && event.content.msgtype === 'm.audio'
  ).length;
};

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
      username: world.username,
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

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const TITLE = 'a voice message whose send failed is still saved after a reload';

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
