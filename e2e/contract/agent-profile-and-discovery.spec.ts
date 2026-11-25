import { readFileSync } from 'node:fs';
import {
  composer,
  expect,
  messageRow,
  openLobby,
  showPath,
  showThread,
  startThread,
  test,
  uniqueWord,
  waitForAgentReply,
} from '../helpers/agentStack';

// Real-backend contract specs under production discovery (`computers: { apiUrl: "" }`, default
// `clientApiUrl: false`, zero HTTP mocks): agent profile card discovery, real browser dictation
// into the composer, and encrypted provider usage limits RPC.
test.use({
  agentStackArgs: ['--model', 'stub', '--client-sessions', '--transcription', 'stub'],
  permissions: ['microphone'],
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
test.describe.configure({ timeout: 300_000 });

const COMPUTER_SERVICE_STORAGE_KEY = 'mindroomComputerService.v1';
const SPEECH_BASE64 = readFileSync(
  new URL('../fixtures/agent-call-question.wav', import.meta.url)
).toString('base64');

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

test('discovers Helper profile card automatically with empty computers.apiUrl', async ({
  page,
  stack,
}) => {
  const configResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/config.json') && response.status() === 200,
    { timeout: 90_000 }
  );
  await openLobby(page, stack);
  const configBody = (await (await configResponsePromise).json()) as {
    mindroom?: { computers?: { apiUrl?: string } };
  };
  expect(configBody.mindroom?.computers?.apiUrl ?? '').toBe('');
  expect(
    await page.evaluate((key) => localStorage.getItem(key), COMPUTER_SERVICE_STORAGE_KEY)
  ).toBeNull();

  const word = uniqueWord('profile');
  const rootId = await startThread(stack, word);
  const reply = await waitForAgentReply(stack, rootId, (body) => body.includes(word));

  await showThread(page, stack, rootId);
  const replyRow = messageRow(page, reply.event_id);
  await expect(replyRow).toBeVisible({ timeout: 60_000 });
  await replyRow.locator(`[data-user-id="${stack.agents.helper}"]`).first().click();

  const card = page.getByRole('dialog', { name: 'Helper', exact: true });
  await expect(card.getByText('Stub Fast', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(
    card.getByText('Test agent driven by a stub model', { exact: true })
  ).toBeVisible();
  await expect(card.getByText('Configured tools', { exact: true })).toBeVisible();
  await expect(card.getByText(/Shell Commands/)).toBeVisible();

  await card.getByRole('button', { name: /View all/ }).click();
  await card.getByLabel('Filter tools').fill('shell');
  await expect(card.getByText('Shell Commands', { exact: true })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
});

test('probes real dictation status via automatic discovery and dictates into the composer', async ({
  page,
  stack,
}) => {
  await page.addInitScript(installSpokenMicrophone, SPEECH_BASE64);
  const statusResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().startsWith(`${stack.apiUrl}/api/dictation/v1/status`),
    { timeout: 90_000 }
  );
  await openLobby(page, stack);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), COMPUTER_SERVICE_STORAGE_KEY)
  ).toBeNull();

  const statusResponse = await statusResponsePromise;
  expect(statusResponse.status()).toBe(200);
  const status = (await statusResponse.json()) as { enabled?: boolean };
  expect(status.enabled).toBe(true);

  const dictateButton = page.getByRole('button', { name: 'Dictate' });
  await expect(dictateButton).toBeVisible({ timeout: 30_000 });

  const transcribeResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().startsWith(`${stack.apiUrl}/api/dictation/v1/transcribe`),
    { timeout: 60_000 }
  );
  await dictateButton.click();

  const finishButton = page.getByRole('button', { name: 'Finish into composer' });
  await expect(finishButton).toBeVisible({ timeout: 30_000 });

  const transcribeResponse = await transcribeResponsePromise;
  expect(transcribeResponse.status()).toBe(200);
  const transcribed = (await transcribeResponse.json()) as { text?: string };
  expect(transcribed.text).toMatch(/Stand-in transcript of/);

  await expect(page.getByTestId('dictation-preview')).toContainText('Stand-in transcript of', {
    timeout: 15_000,
  });
  await finishButton.click();
  await expect(finishButton).toHaveCount(0, { timeout: 15_000 });
  await expect(composer(page)).toContainText('Stand-in transcript of', { timeout: 15_000 });
});

test('loads provider usage limits over encrypted RPC without errors', async ({ page, stack }) => {
  await openLobby(page, stack);
  await showPath(page, '/usage/');

  const usageView = page.getByTestId('usage-view');
  await expect(usageView).toBeVisible({ timeout: 60_000 });
  await expect(
    usageView.getByRole('heading', { name: 'Usage & Limits', exact: true })
  ).toBeVisible();

  const limitsTab = usageView.getByRole('tab', { name: 'Limits', exact: true });
  const tokensTab = usageView.getByRole('tab', { name: 'Tokens & Cost', exact: true });
  await expect(limitsTab).toBeVisible({ timeout: 90_000 });
  await expect(limitsTab).toHaveAttribute('aria-selected', 'true');
  await expect(tokensTab).toBeVisible();
  await expect(page.getByTestId('usage-unavailable')).toHaveCount(0);
  await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);

  await tokensTab.click();
  await expect(tokensTab).toHaveAttribute('aria-selected', 'true');
  await expect(usageView.getByText('7-day total tokens', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('usage-unavailable')).toHaveCount(0);
  await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
});
