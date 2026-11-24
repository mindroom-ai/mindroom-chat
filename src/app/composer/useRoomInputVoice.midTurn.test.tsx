// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { IContent, MatrixClient, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MID_TURN_MODE_KEY } from '../matrix/protocol/midTurn';
import { DEFAULT_SETTINGS, settingsAtom } from '../preferences/settings';
import type { MidTurnMode } from '../preferences/midTurnModes';
import type { TUploadItem } from '../matrix/state/upload';
import {
  composerUploadItemsAtom,
  pendingVoiceSendDraftAtom,
  roomUploadAtomFamily,
} from './roomInputDrafts';
import type { RoomInputAttachmentAccess } from './roomInputAttachmentAccess';
import type { StartRoomInputSendSessionOptions } from './useRoomInputSendSessionController';
import type { useRoomInputUploadTransport } from './useRoomInputUploadTransport';
import { useRoomInputVoice } from './useRoomInputVoice';
import { liveCaptureAtom } from './capture/liveCapture';
import type { VoiceCaptureSession, VoiceCaptureSnapshot } from './voice/voiceCaptureSession';

vi.mock('../matrix/hooks/useMediaConfig', () => ({ useMediaConfig: () => ({}) }));
vi.mock('./voice/savedVoiceDraft', async () => {
  const { atom } = await import('jotai');
  return {
    useSavedVoiceDraft: () => undefined,
    clearSavedVoiceDraft: async () => undefined,
    voiceDraftRestoresAtom: atom<ReadonlyMap<string, Promise<void> | null>>(new Map()),
  };
});

const ROOM_ID = '!harbour:example.org';
const THREAD_ID = '$thread-1';
const SNAPSHOT: VoiceCaptureSnapshot = {
  phase: 'recording',
  elapsedMs: 1500,
  waveform: [100, 200],
  sampleCount: 2,
  canPause: true,
  errorMessage: undefined,
};

const createSession = (name = 'voice.ogg'): VoiceCaptureSession =>
  ({
    getSnapshot: () => SNAPSHOT,
    subscribe: () => () => undefined,
    canStop: () => true,
    finish: async () => ({
      status: 'captured',
      recording: {
        file: new File(['voice'], name, { type: 'audio/ogg' }),
        duration: 1500,
        waveform: [100, 200],
      },
    }),
    reset: () => undefined,
  }) as unknown as VoiceCaptureSession;

const setup = (defaultMidTurn: MidTurnMode = 'queue') => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function rects(
    this: HTMLElement
  ) {
    return (this.isConnected ? [{}] : []) as unknown as DOMRectList;
  });
  const room = {
    roomId: ROOM_ID,
    name: 'Harbour',
    getMyMembership: () => 'join',
    getMembers: () => [],
    hasEncryptionStateEvent: () => false,
  } as unknown as Room;
  const store = createStore();
  store.set(settingsAtom, { ...DEFAULT_SETTINGS, midTurnSend: defaultMidTurn });
  store.set(liveCaptureAtom, { kind: 'voice', session: createSession() });

  const mx = {
    getUserId: () => '@alice:example.org',
    getRoom: (id: string) => (id === ROOM_ID ? room : null),
  } as unknown as MatrixClient;

  const staged: TUploadItem[] = [];
  const attachments: RoomInputAttachmentAccess = {
    snapshot: () => ({ staged: [...staged], enrolled: [], uploads: [] }),
    append: vi.fn(),
    remove: vi.fn(),
    release: vi.fn(),
    enroll: vi.fn(),
    clearEnrollment: vi.fn(),
    protectPasteItems: () => () => undefined,
    subscribe: () => () => undefined,
  };
  const uploadItem = vi.fn(async (item: TUploadItem) => {
    const mxc = `mxc://example.org/${item.file.name}`;
    store.set(roomUploadAtomFamily(item.file), { mxc });
    return mxc;
  });
  const sendVoiceItem = vi.fn<ReturnType<typeof useRoomInputUploadTransport>['sendVoiceItem']>(
    async () => '$voice-evt'
  );
  const startSendSession = vi.fn<(options?: StartRoomInputSendSessionOptions) => Promise<void>>(
    async () => undefined
  );

  let voice!: ReturnType<typeof useRoomInputVoice>;
  function Harness() {
    voice = useRoomInputVoice({
      mx,
      composer: {
        getContext: () => ({
          roomId: ROOM_ID,
          room,
          threadId: THREAD_ID,
          replyDraft: undefined,
          threadingEnabled: true,
        }),
        snapshotText: () => [],
        resetText: vi.fn(),
        restoreText: vi.fn(),
        clearConsumedReply: vi.fn(),
      },
      attachments,
      transport: {
        createVoiceUploadItems: async (file) => [
          {
            file,
            originalFile: file,
            encInfo: undefined,
            metadata: { markedAsSpoiler: false, voiceMessage: { duration: 1500, waveform: [100] } },
          },
        ],
        uploadItem,
        uploadItemWhileStaged: async (_list, item) => {
          await uploadItem(item);
          return item;
        },
        sendVoiceItem,
      },
      sessions: { hasActiveSendSession: () => false, startSendSession },
    });
    return <>{voice.renderRecorder(() => void voice.sendAtPress(() => undefined, false))}</>;
  }

  render(
    <Provider store={store}>
      <Harness />
    </Provider>
  );
  return { store, staged, getVoice: () => voice, sendVoiceItem, startSendSession };
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useRoomInputVoice mid-turn mode', () => {
  it('sends standalone voice with an explicit pick or the default midTurnSend setting', async () => {
    const { store, getVoice, sendVoiceItem } = setup('queue');
    expect(getVoice().hasVoice).toBe(true);

    await act(async () => {
      await getVoice().sendAtPress(() => undefined, false, 'steer');
    });
    expect(sendVoiceItem.mock.calls[0]?.[4]).toBe('steer');

    act(() => store.set(liveCaptureAtom, { kind: 'voice', session: createSession('second.ogg') }));
    await act(async () => {
      await getVoice().sendAtPress(() => undefined, false);
    });
    expect(sendVoiceItem.mock.calls[1]?.[4]).toBe('queue');
  });

  it('passes the picked mid-turn mode to startSendSession for voice + companion bundles', async () => {
    const { store, staged, getVoice, startSendSession, sendVoiceItem } = setup('auto');
    const companionFile = new File(['photo'], 'pier.png', { type: 'image/png' });
    const companionItem: TUploadItem = {
      file: companionFile,
      originalFile: companionFile,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false },
    };
    staged.push(companionItem);
    store.set(composerUploadItemsAtom(ROOM_ID, undefined), { type: 'PUT', item: [companionItem] });
    store.set(roomUploadAtomFamily(companionFile), { mxc: 'mxc://example.org/pier.png' });

    const textContent = (mode?: MidTurnMode): IContent => ({
      msgtype: 'm.text',
      body: 'Look at this',
      [MID_TURN_MODE_KEY]: mode ?? 'auto',
    });
    await act(async () => {
      await getVoice().sendAtPress(textContent, false, 'steer');
    });

    expect(sendVoiceItem).not.toHaveBeenCalled();
    expect(startSendSession.mock.calls[0]?.[0]).toMatchObject({
      midTurnMode: 'steer',
      textContent: { body: 'Look at this', [MID_TURN_MODE_KEY]: 'steer' },
    });
  });

  it('preserves a parked voice mode on ordinary Send and lets an explicit pick override it', async () => {
    const { store, getVoice, sendVoiceItem } = setup('auto');
    sendVoiceItem
      .mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(new Error('second failure'));

    // First attempt with explicit Queue fails and parks through the real draft controller.
    await act(async () => {
      await getVoice().sendAtPress(() => undefined, false, 'queue');
    });
    expect(store.get(pendingVoiceSendDraftAtom)?.context.midTurnMode).toBe('queue');
    expect(getVoice().hasVoice).toBe(true);

    // Ordinary main Send (no explicit pick, while default setting is Auto) keeps Queue.
    const seenModes: Array<MidTurnMode | undefined> = [];
    await act(async () => {
      await getVoice().sendAtPress((mode) => {
        seenModes.push(mode);
        return undefined;
      }, false);
    });
    expect(seenModes).toEqual(['queue']);
    expect(sendVoiceItem.mock.calls[1]?.[4]).toBe('queue');

    // Explicit menu pick on retry overrides the parked Queue mode with Steer.
    await act(async () => {
      await getVoice().sendAtPress(() => undefined, false, 'steer');
    });
    expect(sendVoiceItem.mock.calls[2]?.[4]).toBe('steer');
    expect(store.get(pendingVoiceSendDraftAtom)).toBeUndefined();
  });
});
