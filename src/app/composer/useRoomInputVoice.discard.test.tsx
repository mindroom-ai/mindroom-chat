// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { afterEach, expect, it, vi } from 'vitest';
import { composersHoldUnsavedWork } from './roomInputDrafts';
import { useRoomInputVoice } from './useRoomInputVoice';
import { liveCaptureAtom } from './capture/liveCapture';
import { createSessionId } from '../matrix/session/sessions';
import { dictationRestoresAtom } from './dictation/startLiveDictation';
import { voiceDraftRestoresAtom } from './voice/savedVoiceDraft';
import type { VoiceCaptureSession, VoiceCaptureSnapshot } from './voice/voiceCaptureSession';

// A composer's own Discard, through the real recorder and question: confirmed, the recording ends
// at once, and the composer keeps the question up until the disk copy is gone too.

vi.unmock('../ui/glass/GlassPrimitives');
vi.mock('../matrix/hooks/useMediaConfig', () => ({ useMediaConfig: () => ({}) }));

const ROOM_ID = '!example:example.org';
const room = { roomId: ROOM_ID, name: 'Example room' } as unknown as Room;
const HOMESERVER = 'https://example.org';
const mx = {
  getUserId: () => '@me:example.org',
  getHomeserverUrl: () => HOMESERVER,
  getRoom: () => room,
} as unknown as MatrixClient;

function Composer() {
  const voice = useRoomInputVoice({
    mx,
    composer: {
      getContext: () => ({
        roomId: ROOM_ID,
        room,
        threadId: undefined,
        replyDraft: undefined,
        threadingEnabled: true,
      }),
      snapshotText: () => [],
      resetText: vi.fn(),
      restoreText: vi.fn(),
      clearConsumedReply: vi.fn(),
    },
    attachments: {} as never,
    transport: {} as never,
    sessions: {} as never,
    stagedList: {} as never,
  });
  return (
    <>
      {voice.renderRecorder(vi.fn())}
      {voice.microphone}
    </>
  );
}

const question = () => screen.queryByRole('dialog', { name: 'Discard voice recording?' });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('keeps its Discard question up, busy, until the disk copy is gone', async () => {
  // Treats attached elements as laid out, so the real focus trap finds its controls in jsdom.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function rects(
    this: HTMLElement
  ) {
    return (this.isConnected ? [{}] : []) as unknown as DOMRectList;
  });
  const snapshot: VoiceCaptureSnapshot = {
    phase: 'recording',
    elapsedMs: 32_000,
    waveform: [0, 512, 1024],
    sampleCount: 3,
    canPause: true,
    errorMessage: undefined,
  };
  let removed!: () => void;
  const discard = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        removed = resolve;
      })
  );
  const store = createStore();
  store.set(liveCaptureAtom, {
    kind: 'voice',
    session: {
      getSnapshot: () => snapshot,
      subscribe: () => () => undefined,
      canStop: () => true,
      discard,
    } as unknown as VoiceCaptureSession,
  });
  render(
    <Provider store={store}>
      <Composer />
    </Provider>
  );

  fireEvent.click(screen.getByRole('button', { name: 'Discard voice recording' }));
  await waitFor(() => expect(question()?.contains(document.activeElement)).toBe(true));
  fireEvent.click(within(question()!).getByRole('button', { name: 'Discard' }));
  expect(discard).toHaveBeenCalledOnce();
  expect(store.get(liveCaptureAtom)).toBeUndefined();

  // The recording is gone from the account; its disk copy is not yet. A reload would offer it
  // again, so the question stays and the app still holds unsaved work.
  await act(async () => undefined);
  expect(question()).not.toBeNull();
  expect(composersHoldUnsavedWork(store)).toBe(true);

  await act(async () => removed());
  expect(question()).toBeNull();
  expect(screen.queryByRole('button', { name: 'Discard voice recording' })).toBeNull();
  expect(composersHoldUnsavedWork(store)).toBe(false);
});

it('keeps voice microphone disabled while dictationRestoresAtom is still in flight', () => {
  const store = createStore();
  const userId = '@me:example.org';
  const sessionId = createSessionId(HOMESERVER, userId);
  store.set(voiceDraftRestoresAtom, new Map([[userId, null]]));
  store.set(dictationRestoresAtom, new Map([[sessionId, new Promise<void>(() => undefined)]]));

  render(
    <Provider store={store}>
      <Composer />
    </Provider>
  );

  const mic = screen.getByRole<HTMLButtonElement>('button', { name: 'Record voice message' });
  expect(mic.disabled).toBe(true);

  act(() => {
    store.set(dictationRestoresAtom, new Map([[sessionId, null]]));
  });
  expect(mic.disabled).toBe(false);
});
