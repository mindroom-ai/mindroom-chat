import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { FoundStretch } from '../fixtures/speech-capture';

// Call transcription's speech capture as it ships: the Silero VAD model, its runtime and the
// wrapper's AudioWorklet, loaded from the files the build serves, in Chromium. The fixture page
// plays a recording into the microphone track the capture listens to and reports the stretches it
// found: a spoken question (e2e/fixtures/agent-call-question.wav, 4.45 s) is one stretch, and
// typing, a fan and knocks on a door at the level of a voice are none.

const RATE = 16000;
const SPEECH = readFileSync(new URL('../fixtures/agent-call-question.wav', import.meta.url));
/** The wrapper's defaults: the 800 ms kept before speech, the 1400 ms of quiet that end it. */
const BEFORE = 0.8;
const AFTER = 1.4;

test.use({
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--autoplay-policy=no-user-gesture-required'],
  },
});

/** 16 kHz mono 16-bit samples as a WAV file. */
const wav = (samples: Float32Array) => {
  const file = Buffer.alloc(44 + samples.length * 2);
  file.write('RIFF', 0);
  file.writeUInt32LE(file.length - 8, 4);
  file.write('WAVEfmt ', 8);
  file.writeUInt32LE(16, 16);
  file.writeUInt16LE(1, 20);
  file.writeUInt16LE(1, 22);
  file.writeUInt32LE(RATE, 24);
  file.writeUInt32LE(RATE * 2, 28);
  file.writeUInt16LE(2, 32);
  file.writeUInt16LE(16, 34);
  file.write('data', 36);
  file.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, index) =>
    file.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + index * 2)
  );
  return file;
};

/**
 * Eight seconds of noise at the level of a voice, the same every run: a fan's hum and rush, typing
 * throughout (a click and a thud per key, 120 to 250 ms apart), and three knocks on a door.
 */
const noise = () => {
  let seed = 7;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const samples = new Float32Array(8 * RATE);
  let rush = 0;
  samples.forEach((_, index) => {
    rush += 0.15 * (random() * 2 - 1 - rush);
    samples[index] = 0.12 * rush + 0.02 * Math.sin((2 * Math.PI * 100 * index) / RATE);
  });
  /** Adds a decaying sound at `at` seconds. */
  const add = (at: number, seconds: number, sound: (time: number) => number) => {
    const first = Math.round(at * RATE);
    for (let index = 0; index < seconds * RATE && first + index < samples.length; index += 1) {
      samples[first + index] = (samples[first + index] ?? 0) + sound(index / RATE);
    }
  };
  for (let at = 0.2; at < 7.8; at += 0.12 + 0.13 * random()) {
    add(at, 0.006, (time) => 0.5 * (random() * 2 - 1) * Math.exp(-time / 0.0015));
    add(at, 0.04, (time) => 0.25 * Math.sin(2 * Math.PI * 180 * time) * Math.exp(-time / 0.01));
  }
  [5, 5.25, 5.5].forEach((at) =>
    add(at, 0.2, (time) => 0.6 * Math.sin(2 * Math.PI * 90 * time) * Math.exp(-time / 0.04))
  );
  return wav(samples);
};

const findSpeech = async (
  page: import('@playwright/test').Page,
  recording: Buffer,
  lead: number
): Promise<{ stretches: FoundStretch[]; files: string[] }> => {
  const files: string[] = [];
  page.on('request', (request) => files.push(request.url()));
  await page.goto('/e2e/fixtures/speech-capture.html');
  const stretches = await page.evaluate(([file, wait]) => window.findSpeech(file, wait), [
    recording.toString('base64'),
    lead,
  ] as const);
  // The worklet loads too, through a request the page's events do not show.
  return { stretches, files: files.filter((url) => /\.onnx$|\/ort-/.test(url)) };
};

test('finds a spoken question as one stretch, from the speech files this app serves', async ({
  page,
  baseURL,
}) => {
  const lead = 1.5;
  const { stretches, files } = await findSpeech(page, SPEECH, lead);
  // The model and the runtime's module and WebAssembly, from this app's own build.
  const model = files.map((url) => url.replace(/\/assets\/speech-model-[0-9a-f]+\//, '/model/'));
  expect(model.sort()).toEqual([
    `${baseURL}/model/ort-wasm-simd-threaded.js`,
    `${baseURL}/model/ort-wasm-simd-threaded.wasm`,
    `${baseURL}/model/silero_vad_legacy.onnx`,
  ]);
  expect(stretches).toHaveLength(1);
  const [stretch] = stretches as [FoundStretch];
  // Its words and the defaults' margins, and no more; heard where the recording played.
  expect(stretch.seconds).toBeGreaterThan(4);
  expect(stretch.seconds).toBeLessThan(4.45 + BEFORE + AFTER + 0.3);
  expect(stretch.from).toBeGreaterThan(lead - BEFORE - 0.5);
  expect(stretch.from).toBeLessThan(lead + 0.5);
});

test('finds no speech in typing, a fan and knocks on a door', async ({ page }) => {
  const { stretches } = await findSpeech(page, noise(), 0.5);
  expect(stretches).toEqual([]);
});
