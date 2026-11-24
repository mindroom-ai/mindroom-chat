import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { createStore } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { pendingVoiceSendDraftAtom, type PendingVoiceSendContext } from '../roomInputDrafts';
import {
  discardLiveVoiceRecording,
  endVoiceRecordingsOfAccount,
  liveVoiceRecordingAtom,
  parkLiveVoiceRecording,
} from './liveVoiceRecording';
import type { DesktopBridge, DesktopShellEvent } from '../../lib/desktopBridge';
import { watchDesktopWindowHidden } from '../../native/desktopShellLifecycle';
import { startLiveVoiceRecording } from './startLiveVoiceRecording';
import { clearVoiceRecordings, recoverVoiceRecording } from './voiceRecordingJournal';

// The account's live recording against the real journal: what each way of ending it leaves on
// disk. An account switch keeps the record for that account; sign-out and Discard delete it.
const USER = '@voice-live:example.org';
const ROOM_ID = '!example:example.org';
const context: PendingVoiceSendContext = {
  ownerSessionId: USER,
  roomId: ROOM_ID,
  room: { roomId: ROOM_ID, name: 'Example room' } as unknown as Room,
  threadId: undefined,
  replyDraft: undefined,
  threadingEnabled: true,
  signalBridgedRoom: false,
};

type Listener = (event: Event) => void;
class MockMediaRecorder {
  static latest: MockMediaRecorder;

  state: RecordingState = 'inactive';

  mimeType = 'audio/ogg;codecs=opus';

  private listeners = new Map<string, Listener>();

  constructor() {
    MockMediaRecorder.latest = this;
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: string) {
    this.listeners.delete(type);
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
  }

  emit(audio: string) {
    this.listeners.get('dataavailable')?.({
      data: new Blob([audio], { type: this.mimeType }),
    } as BlobEvent);
  }

  /** The recorder ends by itself, as when the browser takes the microphone away. */
  stopOnItsOwn() {
    this.state = 'inactive';
    this.listeners.get('stop')?.(new Event('stop'));
  }
}

const track = { stop: vi.fn() };

beforeEach(() => {
  const held = new Set<string>();
  track.stop.mockClear();
  vi.stubGlobal('window', { isSecureContext: true });
  vi.stubGlobal('MediaRecorder', MockMediaRecorder);
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) },
    locks: {
      request: async (name: string, _options: LockOptions, callback: LockGrantedCallback) => {
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
  vi.unstubAllGlobals();
});

/** What the journal holds on disk, whoever holds its locks. */
const stored = async () => {
  const db = await openDB('mindroom-voice-journal');
  try {
    return { recordings: await db.count('recordings'), chunks: await db.count('chunks') };
  } finally {
    db.close();
  }
};

/** A live recording with one chunk on disk. */
const record = async () => {
  const store = createStore();
  expect(await startLiveVoiceRecording(store, context)).toBe(true);
  MockMediaRecorder.latest.emit('voice');
  await vi.waitFor(async () => expect(await stored()).toEqual({ recordings: 1, chunks: 1 }));
  return store;
};

/** The account's recordings another page load would get: on disk, and not locked by this tab. */
const recoverable = async (): Promise<File[]> => {
  const files: File[] = [];
  // Refused, as with the draft slot taken: the record stays, unlocked.
  await recoverVoiceRecording(USER, undefined, ({ file }) => {
    files.push(file);
    return false;
  });
  return files;
};

it('keeps the recording on disk, unlocked, through an account switch; sign-out deletes it', async () => {
  const store = await record();

  endVoiceRecordingsOfAccount(store);
  expect(track.stop).toHaveBeenCalledOnce();
  expect(store.get(liveVoiceRecordingAtom)).toBeUndefined();
  expect(store.get(pendingVoiceSendDraftAtom)).toBeUndefined();
  // The stopped recorder hands over what it still held, then says it stopped.
  MockMediaRecorder.latest.emit(' to its end');
  MockMediaRecorder.latest.stopOnItsOwn();
  await vi.waitFor(async () => expect(await recoverable()).toHaveLength(1));
  expect(await (await recoverable())[0]!.text()).toBe('voice to its end');

  // What signing out runs (account/lifecycle/sessionCleanup.ts).
  await clearVoiceRecordings(USER);
  expect(await stored()).toEqual({ recordings: 0, chunks: 0 });
});

it('deletes the disk copy on a confirmed Discard', async () => {
  const store = await record();
  void discardLiveVoiceRecording(store);
  expect(track.stop).toHaveBeenCalledOnce();
  await vi.waitFor(async () => expect(await stored()).toEqual({ recordings: 0, chunks: 0 }));
});

it('parks a recording that stops on its own, on disk and locked until it is sent', async () => {
  const store = await record();
  MockMediaRecorder.latest.stopOnItsOwn();
  expect(store.get(liveVoiceRecordingAtom)).toBeUndefined();
  const parked = store.get(pendingVoiceSendDraftAtom);
  expect(parked).toMatchObject({ recovered: true, context });
  expect(await parked?.file.text()).toBe('voice');
  // This tab holds it: no other page load offers it a second time.
  expect(await stored()).toEqual({ recordings: 1, chunks: 1 });
  expect(await recoverable()).toHaveLength(0);
});

it('leaves no recording behind when one still asking for the microphone is parked', () => {
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: () => new Promise(() => undefined) },
  });
  const store = createStore();
  void startLiveVoiceRecording(store, context);
  expect(store.get(liveVoiceRecordingAtom)).toBeDefined();

  // The sign-in pages park it (Add account): no composer is left a capsule of nothing.
  parkLiveVoiceRecording(store);
  expect(store.get(liveVoiceRecordingAtom)).toBeUndefined();
});

it('parks the live voice recording when the desktop shell emits window-hidden', async () => {
  let shellListener: ((event: DesktopShellEvent) => void) | undefined;
  const bridge: DesktopBridge = {
    onShellEvent: (listener) => {
      shellListener = listener;
      return () => {
        shellListener = undefined;
      };
    },
    setMediaSession: () => ({ ok: true, value: undefined }),
    startSignIn: async () => ({ ok: true, value: '' }),
    openSignIn: async () => ({ ok: true, value: undefined }),
    showMainWindow: async () => ({ ok: true, value: undefined }),
    setBadge: () => undefined,
    isWindowFocused: () => true,
    screenShare: false,
    appUrl: {
      addListener: async () => undefined,
      getLaunchUrl: async () => undefined,
    },
  };
  Object.defineProperty(window, 'mindroomDesktop', { configurable: true, value: bridge });

  const store = createStore();
  const stop = watchDesktopWindowHidden(() => parkLiveVoiceRecording(store));
  try {
    expect(await startLiveVoiceRecording(store, context)).toBe(true);
    MockMediaRecorder.latest.emit('desktop-hidden-audio');
    expect(store.get(liveVoiceRecordingAtom)).toBeDefined();

    shellListener?.({ type: 'window-hidden' });
    MockMediaRecorder.latest.stopOnItsOwn();

    expect(track.stop).toHaveBeenCalled();
    expect(store.get(liveVoiceRecordingAtom)).toBeUndefined();
    const parked = store.get(pendingVoiceSendDraftAtom);
    expect(parked).toMatchObject({ recovered: true, context });
    expect(await parked?.file.text()).toBe('desktop-hidden-audio');
  } finally {
    stop();
    Reflect.deleteProperty(window, 'mindroomDesktop');
  }
});
