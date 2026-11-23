import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';

// Streaming voice-to-composer dictation: plays a real spoken recording through the AudioWorklet
// and Silero VAD against mocked /api/dictation/v1/* routes, proving an early segment upload
// fires before Finish is clicked, text appears editable in the composer on Finish, and zero
// Matrix voice media uploads occur.
const PASSWORD = 'dictation-spec-password';
const RUN = Date.now().toString(36);
const MINDROOM_API = 'http://127.0.0.1:41999';
const SPEECH_BASE64 = readFileSync(
  new URL('../fixtures/agent-call-question.wav', import.meta.url)
).toString('base64');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type, Accept',
};

test.use({
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--disable-features=IsolateSandboxedIframes',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  },
});

/**
 * Replaces getUserMedia audio with a stream playing the real spoken WAV clip followed by silence,
 * so Silero VAD detects natural speech start and pause end deterministically in headless Chromium.
 */
const installSpokenMicrophone = (speechBase64: string) => {
  const devices = navigator.mediaDevices as MediaDevices | undefined;
  if (!devices) return;
  const original = devices.getUserMedia.bind(devices);
  devices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    if (!constraints?.audio || constraints.video) return original(constraints);
    const context = new AudioContext();
    await context.resume().catch(() => undefined);
    const bytes = Uint8Array.from(atob(speechBase64), (ch) => ch.charCodeAt(0));
    const decoded = await context.decodeAudioData(bytes.buffer.slice(0));
    const destination = context.createMediaStreamDestination();
    // Keep the MediaStream active with a silent oscillator after the spoken clip ends.
    const silentOsc = context.createOscillator();
    const zeroGain = context.createGain();
    zeroGain.gain.value = 0;
    silentOsc.connect(zeroGain);
    zeroGain.connect(destination);
    silentOsc.start();

    const source = context.createBufferSource();
    source.buffer = decoded;
    source.connect(destination);
    source.start(context.currentTime + 0.25);

    const stream = destination.stream;
    const [track] = stream.getAudioTracks();
    const origStop = track?.stop.bind(track);
    if (track && origStop) {
      track.stop = () => {
        try {
          source.stop();
          silentOsc.stop();
        } catch {
          // Ignore already stopped sources.
        }
        origStop();
        void context.close().catch(() => undefined);
      };
    }
    return stream;
  };
};

type TranscribeRecord = {
  roomId: string | null;
  contentType: string;
  bodyText: string;
};

const serveDictationApi = async (
  context: BrowserContext,
  user: DisposableUser,
  onTranscribe: (record: TranscribeRecord) => void
) => {
  await context.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as Record<string, Record<string, unknown>>;
    await route.fulfill({
      response,
      json: {
        ...config,
        homeserverList: [HOMESERVER],
        defaultHomeserver: 0,
        mindroom: { ...config.mindroom, computers: { apiUrl: MINDROOM_API } },
      },
    });
  });

  await context.route(`${MINDROOM_API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    if (url.pathname === '/api/client-sessions') {
      await route.fulfill({
        headers: CORS,
        json: {
          session_token: `dictation-${RUN}`,
          user_id: user.userId,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      });
      return;
    }
    if (url.pathname === '/api/dictation/v1/status') {
      await route.fulfill({
        headers: CORS,
        json: { enabled: true, maxSegmentSeconds: 30, maxSegmentBytes: 1_000_000 },
      });
      return;
    }
    if (url.pathname === '/api/dictation/v1/transcribe') {
      const buf = request.postDataBuffer();
      onTranscribe({
        roomId: url.searchParams.get('room_id'),
        contentType: request.headers()['content-type'] ?? '',
        bodyText: buf ? buf.toString('latin1') : '',
      });
      await route.fulfill({
        headers: CORS,
        json: { text: 'Ship the dictation feature today.', seconds: 4.3 },
      });
      return;
    }
    await route.fulfill({ status: 404, headers: CORS, json: { error: 'Not found' } });
  });
};

test('uploads a speech segment before Finish, inserts editable text, and makes no Matrix voice upload', async ({
  browser,
}) => {
  test.skip(!(await disposableHomeserverIsUp()), 'needs the disposable homeserver (just hs-up)');

  const user = await registerDisposableUser(`dict_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, user.accessToken, { name: `Dictation ${RUN}` });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
  });
  await context.grantPermissions(['microphone']);
  await context.addInitScript(installSpokenMicrophone, SPEECH_BASE64);

  const transcribeCalls: TranscribeRecord[] = [];
  let matrixMediaUploads = 0;

  try {
    await serveDictationApi(context, user, (record) => transcribeCalls.push(record));
    const page = await context.newPage();

    await page.route(
      (url) => /\/media\/(v3|r0)\/upload$|\/v1\/media\/upload$/.test(url.pathname),
      async (route) => {
        if (route.request().method() === 'POST') matrixMediaUploads += 1;
        await route.continue();
      }
    );

    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: user.username,
      password: PASSWORD,
    });
    await page.goto(`/home/${encodeURIComponent(roomId)}`);

    const composer = page.locator('[data-editable-name="RoomInput"]');
    await expect(composer).toBeVisible({ timeout: 60_000 });

    const dictateButton = page.getByRole('button', { name: 'Dictate' });
    await expect(dictateButton).toBeVisible({ timeout: 30_000 });
    await dictateButton.click();

    const finishButton = page.getByRole('button', { name: 'Finish dictation' });
    await expect(finishButton).toBeVisible({ timeout: 15_000 });
    // Send is blocked while dictating.
    await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();

    // Early segment upload must fire after the natural pause BEFORE Finish is clicked.
    await expect.poll(() => transcribeCalls.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
    expect(transcribeCalls[0]?.roomId).toBe(roomId);
    expect(transcribeCalls[0]?.contentType).toContain('multipart/form-data');
    expect(transcribeCalls[0]?.bodyText).toContain('filename="speech.wav"');

    // Live preview shows the completed segment while the editor is NOT mutated mid-dictation.
    await expect(page.getByTestId('dictation-preview')).toContainText(
      'Ship the dictation feature today.'
    );
    await expect(composer).not.toContainText('Ship the dictation feature today.');

    await finishButton.click();
    await expect(finishButton).toHaveCount(0, { timeout: 15_000 });
    await expect(composer).toContainText('Ship the dictation feature today.');
    // Dictation started without focusing the composer, so Finish must not focus it.
    await expect(composer).not.toBeFocused();

    // Inserted text is editable in the composer.
    await composer.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Ready to test.');
    await expect(composer).toContainText('Ship the dictation feature today. Ready to test.');

    // Zero Matrix voice uploads occurred.
    expect(matrixMediaUploads).toBe(0);
  } finally {
    await context.close();
  }
});
