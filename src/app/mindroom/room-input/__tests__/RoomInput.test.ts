import React, { createRef } from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RelationType } from 'matrix-js-sdk';
import { RoomInput } from '../MindroomRoomInput';
import { MATRIX_AUDIO_DETAILS_PROPERTY_NAME } from '../../../../types/matrix/common';
import {
  IReplyDraft,
  roomIdToReplyDraftAtomFamily,
  roomIdToUploadItemsAtomFamily,
  voiceAutoSendPendingAtom,
} from '../../../state/room/roomInputDrafts';
import { VOICE_WAVEFORM_BAR_COUNT } from '../../../utils/audioWaveform';

const ROOM_ID = '!room:example.org';
const OTHER_ROOM_ID = '!other:example.org';
const THIRD_ROOM_ID = '!third:example.org';

const { editorMocks, mxState, voiceRecorderState } = vi.hoisted(() => ({
  editorMocks: {
    resetEditor: vi.fn(),
    resetEditorHistory: vi.fn(),
  },
  mxState: {
    cancelUpload: vi.fn(),
    getUserId: vi.fn(() => '@me:example.org'),
    sendMessage: vi.fn(async () => ({ event_id: '$sent' })),
    uploadContent: vi.fn(async () => ({ content_uri: 'mxc://mindroom/voice' })),
  },
  voiceRecorderState: {
    props: undefined as
      | {
          active?: boolean;
          sendDisabled?: boolean;
          onClose: () => void;
          onRecordingStart?: () => void;
          onSendStopRequest?: () => boolean | void;
          onSendStopFailure?: () => void;
          onSendRecording: (file: File, duration: number, waveform?: number[]) => Promise<void>;
        }
      | undefined,
  },
}));

vi.mock('slate', () => ({
  Editor: {},
  Transforms: {
    insertFragment: vi.fn(),
  },
}));

vi.mock('slate-react', () => ({
  ReactEditor: {
    focus: vi.fn(),
  },
}));

vi.mock('folds', () => {
  const Wrapper = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children);
  const Button = React.forwardRef<
    HTMLButtonElement,
    {
      children?: React.ReactNode;
      onClick?: () => void;
    }
  >(({ children, onClick, ...props }, ref) =>
    React.createElement('button', { ...props, onClick, ref }, children)
  );

  return {
    Box: Wrapper,
    Dialog: Wrapper,
    Icon: () => React.createElement('span'),
    IconButton: Button,
    Icons: new Proxy(
      {},
      {
        get: (_target, key) => String(key),
      }
    ),
    Line: Wrapper,
    Overlay: Wrapper,
    OverlayBackdrop: Wrapper,
    OverlayCenter: Wrapper,
    PopOut: Wrapper,
    Scroll: Wrapper,
    Text: Wrapper,
    config: {
      space: new Proxy(
        {},
        {
          get: () => '0px',
        }
      ),
    },
    toRem: () => '0px',
  };
});

vi.mock('../../../components/editor', () => ({
  AUTOCOMPLETE_PREFIXES: [],
  AutocompletePrefix: {},
  AutocompleteQuery: {},
  CustomEditor: ({
    style,
    top,
    before,
    after,
  }: {
    style?: React.CSSProperties;
    top?: React.ReactNode;
    before?: React.ReactNode;
    after?: React.ReactNode;
  }) => React.createElement('div', { style }, top, before, after),
  EmoticonAutocomplete: () => null,
  RoomMentionAutocomplete: () => null,
  Toolbar: () => null,
  UserMentionAutocomplete: () => null,
  createEmoticonElement: vi.fn(),
  customHtmlEqualsPlainText: () => true,
  getAutocompleteQuery: () => undefined,
  getBeginCommand: () => undefined,
  getMentions: () => ({ users: new Set<string>(), room: false }),
  getPrevWorldRange: () => undefined,
  isEmptyEditor: () => true,
  moveCursor: vi.fn(),
  resetEditor: editorMocks.resetEditor,
  resetEditorHistory: editorMocks.resetEditorHistory,
  toMatrixCustomHTML: () => '',
  toPlainText: () => '',
  trimCommand: (_command: string, value: string) => value,
  trimCustomHtml: (value: string) => value,
}));

vi.mock('../../../components/emoji-board', () => ({
  EmojiBoard: () => null,
  EmojiBoardTab: {},
}));

vi.mock('../../../components/UseStateProvider', () => ({
  UseStateProvider: ({
    children,
    initial,
  }: {
    children: (state: undefined, setState: (value: undefined) => void) => React.ReactNode;
    initial: undefined;
  }) => children(initial, vi.fn()),
}));

vi.mock('../../../components/upload-card', () => ({
  UploadCardRenderer: () => null,
}));

vi.mock('../../../components/upload-board', () => ({
  UploadBoard: ({
    header,
    children,
  }: {
    header?: React.ReactNode;
    children?: React.ReactNode;
  }) => React.createElement('div', null, header, children),
  UploadBoardContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
  UploadBoardHeader: ({ onSend }: { onSend: () => Promise<void> }) =>
    React.createElement('button', { 'aria-label': 'Upload board Send', onClick: onSend }),
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => mxState,
}));

vi.mock('../../../hooks/useTypingStatusUpdater', () => ({
  useTypingStatusUpdater: () => vi.fn(),
}));

vi.mock('../../../hooks/useFilePicker', () => ({
  useFilePicker: () => vi.fn(),
}));

vi.mock('../../../hooks/useFilePasteHandler', () => ({
  useFilePasteHandler: () => vi.fn(),
}));

vi.mock('../../../hooks/useFileDrop', () => ({
  useFileDropZone: () => false,
}));

vi.mock('../../../state/hooks/settings', () => ({
  useSetting: () => [false, vi.fn()],
}));

vi.mock('../../../state/settings', () => ({
  settingsAtom: {},
}));

vi.mock('../../../utils/dom', () => ({
  getImageUrlBlob: vi.fn(),
  loadImageElement: vi.fn(),
  pauseAllMediaElements: vi.fn(),
}));

vi.mock('../../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../../hooks/useImagePackRooms', () => ({
  useImagePackRooms: () => [],
}));

vi.mock('../../../hooks/usePowerLevels', () => ({
  usePowerLevelsContext: () => ({}),
}));

vi.mock('../../../hooks/useRoom', () => ({
  useIsDirectRoom: () => false,
}));

vi.mock('../../../hooks/useMemberPowerTag', () => ({
  useAccessiblePowerTagColors: () => new Map(),
  useGetMemberPowerTag: () => () => undefined,
}));

vi.mock('../../../hooks/useRoomCreators', () => ({
  useRoomCreators: () => [],
}));

vi.mock('../../../hooks/useTheme', () => ({
  useTheme: () => ({ kind: 'light' }),
}));

vi.mock('../../../hooks/useRoomCreatorsTag', () => ({
  useRoomCreatorsTag: () => undefined,
}));

vi.mock('../../../hooks/usePowerLevelTags', () => ({
  usePowerLevelTags: () => [],
}));

vi.mock('../../../hooks/useComposingCheck', () => ({
  useComposingCheck: () => () => false,
}));

vi.mock('../../../hooks/useElementSizeObserver', () => ({
  useElementSizeObserver: vi.fn(),
}));

vi.mock('../../../features/room/CommandAutocomplete', () => ({
  CommandAutocomplete: () => null,
}));

vi.mock('../../../hooks/useCommands', () => ({
  Command: {
    Me: 'me',
    Notice: 'notice',
    Shrug: 'shrug',
    TableFlip: 'tableflip',
    UnFlip: 'unflip',
  },
  SHRUG: 'SHRUG',
  TABLEFLIP: 'TABLEFLIP',
  UNFLIP: 'UNFLIP',
  useCommands: () => ({}),
}));

vi.mock('../RoomInputMindroomExtensions', async () => {
  const { useRoomInputSendSessionController } = await vi.importActual<
    typeof import('../../threads/useRoomInputSendSessionController')
  >('../../threads/useRoomInputSendSessionController');
  const {
    createRoomInputSendSessionState,
    getUploadRelationForSendSession,
    hasMatchingReplyDraftContext,
  } = await vi.importActual<typeof import('../../threads/roomInputSendSession')>(
    '../../threads/roomInputSendSession'
  );

  return {
    getMindroomRoomInputAutocompleteQuery: () => undefined,
    getMindroomRoomInputVoiceSendContext: ({
      roomId,
      room,
      threadId,
      replyDraft,
    }: {
      roomId: string;
      room: unknown;
      threadId: string | undefined;
      replyDraft: IReplyDraft | undefined;
    }) => ({
      roomId,
      room,
      threadId,
      replyDraft,
      signalBridgedRoom: false,
    }),
    getMindroomRoomInputVoiceUploadRelation: (
      context: {
        threadId: string | undefined;
        replyDraft: IReplyDraft | undefined;
      },
      file: File
    ) =>
      getUploadRelationForSendSession(
        {
          threadId: context.threadId,
          replyDraft: context.replyDraft,
          ...createRoomInputSendSessionState({
            files: [file],
            hasText: false,
            threadId: context.threadId,
            replyDraft: context.replyDraft,
          }),
        },
        false
      ),
    hasMatchingMindroomRoomInputVoiceReplyContext: (
      context: {
        roomId: string;
        threadId: string | undefined;
        replyDraft: IReplyDraft | undefined;
      },
      currentReplyDraft: IReplyDraft | undefined
    ) =>
      hasMatchingReplyDraftContext(
        {
          roomId: context.roomId,
          threadId: context.threadId,
          replyDraft: context.replyDraft,
        },
        {
          roomId: context.roomId,
          threadId: context.threadId,
          replyDraft: currentReplyDraft,
        }
      ),
    isMindroomRoomInputAutocompleteQuery: (query?: { prefix?: string }) => query?.prefix === '!',
    MindroomRoomInputAutocomplete: () => null,
    MindroomRoomInputReplyContext: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
    MindroomVoiceRecorderComposer: (props: {
      active?: boolean;
      sendDisabled?: boolean;
      onClose: () => void;
      onRecordingStart?: () => void;
      onSendStopRequest?: () => boolean | void;
      onSendStopFailure?: () => void;
      onSendRecording: (file: File, duration: number, waveform?: number[]) => Promise<void>;
    }) => {
      voiceRecorderState.props = props;
      return React.createElement('div');
    },
    useRoomInputSendSessionController,
  };
});

vi.mock('../../../components/message', () => ({
  ReplyLayout: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../../threads/ThreadIndicator', () => ({
  ThreadIndicator: () => React.createElement('div'),
}));

vi.mock('../../../utils/user-agent', () => ({
  mobileOrTablet: () => false,
}));

vi.stubGlobal('document', {
  body: {
    clientWidth: 1024,
  },
});

const createReplyDraft = (eventId: string, relation?: IReplyDraft['relation']): IReplyDraft => ({
  userId: '@alice:example.org',
  eventId,
  body: `reply:${eventId}`,
  relation,
});

const createRoom = (roomId = ROOM_ID) =>
  ({
    roomId,
    hasEncryptionStateEvent: () => false,
    getMember: () => undefined,
    getMembers: () => [],
  } as never);

const createEditor = () =>
  ({
    children: [],
  } as never);

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
};

const createRoomInputTree = (
  store: ReturnType<typeof createStore>,
  props?: {
    roomId?: string;
    threadId?: string;
    keyedRoomSubtree?: boolean;
  }
) =>
  React.createElement(
    Provider,
    { store },
    React.createElement(RoomInput, {
      key: props?.keyedRoomSubtree ? props?.roomId ?? ROOM_ID : undefined,
      editor: createEditor(),
      fileDropContainerRef: createRef<HTMLElement>(),
      roomId: props?.roomId ?? ROOM_ID,
      room: createRoom(props?.roomId ?? ROOM_ID),
      threadId: props?.threadId,
    })
  );

const renderRoomInput = async (
  store = createStore(),
  props?: {
    roomId?: string;
    threadId?: string;
    keyedRoomSubtree?: boolean;
  }
): Promise<{ renderer: ReactTestRenderer; store: ReturnType<typeof createStore> }> => {
  let renderer!: ReactTestRenderer;

  await act(async () => {
    renderer = create(createRoomInputTree(store, props));
  });

  return { renderer, store };
};

const updateRoomInput = async (
  renderer: ReactTestRenderer,
  store: ReturnType<typeof createStore>,
  props?: {
    roomId?: string;
    threadId?: string;
    keyedRoomSubtree?: boolean;
  }
) => {
  await act(async () => {
    renderer.update(createRoomInputTree(store, props));
  });
};

afterEach(() => {
  voiceRecorderState.props = undefined;
  mxState.cancelUpload.mockReset();
  mxState.getUserId.mockReset();
  mxState.getUserId.mockReturnValue('@me:example.org');
  mxState.sendMessage.mockReset();
  mxState.sendMessage.mockResolvedValue({ event_id: '$sent' });
  mxState.uploadContent.mockReset();
  mxState.uploadContent.mockResolvedValue({ content_uri: 'mxc://mindroom/voice' });
  editorMocks.resetEditor.mockReset();
  editorMocks.resetEditorHistory.mockReset();
});

describe('RoomInput', () => {
  it('extends the composer surface into the bottom safe area', async () => {
    const { renderer } = await renderRoomInput();

    const editorSurface = renderer.root.find(
      (node) =>
        node.type === 'div' &&
        node.props.style?.paddingBottom === 'env(safe-area-inset-bottom, 0px)'
    );

    expect(editorSurface).toBeTruthy();

    renderer.unmount();
  });

  it('keeps same-tick voice sends alive until the upload becomes sendable', async () => {
    const { store, renderer } = await renderRoomInput(createStore(), { threadId: '$thread' });

    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const upload = createDeferred<{ content_uri: string }>();
    mxState.uploadContent.mockReturnValueOnce(upload.promise);
    let sendPromise!: Promise<void>;

    await act(async () => {
      sendPromise = voiceRecorderState.props!.onSendRecording(
        file,
        1200,
        [0, 512, 1024]
      ) as Promise<void>;
      await Promise.resolve();
    });

    const [fileItem] = store.get(roomIdToUploadItemsAtomFamily(ROOM_ID));

    expect(fileItem?.file).toBe(file);
    expect(fileItem?.metadata.voiceMessage?.waveform).toEqual([0, 512, 1024]);
    expect(mxState.uploadContent).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        includeFilename: true,
        progressHandler: expect.any(Function),
      })
    );
    expect(mxState.sendMessage).not.toHaveBeenCalled();

    await act(async () => {
      upload.resolve({ content_uri: 'mxc://mindroom/voice' });
      await sendPromise;
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        body: 'voice.m4a',
        msgtype: 'm.audio',
        url: 'mxc://mindroom/voice',
        [MATRIX_AUDIO_DETAILS_PROPERTY_NAME]: expect.objectContaining({
          duration: 1200,
          waveform: expect.any(Array),
        }),
        'm.relates_to': expect.objectContaining({
          event_id: '$thread',
          rel_type: RelationType.Thread,
        }),
      })
    );
    const sentContent = mxState.sendMessage.mock.calls[0][1] as Record<string, unknown>;
    expect(
      (sentContent[MATRIX_AUDIO_DETAILS_PROPERTY_NAME] as { waveform: number[] }).waveform
    ).toHaveLength(VOICE_WAVEFORM_BAR_COUNT);
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('keeps voice sends targeted to the thread captured when recording starts', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { threadId: '$thread-a' });
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });

    act(() => {
      voiceRecorderState.props?.onRecordingStart?.();
    });
    await updateRoomInput(renderer, store, { threadId: '$thread-b' });
    act(() => {
      voiceRecorderState.props?.onRecordingStart?.();
    });
    await act(async () => {
      await voiceRecorderState.props?.onSendRecording(file, 1200);
    });
    await updateRoomInput(renderer, store, { threadId: '$thread-c' });

    expect(mxState.sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        'm.relates_to': expect.objectContaining({
          event_id: '$thread-a',
          rel_type: RelationType.Thread,
        }),
      })
    );

    renderer.unmount();
  });

  it('does not let a second mic action overwrite an active recording target', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { threadId: '$thread-a' });
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });

    let micButton = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Record voice message'
    );
    act(() => {
      micButton.props.onClick();
    });
    await updateRoomInput(renderer, store, { threadId: '$thread-b' });
    micButton = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Record voice message'
    );

    expect(micButton.props.disabled).toBe(true);
    act(() => {
      micButton.props.onClick();
    });
    await act(async () => {
      await voiceRecorderState.props?.onSendRecording(file, 1200);
    });

    expect(mxState.sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        'm.relates_to': expect.objectContaining({
          event_id: '$thread-a',
          rel_type: RelationType.Thread,
        }),
      })
    );

    renderer.unmount();
  });

  it('keeps overview voice recordings room-level after thread navigation before send', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });

    const micButton = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Record voice message'
    );
    await act(async () => {
      micButton.props.onClick();
    });
    await updateRoomInput(renderer, store, { threadId: '$thread-after-open' });
    await act(async () => {
      await voiceRecorderState.props?.onSendRecording(file, 800);
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage.mock.calls[0][1]).not.toHaveProperty('m.relates_to');

    renderer.unmount();
  });

  it('keeps paused voice recordings on the recording-start thread after navigation', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { threadId: '$thread-a' });
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });

    act(() => {
      voiceRecorderState.props?.onRecordingStart?.();
    });
    await updateRoomInput(renderer, store, { threadId: '$thread-b' });
    await act(async () => {
      await voiceRecorderState.props?.onSendRecording(file, 900);
    });

    expect(mxState.sendMessage.mock.calls[0][1]).toMatchObject({
      'm.relates_to': expect.objectContaining({
        event_id: '$thread-a',
        rel_type: RelationType.Thread,
      }),
    });

    renderer.unmount();
  });

  it('keeps voice sends targeted to the room captured when recording starts', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { roomId: ROOM_ID, threadId: '$thread-a' });
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });

    act(() => {
      voiceRecorderState.props?.onRecordingStart?.();
    });
    await updateRoomInput(renderer, store, {
      roomId: OTHER_ROOM_ID,
      threadId: '$other-thread',
    });
    await act(async () => {
      await voiceRecorderState.props?.onSendRecording(file, 1100);
    });

    expect(mxState.sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        'm.relates_to': expect.objectContaining({
          event_id: '$thread-a',
          rel_type: RelationType.Thread,
        }),
      })
    );

    renderer.unmount();
  });

  it('keeps cross-room voice sends alive after Send and another navigation before upload completes', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { roomId: ROOM_ID, threadId: '$thread-a' });
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const upload = createDeferred<{ content_uri: string }>();
    mxState.uploadContent.mockReturnValueOnce(upload.promise);
    let sendPromise!: Promise<void>;

    act(() => {
      voiceRecorderState.props?.onRecordingStart?.();
    });
    await updateRoomInput(renderer, store, {
      roomId: OTHER_ROOM_ID,
      threadId: '$other-thread',
    });
    await act(async () => {
      sendPromise = voiceRecorderState.props!.onSendRecording(file, 1100) as Promise<void>;
      await Promise.resolve();
    });
    await updateRoomInput(renderer, store, {
      roomId: THIRD_ROOM_ID,
      threadId: '$third-thread',
    });
    await act(async () => {
      upload.resolve({ content_uri: 'mxc://mindroom/voice' });
      await sendPromise;
    });

    expect(mxState.sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        'm.relates_to': expect.objectContaining({
          event_id: '$thread-a',
          rel_type: RelationType.Thread,
        }),
      })
    );

    renderer.unmount();
  });

  it('sends to the captured room and cleans source uploads after a keyed room unmount', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, {
      roomId: ROOM_ID,
      threadId: '$thread-a',
      keyedRoomSubtree: true,
    });
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const upload = createDeferred<{ content_uri: string }>();
    mxState.uploadContent.mockReturnValueOnce(upload.promise);
    let sendPromise!: Promise<void>;

    act(() => {
      voiceRecorderState.props?.onRecordingStart?.();
    });
    await act(async () => {
      sendPromise = voiceRecorderState.props!.onSendRecording(file, 1100) as Promise<void>;
      await Promise.resolve();
    });

    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID)).map((item) => item.file)).toEqual([
      file,
    ]);

    await updateRoomInput(renderer, store, {
      roomId: OTHER_ROOM_ID,
      threadId: '$other-thread',
      keyedRoomSubtree: true,
    });

    expect(store.get(roomIdToUploadItemsAtomFamily(OTHER_ROOM_ID))).toEqual([]);

    await act(async () => {
      upload.resolve({ content_uri: 'mxc://mindroom/voice' });
      await sendPromise;
    });

    expect(mxState.sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        'm.relates_to': expect.objectContaining({
          event_id: '$thread-a',
          rel_type: RelationType.Thread,
        }),
      })
    );
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);
    expect(store.get(roomIdToUploadItemsAtomFamily(OTHER_ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('completes a captured send callback that fires after keyed room unmount', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, {
      roomId: ROOM_ID,
      threadId: '$thread-a',
      keyedRoomSubtree: true,
    });
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const upload = createDeferred<{ content_uri: string }>();
    mxState.uploadContent.mockReturnValueOnce(upload.promise);

    act(() => {
      voiceRecorderState.props?.onRecordingStart?.();
    });
    const sendRecordingAfterUnmount = voiceRecorderState.props!.onSendRecording;

    await updateRoomInput(renderer, store, {
      roomId: OTHER_ROOM_ID,
      threadId: '$other-thread',
      keyedRoomSubtree: true,
    });

    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = sendRecordingAfterUnmount(file, 1100) as Promise<void>;
      await Promise.resolve();
    });

    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID)).map((item) => item.file)).toEqual([
      file,
    ]);

    await act(async () => {
      upload.resolve({ content_uri: 'mxc://mindroom/voice' });
      await sendPromise;
    });

    expect(mxState.sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        'm.relates_to': expect.objectContaining({
          event_id: '$thread-a',
          rel_type: RelationType.Thread,
        }),
      })
    );
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);
    expect(store.get(roomIdToUploadItemsAtomFamily(OTHER_ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('blocks a second compact voice send in another room during the pre-stop pending window', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, {
      roomId: ROOM_ID,
      threadId: '$thread-a',
      keyedRoomSubtree: true,
    });
    const firstFile = new File(['voice-1'], 'voice-1.m4a', { type: 'audio/mp4' });
    const secondFile = new File(['voice-2'], 'voice-2.m4a', { type: 'audio/mp4' });
    const upload = createDeferred<{ content_uri: string }>();
    mxState.uploadContent.mockReturnValueOnce(upload.promise);

    act(() => {
      voiceRecorderState.props?.onRecordingStart?.();
    });
    const sendRecordingAfterStop = voiceRecorderState.props!.onSendRecording;
    act(() => {
      expect(voiceRecorderState.props!.onSendStopRequest?.()).toBe(true);
    });

    expect(store.get(voiceAutoSendPendingAtom)).toBe(true);
    expect(mxState.uploadContent).not.toHaveBeenCalled();

    await updateRoomInput(renderer, store, {
      roomId: OTHER_ROOM_ID,
      threadId: '$other-thread',
      keyedRoomSubtree: true,
    });

    const micButton = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Record voice message'
    );
    expect(micButton.props.disabled).toBe(true);
    expect(voiceRecorderState.props?.sendDisabled).toBe(true);
    act(() => {
      expect(voiceRecorderState.props!.onSendStopRequest?.()).toBe(false);
    });
    await act(async () => {
      await expect(voiceRecorderState.props!.onSendRecording(secondFile, 700)).rejects.toThrow(
        'Another voice message is still sending'
      );
    });

    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = sendRecordingAfterStop(firstFile, 1100) as Promise<void>;
      await Promise.resolve();
    });

    expect(mxState.uploadContent).toHaveBeenCalledTimes(1);
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID)).map((item) => item.file)).toEqual([
      firstFile,
    ]);
    expect(store.get(roomIdToUploadItemsAtomFamily(OTHER_ROOM_ID))).toEqual([]);

    await act(async () => {
      upload.resolve({ content_uri: 'mxc://mindroom/voice' });
      await sendPromise;
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        'm.relates_to': expect.objectContaining({
          event_id: '$thread-a',
          rel_type: RelationType.Thread,
        }),
      })
    );
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('cancels an unsent active recording on keyed room unmount without stale upload state', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, {
      roomId: ROOM_ID,
      threadId: '$thread-a',
      keyedRoomSubtree: true,
    });

    let micButton = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Record voice message'
    );
    act(() => {
      micButton.props.onClick();
    });

    await updateRoomInput(renderer, store, {
      roomId: OTHER_ROOM_ID,
      threadId: '$other-thread',
      keyedRoomSubtree: true,
    });

    micButton = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Record voice message'
    );
    expect(micButton.props.disabled).toBe(false);
    expect(mxState.uploadContent).not.toHaveBeenCalled();
    expect(mxState.sendMessage).not.toHaveBeenCalled();
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);
    expect(store.get(roomIdToUploadItemsAtomFamily(OTHER_ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('does not let regular composer or upload-board Send duplicate a pending compact voice auto-send', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { threadId: '$thread-a' });
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const upload = createDeferred<{ content_uri: string }>();
    mxState.uploadContent.mockReturnValueOnce(upload.promise);
    let sendPromise!: Promise<void>;

    act(() => {
      voiceRecorderState.props?.onRecordingStart?.();
    });
    act(() => {
      expect(voiceRecorderState.props!.onSendStopRequest?.()).toBe(true);
    });
    await act(async () => {
      sendPromise = voiceRecorderState.props!.onSendRecording(file, 1100) as Promise<void>;
      await Promise.resolve();
    });

    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID)).map((item) => item.file)).toEqual([
      file,
    ]);

    const uploadBoardSend = renderer.root.findByProps({ 'aria-label': 'Upload board Send' });
    await act(async () => {
      await uploadBoardSend.props.onClick();
    });

    const buttons = renderer.root.findAll((node) => node.type === 'button');
    const composerSend = buttons[buttons.length - 1];
    await act(async () => {
      await composerSend.props.onClick();
    });

    await act(async () => {
      upload.resolve({ content_uri: 'mxc://mindroom/voice' });
      await sendPromise;
    });

    expect(mxState.uploadContent).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        body: 'voice.m4a',
        msgtype: 'm.audio',
        url: 'mxc://mindroom/voice',
      })
    );

    renderer.unmount();
  });

  it('blocks a second compact voice send while an auto-send is pending', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { threadId: '$thread-a' });
    const firstFile = new File(['voice-1'], 'voice-1.m4a', { type: 'audio/mp4' });
    const secondFile = new File(['voice-2'], 'voice-2.m4a', { type: 'audio/mp4' });
    const upload = createDeferred<{ content_uri: string }>();
    mxState.uploadContent.mockReturnValueOnce(upload.promise);
    let sendPromise!: Promise<void>;

    await act(async () => {
      sendPromise = voiceRecorderState.props!.onSendRecording(firstFile, 1100) as Promise<void>;
      await Promise.resolve();
    });

    const micButton = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Record voice message'
    );
    expect(micButton.props.disabled).toBe(true);

    act(() => {
      micButton.props.onClick();
    });
    await act(async () => {
      await expect(voiceRecorderState.props!.onSendRecording(secondFile, 700)).rejects.toThrow(
        'Another voice message is still sending'
      );
    });

    expect(mxState.uploadContent).toHaveBeenCalledTimes(1);
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID)).map((item) => item.file)).toEqual([
      firstFile,
    ]);
    expect(mxState.sendMessage).not.toHaveBeenCalled();

    await act(async () => {
      upload.resolve({ content_uri: 'mxc://mindroom/voice' });
      await sendPromise;
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('does not clear a newer reply draft when a deferred voice send finishes', async () => {
    const store = createStore();
    const originalReplyDraft = createReplyDraft('$reply-a');
    const newerReplyDraft = createReplyDraft('$reply-b', {
      event_id: '$thread-b',
      rel_type: RelationType.Thread,
    });

    store.set(roomIdToReplyDraftAtomFamily(ROOM_ID), originalReplyDraft);
    const { renderer } = await renderRoomInput(store);

    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const upload = createDeferred<{ content_uri: string }>();
    mxState.uploadContent.mockReturnValueOnce(upload.promise);
    let sendPromise!: Promise<void>;

    await act(async () => {
      sendPromise = voiceRecorderState.props!.onSendRecording(file, 900) as Promise<void>;
      await Promise.resolve();
    });

    await act(async () => {
      store.set(roomIdToReplyDraftAtomFamily(ROOM_ID), newerReplyDraft);
    });

    await act(async () => {
      upload.resolve({ content_uri: 'mxc://mindroom/voice' });
      await sendPromise;
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(store.get(roomIdToReplyDraftAtomFamily(ROOM_ID))).toEqual(newerReplyDraft);

    renderer.unmount();
  });
});
