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
  onTranscribe: (record: TranscribeRecord) => void,
  resolveTranscript?: (record: TranscribeRecord) => Promise<string>
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
      const record: TranscribeRecord = {
        roomId: url.searchParams.get('room_id'),
        contentType: request.headers()['content-type'] ?? '',
        bodyText: buf ? buf.toString('latin1') : '',
      };
      onTranscribe(record);
      const text = resolveTranscript
        ? await resolveTranscript(record)
        : 'Ship the dictation feature today.';
      await route.fulfill({
        headers: CORS,
        json: { text, seconds: 4.3 },
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

    const finishButton = page.getByRole('button', { name: 'Finish into composer' });
    await expect(finishButton).toBeVisible({ timeout: 15_000 });
    // Direct Finish & Send is enabled on the composer Send button while dictating.
    await expect(page.getByRole('button', { name: 'Finish and send' })).toBeEnabled();

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

test('Finish and send survives immediate switch to another room while transcription is in flight', async ({
  browser,
}) => {
  test.skip(!(await disposableHomeserverIsUp()), 'needs the disposable homeserver (just hs-up)');

  const user = await registerDisposableUser(`dict_send_${RUN}`, PASSWORD);
  const roomAName = `Dictation A ${RUN}`;
  const roomBName = `Dictation B ${RUN}`;
  const roomAId = await createRoom(HOMESERVER, user.accessToken, { name: roomAName });
  const roomBId = await createRoom(HOMESERVER, user.accessToken, { name: roomBName });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
  });
  await context.grantPermissions(['microphone']);
  await context.addInitScript(installSpokenMicrophone, SPEECH_BASE64);

  const transcribeCalls: TranscribeRecord[] = [];
  let releaseTranscribe!: (text: string) => void;
  const transcribeGate = new Promise<string>((resolve) => {
    releaseTranscribe = resolve;
  });

  try {
    await serveDictationApi(
      context,
      user,
      (record) => transcribeCalls.push(record),
      () => transcribeGate
    );
    const page = await context.newPage();
    const sentMessages: Array<{ roomId: string; body: string }> = [];
    await page.route(
      (url) =>
        /\/_matrix\/client\/(v3|r0)\/rooms\/[^/]+\/send\/m\.room\.message\//.test(url.pathname),
      async (route) => {
        const req = route.request();
        if (req.method() === 'PUT') {
          const match = /\/rooms\/([^/]+)\/send\/m\.room\.message\//.exec(
            new URL(req.url()).pathname
          );
          const payload = req.postDataJSON() as { body?: string } | null;
          if (match?.[1] && typeof payload?.body === 'string') {
            sentMessages.push({ roomId: decodeURIComponent(match[1]), body: payload.body });
          }
        }
        await route.continue();
      }
    );

    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: user.username,
      password: PASSWORD,
    });
    await page.goto(`/home/${encodeURIComponent(roomAId)}`);

    const composer = page.locator('[data-editable-name="RoomInput"]');
    await expect(composer).toBeVisible({ timeout: 60_000 });

    const dictateButton = page.getByRole('button', { name: 'Dictate' });
    await expect(dictateButton).toBeVisible({ timeout: 30_000 });
    await dictateButton.click();

    const finishAndSend = page.getByRole('button', { name: 'Finish and send' });
    await expect(finishAndSend).toBeEnabled({ timeout: 15_000 });
    // Wait until a speech segment is actively in flight to /transcribe.
    await expect.poll(() => transcribeCalls.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);

    // Click Finish and send, then immediately switch to Room B before /transcribe resolves.
    await finishAndSend.click();
    await page.getByRole('link', { name: new RegExp(roomBName) }).click();
    await expect.poll(() => decodeURIComponent(page.url())).toContain(roomBId);
    // Dictation ownership was released immediately, so Room B can dictate right away.
    await expect(page.getByRole('button', { name: 'Dictate' })).toBeEnabled({ timeout: 15_000 });

    // Nothing is sent to Matrix while /transcribe is still held open.
    expect(sentMessages).toEqual([]);

    // Resolve /transcribe now that we are in Room B.
    const sentText = 'Delivered to room A after switch.';
    releaseTranscribe(sentText);

    // Wait deterministically for the Matrix m.room.message PUT to land for Room A.
    await expect
      .poll(() => sentMessages.some((m) => m.roomId === roomAId && m.body === sentText), {
        timeout: 30_000,
      })
      .toBe(true);
    // Room B stays completely untouched.
    expect(sentMessages.filter((m) => m.roomId === roomBId)).toEqual([]);
    await expect(page.getByText(sentText)).toHaveCount(0);
    await expect(composer).not.toContainText(sentText);

    // Switch back to Room A and verify the dictated message arrived in Room A's timeline, not composer.
    await page.getByRole('link', { name: new RegExp(roomAName) }).click();
    await expect.poll(() => decodeURIComponent(page.url())).toContain(roomAId);
    await expect(page.getByText(sentText)).toBeVisible({ timeout: 30_000 });
    await expect(composer).not.toContainText(sentText);
  } finally {
    await context.close();
  }
});

test('shows live dictation indicator in Settings, cancels Discard, and finishes into another room', async ({
  browser,
}) => {
  test.skip(!(await disposableHomeserverIsUp()), 'needs the disposable homeserver (just hs-up)');

  const user = await registerDisposableUser(`dict_nav_${RUN}`, PASSWORD);
  const roomAName = `Room Alpha ${RUN}`;
  const roomBName = `Room Beta ${RUN}`;
  const roomAId = await createRoom(HOMESERVER, user.accessToken, { name: roomAName });
  const roomBId = await createRoom(HOMESERVER, user.accessToken, { name: roomBName });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
  });
  await context.grantPermissions(['microphone']);
  await context.addInitScript(installSpokenMicrophone, SPEECH_BASE64);

  const transcribeCalls: TranscribeRecord[] = [];
  const transcript = 'Cross room dictation works.';

  try {
    await serveDictationApi(
      context,
      user,
      (record) => transcribeCalls.push(record),
      async () => transcript
    );
    const page = await context.newPage();

    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: user.username,
      password: PASSWORD,
    });
    await page.goto(`/home/${encodeURIComponent(roomAId)}`);

    const composer = page.locator('[data-editable-name="RoomInput"]');
    await expect(composer).toBeVisible({ timeout: 60_000 });

    const dictateButton = page.getByRole('button', { name: 'Dictate' });
    await expect(dictateButton).toBeVisible({ timeout: 30_000 });
    await dictateButton.click();

    const finishButton = page.getByRole('button', { name: 'Finish into composer' });
    await expect(finishButton).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => transcribeCalls.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId('dictation-preview')).toContainText(transcript);

    // Open Settings: live capture indicator appears inside Settings with dictation status + timer.
    await page.keyboard.press('ControlOrMeta+,');
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await expect(settings).toBeVisible({ timeout: 30_000 });
    const indicator = settings.getByTestId('live-dictation-indicator');
    await expect(indicator).toBeVisible();
    await expect(indicator).toContainText(/Dictating \d+:\d{2}/);

    // Discard asks for confirmation; cancelling keeps dictation live.
    await indicator.getByRole('button', { name: 'Discard dictation' }).click();
    const confirmDialog = page.getByRole('dialog', { name: 'Discard dictation?' });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(confirmDialog).toHaveCount(0);
    await expect(indicator).toBeVisible();

    // Close Settings, switch to Room B, and finish dictation into Room B's composer.
    await page.keyboard.press('Escape');
    await expect(settings).toHaveCount(0);
    await expect(page.getByTestId('live-dictation-indicator')).toHaveCount(0);

    await page.getByRole('link', { name: new RegExp(roomBName) }).click();
    await expect.poll(() => decodeURIComponent(page.url())).toContain(roomBId);
    await expect(finishButton).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('dictation-preview')).toContainText(transcript);

    await finishButton.click();
    await expect(finishButton).toHaveCount(0, { timeout: 15_000 });
    await expect(composer).toContainText(transcript);
  } finally {
    await context.close();
  }
});

test('recovers paused dictation with preview text after browser reload and inserts on Finish', async ({
  browser,
}) => {
  test.skip(!(await disposableHomeserverIsUp()), 'needs the disposable homeserver (just hs-up)');

  const user = await registerDisposableUser(`dict_reload_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, user.accessToken, { name: `Room Reload ${RUN}` });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
  });
  await context.grantPermissions(['microphone']);
  await context.addInitScript(installSpokenMicrophone, SPEECH_BASE64);

  const transcribeCalls: TranscribeRecord[] = [];
  const transcript = 'Survived browser reload.';

  try {
    await serveDictationApi(
      context,
      user,
      (record) => transcribeCalls.push(record),
      async () => transcript
    );
    const page = await context.newPage();

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

    const finishButton = page.getByRole('button', { name: 'Finish into composer' });
    await expect(finishButton).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => transcribeCalls.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId('dictation-preview')).toContainText(transcript);

    // Wait for the completed transcript checkpoint to flush to IndexedDB before reloading.
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              new Promise<boolean>((resolve) => {
                const req = indexedDB.open('mindroom-voice-journal', 1);
                req.onerror = () => resolve(false);
                req.onsuccess = () => {
                  const db = req.result;
                  if (!db.objectStoreNames.contains('recordings')) {
                    db.close();
                    resolve(false);
                    return;
                  }
                  const tx = db.transaction('recordings', 'readonly');
                  const all = tx.objectStore('recordings').getAll();
                  all.onerror = () => {
                    db.close();
                    resolve(false);
                  };
                  all.onsuccess = () => {
                    const rows = all.result as Array<{
                      kind?: string;
                      segments?: Array<{ status?: string }>;
                    }>;
                    db.close();
                    resolve(
                      rows.some(
                        (row) =>
                          row.kind === 'dictation' &&
                          row.segments?.some((seg) => seg.status === 'completed')
                      )
                    );
                  };
                };
              })
          ),
        { timeout: 15_000 }
      )
      .toBe(true);

    await page.reload();
    await expect(composer).toBeVisible({ timeout: 60_000 });

    // Dictation recovers paused with "Recovered · ..." and preserves the transcribed preview.
    await expect(page.getByText(/Recovered · \d+:\d{2}/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Resume dictation' })).toBeVisible();
    await expect(page.getByTestId('dictation-preview')).toContainText(transcript);

    await finishButton.click();
    await expect(finishButton).toHaveCount(0, { timeout: 15_000 });
    await expect(composer).toContainText(transcript);
  } finally {
    await context.close();
  }
});
