import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildRingtoneWav,
  RING_BITS_PER_SAMPLE,
  RING_CHANNELS,
  RING_DURATION_SECONDS,
  RING_SAMPLE_RATE,
} from '../../../scripts/generate-ios-ringtone.mjs';

const require = createRequire(import.meta.url);
const requireCapacitor = createRequire(require.resolve('@capacitor/cli/package.json'));
const xcode = requireCapacitor('xcode');

const appDir = resolve('ios/App/App');
const projectPath = resolve('ios/App/App.xcodeproj/project.pbxproj');

describe('iOS incoming call ring resources', () => {
  it('bundles ring.wav matching the generator script, under the 30 s APNs limit', () => {
    const wav = readFileSync(resolve(appDir, 'ring.wav'));
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(RING_CHANNELS);
    expect(RING_SAMPLE_RATE).toBe(11_025);
    expect(wav.readUInt32LE(24)).toBe(11_025);
    expect(wav.readUInt16LE(34)).toBe(RING_BITS_PER_SAMPLE);
    expect(wav.toString('ascii', 36, 40)).toBe('data');

    const dataBytes = wav.readUInt32LE(40);
    const bytesPerSecond = RING_SAMPLE_RATE * RING_CHANNELS * (RING_BITS_PER_SAMPLE / 8);
    const durationSeconds = dataBytes / bytesPerSecond;
    expect(durationSeconds).toBeCloseTo(RING_DURATION_SECONDS, 4);
    expect(durationSeconds).toBeLessThan(30);

    // Ensure the audio is non-silent and matches the committed script byte-for-byte.
    let peak = 0;
    for (let offset = 44; offset < wav.length; offset += 2) {
      peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)));
    }
    expect(peak).toBeGreaterThan(5_000);
    expect(wav.equals(buildRingtoneWav())).toBe(true);
  });

  it('registers ring.wav in the Xcode project Resources for App and AppStoreMac', () => {
    const project = xcode.project(projectPath);
    project.parseSync();

    const fileRefs = project.pbxFileReferenceSection();
    const ringRef = Object.entries(fileRefs).find(
      ([key, value]) =>
        !key.endsWith('_comment') &&
        typeof value === 'object' &&
        value !== null &&
        (value as { path?: string }).path === 'ring.wav'
    );
    expect(ringRef).toBeDefined();

    const targets = project.pbxNativeTargetSection();
    const phases = project.hash.project.objects.PBXResourcesBuildPhase as Record<
      string,
      { files?: Array<{ comment?: string }> }
    >;
    for (const targetName of ['App', 'AppStoreMac']) {
      const targetEntry = Object.entries(targets).find(
        ([key, value]) =>
          !key.endsWith('_comment') &&
          typeof value === 'object' &&
          value !== null &&
          ((value as { name?: string }).name === targetName ||
            (value as { name?: string }).name === `"${targetName}"`)
      );
      expect(targetEntry, `target ${targetName}`).toBeDefined();
      const buildPhases = (
        targetEntry![1] as { buildPhases: Array<{ value: string; comment?: string }> }
      ).buildPhases;
      const resourcePhase = buildPhases.find((phase) => phase.comment === 'Resources');
      expect(resourcePhase, `${targetName} Resources phase`).toBeDefined();
      const files = phases[resourcePhase!.value]?.files ?? [];
      expect(
        files.some((entry) => entry.comment === 'ring.wav in Resources'),
        `${targetName} bundles ring.wav`
      ).toBe(true);
    }
  });

  it('updates VOICE_CALL_FROM_USER and VIDEO_CALL_FROM_USER in all 17 locales', () => {
    const lprojs = readdirSync(appDir)
      .filter((name) => name.endsWith('.lproj') && name !== 'Base.lproj')
      .sort();
    expect(lprojs).toHaveLength(17);

    for (const dir of lprojs) {
      const strings = readFileSync(resolve(appDir, dir, 'Localizable.strings'), 'utf8');
      const voice = strings.match(/^"VOICE_CALL_FROM_USER"\s*=\s*"([^"]+)";$/m)?.[1];
      const video = strings.match(/^"VIDEO_CALL_FROM_USER"\s*=\s*"([^"]+)";$/m)?.[1];
      expect(voice, `${dir} VOICE_CALL_FROM_USER`).toBeDefined();
      expect(video, `${dir} VIDEO_CALL_FROM_USER`).toBeDefined();
      expect(voice, `${dir} VOICE_CALL_FROM_USER placeholder`).toContain('%1$@');
      expect(video, `${dir} VIDEO_CALL_FROM_USER placeholder`).toContain('%1$@');
    }

    const en = readFileSync(resolve(appDir, 'en.lproj/Localizable.strings'), 'utf8');
    expect(en).toContain('"VOICE_CALL_FROM_USER" = "Incoming call from %1$@";');
    expect(en).toContain('"VIDEO_CALL_FROM_USER" = "Incoming video call from %1$@";');
  });
});
