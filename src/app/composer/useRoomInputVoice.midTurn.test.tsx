// @vitest-environment jsdom
import { forwardRef, useImperativeHandle } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { IContent, MatrixClient, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MID_TURN_MODE_KEY } from '../matrix/protocol/midTurn';
import { DEFAULT_SETTINGS, settingsAtom } from '../preferences/settings';
import type { MidTurnMode } from '../preferences/midTurnModes';
import type { TUploadItem } from '../matrix/state/upload';
import type { StartRoomInputSendSessionOptions } from './useRoomInputSendSessionController';
import type { useRoomInputUploadTransport } from './useRoomInputUploadTransport';
import {
  composerUploadItemsAtom,
  pendingVoiceSendDraftAtom,
  roomUploadAtomFamily,
  type PendingVoiceSendContext,
} from './roomInputDrafts';
import type { RoomInputAttachmentAccess } from './roomInputAttachmentAccess';
import { useRoomInputVoice } from './useRoomInputVoice';
import { liveVoiceRecordingAtom } from './voice/liveVoiceRecording';
import type { VoiceCaptureSession } from './voice/voiceCaptureSession';
import type { VoiceRecorderComposerHandle } from './voice/VoiceRecorderDialog';

vi.mock('../matrix/hooks/useMediaConfig', () => ({ useMediaConfig: () => ({}) }));
vi.mock('./voice/savedVoiceDraft', () => ({
  useSavedVoiceDraft: () => undefined,
  voiceDraftRestoresAtom: {
    init: new Map(),
    read: () => new Map(),
  },
}));

type MockRecorderProps = {
  onSendStopRequest?: () => boolean | void;
  onSendStopFailure?: () => void;
  onRetryRequest: () => void;
  onSendRecording: (
    file: File,
    duration: number,
    waveform: number[] | undefined,
    context: PendingVoiceSendContext
  ) => Promise<void> | void;
  getSendContext: () => PendingVoiceSendContext;
};

const recorderState = vi.hoisted(() => ({
  props: undefined as MockRecorderProps | undefined,
  voiceFile: new File(['voice-bytes'], 'voice.ogg', { type: 'audio/ogg' }),
  store: undefined as ReturnType<typeof createStore> | undefined,
}));

vi.mock('./voice/VoiceRecorderDialog', () => ({
  VoiceRecorderComposer: forwardRef<VoiceRecorderComposerHandle, MockRecorderProps>(
    (props, ref) => {
      recorderState.props = props;
      useImperativeHandle(ref, () => ({
        phase: () => 'recording',
        send: async () => {
          if (props.onSendStopRequest?.() === false) return false;
          const parked = recorderState.store?.get(pendingVoiceSendDraftAtom);
          const context = parked ? parked.context : props.getSendContext();
          try {
            await props.onSendRecording(recorderState.voiceFile, 1500, [100, 200], context);
            recorderState.store?.set(pendingVoiceSendDraftAtom, undefined);
            return true;
          } catch (error) {
            recorderState.store?.set(pendingVoiceSendDraftAtom, {
              file: recorderState.voiceFile,
              duration: 1500,
              waveform: [100, 200],
              context,
              errorMessage: error instanceof Error ? error.message : 'send failed',
            });
            props.onSendStopFailure?.();
            return false;
          }
        },
      }));
      return null;
    }
  ),
}));

const ROOM_ID = '!harbour:example.org';
const THREAD_ID = '$thread-1';

const createRoom = (): Room =>
  ({
    roomId: ROOM_ID,
    name: 'Harbour',
    getMyMembership: () => 'join',
    getMembers: () => [],
    hasEncryptionStateEvent: () => false,
  } as unknown as Room);

const createHarness = (defaultMidTurn: MidTurnMode = 'queue') => {
  const room = createRoom();
  const store = createStore();
  recorderState.store = store;
  store.set(settingsAtom, { ...DEFAULT_SETTINGS, midTurnSend: defaultMidTurn });
  store.set(liveVoiceRecordingAtom, {} as VoiceCaptureSession);

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

  const createVoiceUploadItems = vi.fn(
    async (file: File): Promise<TUploadItem[]> => [
      {
        file,
        originalFile: file,
        encInfo: undefined,
        metadata: {
          markedAsSpoiler: false,
          voiceMessage: { duration: 1500, waveform: [100, 200] },
        },
      },
    ]
  );
  const uploadItem = vi.fn(async (item: TUploadItem) => {
    const mxc = `mxc://example.org/${item.file.name}`;
    store.set(roomUploadAtomFamily(item.file), { mxc });
    return mxc;
  });
  const uploadItemWhileStaged = vi.fn(async (_listAtom: unknown, item: TUploadItem) => {
    await uploadItem(item);
    return item;
  });
  const sendVoiceItem = vi.fn<ReturnType<typeof useRoomInputUploadTransport>['sendVoiceItem']>(
    async () => '$voice-evt'
  );
  const startSendSession = vi.fn<(options?: StartRoomInputSendSessionOptions) => Promise<void>>(
    async () => undefined
  );
  const onRetryRequest = vi.fn<(mode?: MidTurnMode) => void>();

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
      transport: { createVoiceUploadItems, uploadItem, uploadItemWhileStaged, sendVoiceItem },
      sessions: { hasActiveSendSession: () => false, startSendSession },
    });
    return <>{voice.renderRecorder(onRetryRequest)}</>;
  }

  const view = render(
    <Provider store={store}>
      <Harness />
    </Provider>
  );

  return {
    store,
    staged,
    view,
    getVoice: () => voice,
    sendVoiceItem,
    startSendSession,
    onRetryRequest,
  };
};

afterEach(() => {
  cleanup();
  recorderState.props = undefined;
  recorderState.store = undefined;
  vi.clearAllMocks();
});

describe('useRoomInputVoice mid-turn mode', () => {
  it('sends standalone voice with explicit menu mode and default midTurnSend', async () => {
    const { getVoice, sendVoiceItem } = createHarness('queue');
    expect(getVoice().hasVoice).toBe(true);

    await act(async () => {
      await getVoice().sendAtPress(() => undefined, false, 'steer');
    });
    expect(sendVoiceItem).toHaveBeenCalledTimes(1);
    expect(sendVoiceItem.mock.calls[0]![4]).toBe('steer');

    sendVoiceItem.mockClear();
    await act(async () => {
      await getVoice().sendAtPress(() => undefined, false);
    });
    expect(sendVoiceItem).toHaveBeenCalledTimes(1);
    expect(sendVoiceItem.mock.calls[0]![4]).toBe('queue');
  });

  it('passes the picked mid-turn mode to startSendSession for voice + companion bundles', async () => {
    const { store, staged, getVoice, startSendSession, sendVoiceItem } = createHarness('auto');
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

    const textContent: IContent = {
      msgtype: 'm.text',
      body: 'Look at this',
      [MID_TURN_MODE_KEY]: 'steer',
    };
    await act(async () => {
      await getVoice().sendAtPress(() => textContent, false, 'steer');
    });

    expect(sendVoiceItem).not.toHaveBeenCalled();
    expect(startSendSession).toHaveBeenCalledTimes(1);
    const sessionCall = startSendSession.mock.calls[0]?.[0];
    expect(sessionCall?.midTurnMode).toBe('steer');
    expect(sessionCall?.textContent).toEqual(textContent);
    expect(sessionCall?.batch?.fileItems).toHaveLength(2);
  });

  it('attaches the current midTurnSend setting when sent directly via onSendRecording without sendAtPress', async () => {
    const { sendVoiceItem } = createHarness('queue');
    const context = recorderState.props!.getSendContext();

    await act(async () => {
      await recorderState.props!.onSendRecording(recorderState.voiceFile, 1500, [100], context);
    });

    expect(sendVoiceItem).toHaveBeenCalledTimes(1);
    expect(sendVoiceItem.mock.calls[0]![4]).toBe('queue');
  });

  it('preserves midTurnMode across a failed voice send and retry', async () => {
    const { store, getVoice, sendVoiceItem, onRetryRequest } = createHarness('auto');
    sendVoiceItem.mockRejectedValueOnce(new Error('network blip'));

    await act(async () => {
      await getVoice().sendAtPress(() => undefined, false, 'steer');
    });
    // Live recording ended and parked as a pending draft carrying the picked mode.
    act(() => {
      store.set(liveVoiceRecordingAtom, undefined);
    });
    expect(store.get(pendingVoiceSendDraftAtom)?.context.midTurnMode).toBe('steer');
    expect(getVoice().hasVoice).toBe(true);

    // Failure dialog Retry passes the parked mode back to the composer.
    recorderState.props!.onRetryRequest();
    expect(onRetryRequest).toHaveBeenCalledWith('steer');

    // Retrying with that mode sends the voice item with steer.
    await act(async () => {
      await getVoice().sendAtPress(() => undefined, false, 'steer');
    });
    expect(sendVoiceItem).toHaveBeenCalledTimes(2);
    expect(sendVoiceItem.mock.calls[1]![4]).toBe('steer');
  });
});
