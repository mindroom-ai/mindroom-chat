import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { matrixFetch } from '../helpers/matrix';
import {
  bodyOf,
  composer,
  expect,
  messageRow,
  openThread,
  sendFromComposer,
  startThread,
  test,
  uniqueWord,
  waitForThreadEvent,
  type AgentStack,
} from '../helpers/agentStack';

// A voice call to a real MindRoom agent: the agent stack's helper answers calls with OpenAI's
// cheapest realtime voice (gpt-realtime-2.1-mini) on the slot's LiveKit server and MatrixRTC
// authorization service (scripts/e2e-rtc.sh). The browser's microphone plays a spoken question
// (e2e/fixtures/agent-call-question.wav, "What is the capital of France? Please answer in one
// short sentence."), the page records what it hears from the agent, and gpt-4o-transcribe has to
// find Paris in it. Once from a thread of the lobby, then from an encrypted room, whose call is
// encrypted end to end (frame keys over Olm between matrix-js-sdk and the agent, LiveKit frame
// encryption between livekit-client and the agent's Rust SDK). Each call lasts about 25 s.
//
// Needs OPENAI_API_KEY in the environment (it pays for the calls and the transcriptions) and the
// call service, so it skips without either:
//   set -a; . <key file>; set +a
//   E2E_AGENT_STACK_ROOT=<private directory> scripts/e2e-slot.sh <slot> --rtc --preview \
//     npx playwright test e2e/calls/agent-call.spec.ts
const SERVICE = process.env.E2E_LIVEKIT_SERVICE_URL;
const QUESTION = readFileSync(
  new URL('../fixtures/agent-call-question.wav', import.meta.url)
).toString('base64');

test.skip(
  !process.env.OPENAI_API_KEY,
  'needs OPENAI_API_KEY for the voice model and transcriptions'
);
test.skip(!SERVICE, 'needs the call service: scripts/e2e-slot.sh <slot> --rtc');

test.use({
  agentStackArgs: ['--calls', SERVICE ?? ''],
  permissions: ['microphone'],
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

type CallHarness = {
  /** Plays a WAV (base64) into every microphone the page opened; resolves with its length in seconds. */
  speak: (wav: string) => Promise<number>;
  /** The loudest sample of the call's incoming sound right now. */
  level: () => number;
  listen: () => void;
  /** The sound heard since `listen`, as base64 WebM. */
  heard: () => Promise<string>;
};

/**
 * Runs in the page before the app: microphones the app opens play what the test says, and the
 * agent's voice (the call's `[data-call-audio]` elements) is mixed into one recorder.
 */
const installCallHarness = () => {
  const audio = new AudioContext({ sampleRate: 48_000 });
  const incoming = audio.createMediaStreamDestination();
  const meter = audio.createAnalyser();
  meter.fftSize = 2048;
  const tapped = new WeakSet<MediaStream>();
  const tapIncoming = () => {
    document.querySelectorAll<HTMLAudioElement>('[data-call-audio] audio').forEach((element) => {
      const stream = element.srcObject;
      if (!(stream instanceof MediaStream) || tapped.has(stream)) return;
      tapped.add(stream);
      const source = audio.createMediaStreamSource(stream);
      source.connect(incoming);
      source.connect(meter);
    });
  };
  new MutationObserver(tapIncoming).observe(document, { childList: true, subtree: true });

  const microphones: MediaStreamAudioDestinationNode[] = [];
  const openDevices = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    const stream = await openDevices(constraints);
    if (!constraints?.audio) return stream;
    const microphone = audio.createMediaStreamDestination();
    microphones.push(microphone);
    stream.getAudioTracks().forEach((track) => {
      stream.removeTrack(track);
      track.stop();
    });
    const [track] = microphone.stream.getAudioTracks();
    if (track) stream.addTrack(track);
    return stream;
  };

  let recorder: MediaRecorder | undefined;
  let pieces: Blob[] = [];
  const harness: CallHarness = {
    async speak(wav) {
      await audio.resume();
      const bytes = Uint8Array.from(atob(wav), (char) => char.charCodeAt(0));
      const clip = await audio.decodeAudioData(bytes.buffer);
      microphones.forEach((microphone) => {
        const player = audio.createBufferSource();
        player.buffer = clip;
        player.connect(microphone);
        player.start();
      });
      return clip.duration;
    },
    level() {
      tapIncoming();
      const samples = new Float32Array(meter.fftSize);
      meter.getFloatTimeDomainData(samples);
      return samples.reduce((loudest, sample) => Math.max(loudest, Math.abs(sample)), 0);
    },
    listen() {
      tapIncoming();
      pieces = [];
      recorder = new MediaRecorder(incoming.stream, { mimeType: 'audio/webm;codecs=opus' });
      recorder.ondataavailable = (event) => pieces.push(event.data);
      recorder.start(250);
    },
    heard() {
      const current = recorder;
      return new Promise((resolve) => {
        if (!current) {
          resolve('');
          return;
        }
        current.onstop = async () => {
          const bytes = new Uint8Array(await new Blob(pieces).arrayBuffer());
          let binary = '';
          bytes.forEach((byte) => {
            binary += String.fromCharCode(byte);
          });
          resolve(btoa(binary));
        };
        current.stop();
      });
    },
  };
  (window as unknown as { callHarness: CallHarness }).callHarness = harness;
};

type HarnessWindow = { callHarness: CallHarness };
const level = (page: Page) =>
  page.evaluate(() => (window as unknown as HarnessWindow).callHarness.level());
const speak = (page: Page, wav: string) =>
  page.evaluate((clip) => (window as unknown as HarnessWindow).callHarness.speak(clip), wav);
const listen = (page: Page) =>
  page.evaluate(() => (window as unknown as HarnessWindow).callHarness.listen());
const heard = async (page: Page) =>
  Buffer.from(
    await page.evaluate(() => (window as unknown as HarnessWindow).callHarness.heard()),
    'base64'
  );

/**
 * Waits for the agent to speak (up to `within` ms) and then to pause for `pause` ms, or to have
 * spoken for `longest` ms. Answers whether it spoke at all.
 */
const agentSpeaks = async (page: Page, { within = 20_000, pause = 1_500, longest = 12_000 }) => {
  const start = Date.now();
  // eslint-disable-next-line no-await-in-loop
  while ((await level(page)) < 0.02) {
    if (Date.now() - start > within) return false;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(50);
  }
  const spoke = Date.now();
  let loud = spoke;
  while (Date.now() - loud < pause && Date.now() - spoke < longest) {
    // eslint-disable-next-line no-await-in-loop
    if ((await level(page)) > 0.01) loud = Date.now();
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(50);
  }
  return true;
};

const transcribe = async (webm: Buffer): Promise<string> => {
  const form = new FormData();
  form.append('model', 'gpt-4o-transcribe');
  form.append('file', new Blob([webm], { type: 'audio/webm' }), 'agent.webm');
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}` },
    body: form,
  });
  expect(response.ok, `the transcription answered ${response.status}`).toBe(true);
  return ((await response.json()) as { text: string }).text;
};

type StateEvent = { type: string; state_key: string; content: Record<string, unknown> };

const roomState = (stack: AgentStack, roomId: string) =>
  matrixFetch<StateEvent[]>(stack.homeserver, `/rooms/${encodeURIComponent(roomId)}/state`, {
    accessToken: stack.tester.accessToken,
  });

/** The call memberships in the room that are still on (content not withdrawn). */
const liveMemberships = async (stack: AgentStack, roomId: string) =>
  (await roomState(stack, roomId))
    .filter(
      (event) =>
        event.type === 'org.matrix.msc3401.call.member' && Object.keys(event.content).length > 0
    )
    .map((event) => event.state_key);

/**
 * Calls the helper from the page's open conversation, asks the question once it greeted, and
 * hangs up after its answer. Returns the call room and what the agent answered, transcribed.
 */
const callAndAsk = async (page: Page, stack: AgentStack) => {
  await page.getByRole('button', { name: 'Call Helper' }).click();
  const panel = page.getByTestId('call-panel');
  await expect(panel).toContainText('Call with Helper', { timeout: 30_000 });
  await expect(panel.locator(`[data-call-tile="${stack.agents.helper}"]`)).toHaveAttribute(
    'data-connected',
    'true',
    { timeout: 60_000 }
  );
  // The agent greets the caller first: its sound reaches this page.
  expect(await agentSpeaks(page, { pause: 1_000 })).toBe(true);
  const callRoomId = await page.locator('[data-call-audio]').getAttribute('data-call-audio');
  expect(callRoomId, 'the call room of the agent call').toBeTruthy();
  expect(
    await liveMemberships(stack, callRoomId ?? ''),
    'the agent and this device are in the call'
  ).toHaveLength(2);

  const seconds = await speak(page, QUESTION);
  await page.waitForTimeout(seconds * 1000);
  await listen(page);
  expect(await agentSpeaks(page, { within: 15_000, pause: 2_000 }), 'the agent answers').toBe(true);
  const answer = await heard(page);

  // Hanging up closes the panel and withdraws both memberships: the agent leaves with the caller.
  await panel.getByRole('button', { name: 'End' }).click();
  await expect(panel).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('[data-call-tab]')).toHaveCount(0);
  await expect
    .poll(() => liveMemberships(stack, callRoomId ?? ''), { timeout: 30_000 })
    .toEqual([]);
  return { callRoomId: callRoomId ?? '', answer: await transcribe(answer) };
};

test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installCallHarness);
});

test('the agent hears a spoken question in a call from a thread and answers it aloud', async ({
  page,
  stack,
}) => {
  const rootId = await startThread(stack, `Quick question ${uniqueWord('call')}`);
  await openThread(page, stack, rootId);

  const { answer } = await callAndAsk(page, stack);
  expect(answer).toMatch(/paris/i);

  // The agent posts the call back into the thread with what both said.
  const writeback = await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.sender === stack.agents.helper && bodyOf(event).includes('Voice call'),
    { timeout: 60_000, description: 'the call posted back into the thread' }
  );
  expect(bodyOf(writeback)).toMatch(/capital of France/i);
  // The message shows as the call's card: "Voice call" and how long it lasted, then the
  // transcript's button with how many turns it holds.
  const row = messageRow(page, writeback.event_id);
  await expect(row.locator('[data-call-transcript-header]')).toHaveText(
    /^Voice call\s*\d+ (sec|min)$/,
    { timeout: 30_000 }
  );
  await expect(row.getByRole('button', { name: /^Transcript \d+ turns$/ })).toBeVisible();
});

test('a call about an encrypted conversation is encrypted end to end', async ({ page, stack }) => {
  const { room_id: roomId } = await matrixFetch<{ room_id: string }>(
    stack.homeserver,
    '/createRoom',
    {
      method: 'POST',
      accessToken: stack.tester.accessToken,
      body: JSON.stringify({
        name: `Secret plans ${uniqueWord('e')}`,
        preset: 'private_chat',
        invite: [stack.agents.helper],
        initial_state: [
          {
            type: 'm.room.encryption',
            state_key: '',
            content: { algorithm: 'm.megolm.v1.aes-sha2' },
          },
        ],
      }),
    }
  );
  // The agent takes the invitation (accept_invites) and so answers calls about the room.
  await expect
    .poll(
      async () =>
        Object.keys(
          (
            await matrixFetch<{ joined: Record<string, unknown> }>(
              stack.homeserver,
              `/rooms/${encodeURIComponent(roomId)}/joined_members`,
              { accessToken: stack.tester.accessToken }
            )
          ).joined
        ),
      { timeout: 60_000 }
    )
    .toContain(stack.agents.helper);
  await page.goto(`/home/${encodeURIComponent(roomId)}`, { timeout: 180_000 });
  await expect(composer(page)).toBeVisible({ timeout: 90_000 });
  // The message starts a thread, which opens once the agent answered in it; the call is about it.
  await sendFromComposer(page, 'Quick question about our plans');
  await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText('You said: Quick question about our plans')).toBeVisible({
    timeout: 90_000,
  });

  const { callRoomId, answer } = await callAndAsk(page, stack);
  expect(answer).toMatch(/paris/i);
  // The call room is encrypted (an earlier unencrypted call room gets encryption first), and the
  // agent received this device's frame key over Olm and installed it for its media identity.
  const state = await roomState(stack, callRoomId);
  expect(state.some((event) => event.type === 'm.room.encryption')).toBe(true);
  const log = readFileSync(stack.logs.backend, 'utf8')
    .split('\n')
    .filter((line) => line.includes(callRoomId));
  expect(log.some((line) => line.includes('call_frame_key_installed'))).toBe(true);
  expect(log.some((line) => line.includes('call_key_sent'))).toBe(true);
  // Its call notice in the encrypted thread decrypts here.
  await expect(page.getByText(/Voice call · \d+ min/).first()).toBeVisible({ timeout: 60_000 });
});
