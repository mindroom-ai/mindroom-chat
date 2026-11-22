#!/usr/bin/env node
/**
 * Synthesizes `ios/App/App/ring.wav`: 16-bit PCM mono, 11.025 kHz, 28.6 s (11 cycles of the bell
 * pattern in `src/app/calls/ringtone.ts`), strictly under iOS's 30 s APNs custom sound limit.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RING_SAMPLE_RATE = 11_025;
export const RING_CHANNELS = 1;
export const RING_BITS_PER_SAMPLE = 16;
export const RING_CYCLE_SECONDS = 2.6;
export const RING_CYCLES = 11;
export const RING_DURATION_SECONDS = RING_CYCLE_SECONDS * RING_CYCLES; // 28.6 s

const NOTES = [
  { at: 0, frequency: 987.77 }, // B5
  { at: 0.17, frequency: 1318.51 }, // E6
  { at: 0.55, frequency: 987.77 }, // B5
  { at: 0.72, frequency: 1318.51 }, // E6
];
const NOTE_SECONDS = 0.45;
const ATTACK_SECONDS = 0.012;
const ENVELOPE_FLOOR = 0.0001;
const PARTIALS = [
  { multiple: 1, level: 1 },
  { multiple: 2, level: 0.2 },
];
// Scaled for an APNs ringer alert (peak ~0.65, zero clipping) while keeping ringtone.ts's timbre.
const GAIN = 0.55;

export const buildRingtoneWav = () => {
  const totalSamples = Math.round(RING_DURATION_SECONDS * RING_SAMPLE_RATE);
  const pcm = new Float64Array(totalSamples);

  const noteSamples = Math.ceil(NOTE_SECONDS * RING_SAMPLE_RATE);
  const decaySeconds = NOTE_SECONDS - ATTACK_SECONDS;
  const twoPi = 2 * Math.PI;

  for (let cycle = 0; cycle < RING_CYCLES; cycle += 1) {
    const cycleStart = cycle * RING_CYCLE_SECONDS;
    for (const note of NOTES) {
      const startIndex = Math.round((cycleStart + note.at) * RING_SAMPLE_RATE);
      for (let i = 0; i < noteSamples; i += 1) {
        const index = startIndex + i;
        if (index >= totalSamples) break;
        const t = i / RING_SAMPLE_RATE;
        const envelope =
          t < ATTACK_SECONDS
            ? ENVELOPE_FLOOR * (1 / ENVELOPE_FLOOR) ** (t / ATTACK_SECONDS)
            : ENVELOPE_FLOOR ** ((t - ATTACK_SECONDS) / decaySeconds);
        let sample = 0;
        for (const partial of PARTIALS) {
          sample += partial.level * Math.sin(twoPi * note.frequency * partial.multiple * t);
        }
        pcm[index] += sample * envelope * GAIN;
      }
    }
  }

  const dataByteLength = totalSamples * RING_CHANNELS * (RING_BITS_PER_SAMPLE / 8);
  const buffer = Buffer.alloc(44 + dataByteLength);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataByteLength, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(RING_CHANNELS, 22);
  buffer.writeUInt32LE(RING_SAMPLE_RATE, 24);
  buffer.writeUInt32LE(RING_SAMPLE_RATE * RING_CHANNELS * (RING_BITS_PER_SAMPLE / 8), 28);
  buffer.writeUInt16LE(RING_CHANNELS * (RING_BITS_PER_SAMPLE / 8), 32);
  buffer.writeUInt16LE(RING_BITS_PER_SAMPLE, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataByteLength, 40);

  for (let i = 0; i < totalSamples; i += 1) {
    const clamped = Math.max(-1, Math.min(1, pcm[i] ?? 0));
    buffer.writeInt16LE(Math.round(clamped * 32_767), 44 + i * 2);
  }
  return buffer;
};

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const outputPath = resolve(root, 'ios/App/App/ring.wav');
  const wav = buildRingtoneWav();
  if (process.argv.includes('--check')) {
    const existing = readFileSync(outputPath);
    if (!existing.equals(wav)) {
      process.stderr.write(
        'ios/App/App/ring.wav is out of date; run node scripts/generate-ios-ringtone.mjs\n'
      );
      process.exit(1);
    }
  } else {
    writeFileSync(outputPath, wav);
    process.stdout.write(`Wrote ${outputPath} (${wav.length} bytes, ${RING_DURATION_SECONDS}s)\n`);
  }
}
