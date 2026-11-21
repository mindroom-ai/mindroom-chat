import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  beginVoiceRecording,
  clearVoiceRecordings,
  recoverVoiceRecording,
  releaseVoiceRecording,
} from './voiceRecordingJournal';

const USER = '@voice-journal:example.org';
const OTHER = '@voice-other:example.org';

beforeEach(() => {
  const held = new Set<string>();
  vi.stubGlobal('navigator', {
    locks: {
      request: async (name: string, options: LockOptions, callback: LockGrantedCallback) => {
        expect(options.ifAvailable).toBe(true);
        if (held.has(name)) return callback(null);
        held.add(name);
        try {
          return await callback({ name, mode: 'exclusive' });
        } finally {
          held.delete(name);
        }
      },
    },
  });
});

afterEach(async () => {
  await clearVoiceRecordings(USER);
  await clearVoiceRecordings(OTHER);
  vi.unstubAllGlobals();
});

const begin = (user = USER) => beginVoiceRecording(user, Date.now(), 'audio/ogg')!;

it('writes chunks in sequence despite out-of-order byte conversion, using the first chunk MIME', async () => {
  const recording = begin();
  const first = new Blob(['first'], { type: 'audio/webm' });
  const bytes = await first.arrayBuffer();
  let resolveFirst!: (value: ArrayBuffer) => void;
  vi.spyOn(first, 'arrayBuffer').mockReturnValue(
    new Promise((resolve) => {
      resolveFirst = resolve;
    })
  );
  const a = recording.append(0, first, 1_000);
  const b = recording.append(1, new Blob(['second'], { type: 'audio/mp4' }), 2_000);
  resolveFirst(bytes);
  await Promise.all([a, b]);
  releaseVoiceRecording(recording.id);

  const offer = vi.fn((_draft: { file: File; duration: number }) => true);
  await recoverVoiceRecording(USER, undefined, offer);
  const [draft] = offer.mock.calls[0]!;
  expect(await draft.file.text()).toBe('firstsecond');
  expect(draft.file.type).toBe('audio/webm');
  expect(draft.duration).toBe(2_000);
});

it('offers only unlocked records, and releases one the draft slot cannot take', async () => {
  const active = begin();
  const orphan = begin();
  await Promise.all([
    active.append(0, new Blob(['active']), 1_000),
    orphan.append(0, new Blob(['orphan']), 1_000),
  ]);
  releaseVoiceRecording(orphan.id);
  const busy = vi.fn(() => false);
  await recoverVoiceRecording(USER, undefined, busy);
  expect(busy).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ recordingId: orphan.id }));

  const free = vi.fn(() => true);
  await recoverVoiceRecording(USER, undefined, free);
  expect(free).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ recordingId: orphan.id }));
  const again = vi.fn(() => true);
  await recoverVoiceRecording(USER, undefined, again);
  expect(again).not.toHaveBeenCalled();
});

it('sign-out removes only this account’s records, including a recording still starting', async () => {
  const active = begin();
  const other = begin(OTHER);
  const writing = active.append(0, new Blob(['active']), 1_000);
  await other.append(0, new Blob(['other']), 1_000);
  const clearing = clearVoiceRecordings(USER);
  await Promise.all([writing, clearing]);
  releaseVoiceRecording(active.id);
  releaseVoiceRecording(other.id);
  const offer = vi.fn(() => true);
  await recoverVoiceRecording(USER, undefined, offer);
  expect(offer).not.toHaveBeenCalled();
  await recoverVoiceRecording(OTHER, undefined, offer);
  expect(offer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ recordingId: other.id }));
});

it('does not journal on browsers without Web Locks', () => {
  vi.stubGlobal('navigator', {});
  expect(beginVoiceRecording(USER, Date.now(), 'audio/ogg')).toBeUndefined();
});
