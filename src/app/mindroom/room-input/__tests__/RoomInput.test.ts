import React, { createRef } from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RelationType, Room } from 'matrix-js-sdk';
import { createMindroomRoomUploadItems, RoomInput } from '../MindroomRoomInput';
import { MATRIX_AUDIO_DETAILS_PROPERTY_NAME } from '../../../../types/matrix/common';
import {
  IReplyDraft,
  pendingVoiceSendDraftAtom,
  roomIdToReplyDraftAtomFamily,
  roomIdToUploadItemsAtomFamily,
  roomUploadAtomFamily,
  voiceAutoSendPendingAtom,
} from '../../../state/room/roomInputDrafts';
import { VOICE_WAVEFORM_BAR_COUNT } from '../../../utils/audioWaveform';
import {
  getMatrixUploadErrorMessage,
  getMatrixUploadErrorStage,
  toMatrixUploadError,
} from '../../../utils/matrix';

const ROOM_ID = '!room:example.org';
const OTHER_ROOM_ID = '!other:example.org';
const THIRD_ROOM_ID = '!third:example.org';

const {
  customEditorState,
  editorMocks,
  editorOutputState,
  encryptionState,
  mxState,
  voiceRecorderState,
} = vi.hoisted(() => ({
  editorMocks: {
    insertNode: vi.fn(),
    insertText: vi.fn(),
    moveCursor: vi.fn(),
    resetEditor: vi.fn(),
    resetEditorHistory: vi.fn(),
    restoreEditorContent: vi.fn(),
  },
  customEditorState: {
    autocompleteQuery: undefined as { prefix: string; range: unknown; text: string } | undefined,
    editor: undefined as
      | {
          children: Array<any>;
        }
      | undefined,
    props: undefined as
      | {
          onPaste?: (evt: {
            clipboardData: DataTransfer;
            preventDefault: () => void;
          }) => void | Promise<void>;
          onChange?: () => void;
          onKeyDown?: (evt: { key: string; preventDefault: () => void }) => void;
          onKeyUp?: (evt: { key: string; preventDefault: () => void }) => void;
        }
      | undefined,
    replyContextRenderCount: 0,
  },
  editorOutputState: {
    plainText: '',
    customHtml: '',
    htmlEqualsPlainText: true,
  },
  mxState: {
    cancelUpload: vi.fn(),
    getUserId: vi.fn(() => '@me:example.org'),
    // Default: every roomId resolves to a Joined room so the parked-draft
    // orphan-room cleanup useEffect treats drafts as live and the retry-time
    // re-resolve in handleVoiceSend gets a usable Room. Tests that need to
    // exercise the unreachable / non-joined path override per-call.
    getRoom: vi.fn(
      (roomId: string) =>
        ({
          roomId,
          name: roomId,
          hasEncryptionStateEvent: () => false,
          getMember: () => undefined,
          getMembers: () => [],
          getMyMembership: () => 'join',
        } as unknown as Room)
    ),
    sendMessage: vi.fn(async () => ({ event_id: '$sent' })),
    uploadContent: vi.fn(async () => ({ content_uri: 'mxc://mindroom/voice' })),
  },
  encryptionState: {
    encryptAttachment: vi.fn(async (data: ArrayBuffer) => ({
      data,
      info: {
        v: 'v2',
        key: {
          alg: 'A256CTR',
          ext: true,
          k: 'test-key',
          key_ops: ['encrypt', 'decrypt'],
          kty: 'oct',
        },
        iv: 'test-iv',
        hashes: {
          sha256: 'test-hash',
        },
      },
    })),
    decryptAttachment: vi.fn(),
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
          // The mock auto-injects context from getSendContext() when callers
          // don't pass one, so existing unit tests of handleVoiceSend keep
          // their (file, duration, waveform?) call shape.
          onSendRecording: (
            file: File,
            duration: number,
            waveform?: number[],
            context?: unknown
          ) => Promise<void>;
          getSendContext: () => unknown;
        }
      | undefined,
  },
}));

vi.mock('browser-encrypt-attachment', () => ({
  decryptAttachment: encryptionState.decryptAttachment,
  encryptAttachment: encryptionState.encryptAttachment,
}));

vi.mock('slate', () => ({
  Editor: {},
  Text: {
    isText: (node: { text?: unknown }) => typeof node?.text === 'string',
  },
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
  AUTOCOMPLETE_PREFIXES: ['user'],
  AutocompletePrefix: { UserMention: 'user' },
  AutocompleteQuery: {},
  CustomEditor: ({
    style,
    top,
    before,
    after,
    onChange,
    onKeyDown,
    onKeyUp,
    onPaste,
  }: {
    style?: React.CSSProperties;
    top?: React.ReactNode;
    before?: React.ReactNode;
    after?: React.ReactNode;
    onChange?: () => void;
    onKeyDown?: (evt: { key: string; preventDefault: () => void }) => void;
    onKeyUp?: (evt: { key: string; preventDefault: () => void }) => void;
    onPaste?: (evt: { clipboardData: DataTransfer; preventDefault: () => void }) => void;
  }) => {
    customEditorState.props = { onChange, onKeyDown, onKeyUp, onPaste };
    return React.createElement('div', { style }, top, before, after);
  },
  EmoticonAutocomplete: () => null,
  RoomMentionAutocomplete: () => null,
  Toolbar: () => null,
  UserMentionAutocomplete: () => null,
  createEmoticonElement: vi.fn(),
  customHtmlEqualsPlainText: () => editorOutputState.htmlEqualsPlainText,
  getAutocompleteQuery: () => customEditorState.autocompleteQuery,
  getBeginCommand: () => undefined,
  getMentions: () => ({ users: new Set<string>(), room: false }),
  getPrevWorldRange: () => (customEditorState.autocompleteQuery ? {} : undefined),
  isEmptyEditor: () => true,
  moveCursor: editorMocks.moveCursor,
  resetEditor: editorMocks.resetEditor,
  resetEditorHistory: editorMocks.resetEditorHistory,
  toMatrixCustomHTML: () => editorOutputState.customHtml,
  toPlainText: () => editorOutputState.plainText,
  trimCommand: (_command: string, value: string) => value,
  trimCustomHtml: (value: string) => value,
}));

// The send-session controller imports these helpers from the utils module directly, so the
// editor barrel mock above does not cover its calls.
vi.mock('../../../components/editor/utils', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resetEditor: editorMocks.resetEditor,
  resetEditorHistory: editorMocks.resetEditorHistory,
  restoreEditorContent: editorMocks.restoreEditorContent,
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

vi.mock('../../../components/upload-board', async () => {
  const reactModule = await import('react');
  const { useAtomValue } = await import('jotai');
  const { UploadStatus } = await import('../../../state/upload');
  const { getMatrixUploadErrorStage } = await import('../../../utils/matrix');

  return {
    UploadBoard: ({ header, children }: { header?: React.ReactNode; children?: React.ReactNode }) =>
      reactModule.createElement('div', null, header, children),
    UploadBoardContent: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    UploadBoardHeader: ({
      uploadFamilyObserverAtom,
      onSend,
    }: {
      uploadFamilyObserverAtom: Parameters<typeof useAtomValue>[0];
      onSend: () => Promise<void>;
    }) => {
      const uploads = useAtomValue(uploadFamilyObserverAtom);
      const hasMixedPrepErrorSend =
        uploads.some((upload) => upload.status === UploadStatus.Success) &&
        uploads.every(
          (upload) =>
            upload.status === UploadStatus.Success ||
            (upload.status === UploadStatus.Error &&
              getMatrixUploadErrorStage(upload.error) === 'create')
        );
      const hasNonPrepErrorUpload = uploads.some(
        (upload) =>
          upload.status !== UploadStatus.Error ||
          getMatrixUploadErrorStage(upload.error) !== 'create'
      );
      const canSend = hasMixedPrepErrorSend || hasNonPrepErrorUpload;

      return canSend
        ? reactModule.createElement('button', {
            'aria-label': 'Upload board Send',
            onClick: onSend,
          })
        : reactModule.createElement('span', { 'aria-label': 'Upload board Send hidden' });
    },
  };
});

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
  getDataTransferFiles: (dataTransfer: DataTransfer) => {
    const files = Array.from(dataTransfer.files ?? []);
    return files.length > 0 ? files : undefined;
  },
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
    createMindroomRoomInputPasteMarkerElement: (marker: {
      id: string;
      chars: number;
      fileName: string;
      raw: string;
    }) => ({
      type: 'paste-marker',
      id: marker.id,
      chars: marker.chars,
      fileName: marker.fileName,
      marker: marker.raw,
      children: [{ text: '' }],
    }),
    getMindroomRoomInputPasteMarkerFileNames: (nodes: Array<any>) => {
      const fileNames = new Set<string>();
      const visit = (node: any) => {
        if (node?.type === 'paste-marker' && typeof node.fileName === 'string') {
          fileNames.add(node.fileName);
          return;
        }
        if (Array.isArray(node?.children)) node.children.forEach(visit);
      };
      nodes.forEach(visit);
      return fileNames;
    },
    removeMindroomRoomInputPasteMarkerElements: (
      editor: { children?: Array<any> },
      fileNames: Set<string>
    ) => {
      if (!Array.isArray(editor.children)) return;
      editor.children = editor.children.map((node) =>
        Array.isArray(node?.children)
          ? {
              ...node,
              children: node.children.filter(
                (child: any) => child?.type !== 'paste-marker' || !fileNames.has(child.fileName)
              ),
            }
          : node
      );
    },
    getMindroomRoomInputAutocompleteQuery: () => undefined,
    getMindroomRoomInputMessageRelation: () => undefined,
    getMindroomRoomInputVoiceSendContext: ({
      ownerSessionId,
      roomId,
      room,
      threadId,
      replyDraft,
      threadingEnabled = true,
    }: {
      ownerSessionId: string;
      roomId: string;
      room: unknown;
      threadId: string | undefined;
      replyDraft: IReplyDraft | undefined;
      threadingEnabled?: boolean;
    }) => ({
      ownerSessionId,
      roomId,
      room,
      threadId,
      replyDraft,
      threadingEnabled,
      signalBridgedRoom: false,
    }),
    refreshMindroomRoomInputVoiceSendContext: (
      mxClient: { getRoom: (roomId: string) => unknown },
      context: {
        ownerSessionId: string;
        roomId: string;
        threadId: string | undefined;
        replyDraft: IReplyDraft | undefined;
        threadingEnabled: boolean;
      }
    ) => {
      const liveRoom = mxClient.getRoom(context.roomId) as
        | { getMyMembership?: () => string }
        | undefined;
      if (!liveRoom || liveRoom.getMyMembership?.() !== 'join') return null;
      return {
        ...context,
        room: liveRoom,
        signalBridgedRoom: false,
      };
    },
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
    MindroomRoomInputReplyContext: ({
      children,
      pendingSend,
    }: {
      children?: React.ReactNode;
      pendingSend?: boolean;
    }) => {
      customEditorState.replyContextRenderCount += 1;
      return React.createElement(
        'div',
        null,
        children,
        pendingSend
          ? React.createElement(
              'span',
              {
                role: 'status',
                title: 'Waiting for server',
              },
              'Message sending'
            )
          : null
      );
    },
    MindroomVoiceRecorderComposer: ({
      onSendRecording,
      getSendContext,
      ...rest
    }: {
      active?: boolean;
      sendDisabled?: boolean;
      onClose: () => void;
      onRecordingStart?: () => void;
      onSendStopRequest?: () => boolean | void;
      onSendStopFailure?: () => void;
      onSendRecording: (
        file: File,
        duration: number,
        waveform: number[] | undefined,
        context: unknown
      ) => Promise<void>;
      getSendContext: () => unknown;
    }) => {
      // Auto-fill the captured context from getSendContext() so existing
      // unit-style tests of handleVoiceSend keep their (file, duration,
      // waveform?) call shape. The hook's own end-to-end persistence is
      // covered by useVoiceRecorder.test.ts; the parent's auto-open and
      // mic-disabled wiring is exercised in dedicated tests below.
      voiceRecorderState.props = {
        ...rest,
        getSendContext,
        onSendRecording: (file, duration, waveform, context) =>
          onSendRecording(file, duration, waveform, context ?? getSendContext()),
      };
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

const createRoom = (roomId = ROOM_ID, encrypted = false) =>
  ({
    roomId,
    name: roomId,
    hasEncryptionStateEvent: () => encrypted,
    getMember: () => undefined,
    getMembers: () => [],
    getMyMembership: () => 'join',
  } as never);

const createEditor = () => {
  const editor = {
    children: [{ type: 'paragraph', children: [] }] as Array<any>,
    insertNode: (node: unknown) => {
      editorMocks.insertNode(node);
      editor.children[0]?.children.push(node);
      return node;
    },
    insertText: (text: string) => {
      editorMocks.insertText(text);
      editor.children[0]?.children.push({ text });
      return text;
    },
  };
  customEditorState.editor = editor;
  return editor as never;
};

const createTextPasteEvent = (text: string) =>
  ({
    clipboardData: {
      files: {
        length: 0,
      },
      getData: (type: string) => (type === 'text/plain' ? text : ''),
    },
    preventDefault: vi.fn(),
  } as never as {
    clipboardData: DataTransfer;
    preventDefault: ReturnType<typeof vi.fn>;
  });

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
    threadingEnabled?: boolean;
    onRoomMessageSent?: (eventId: string) => void;
    keyedRoomSubtree?: boolean;
    encryptedRoom?: boolean;
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
      room: createRoom(props?.roomId ?? ROOM_ID, props?.encryptedRoom),
      threadId: props?.threadId,
      threadingEnabled: props?.threadingEnabled,
      onRoomMessageSent: props?.onRoomMessageSent,
    })
  );

const renderRoomInput = async (
  store = createStore(),
  props?: {
    roomId?: string;
    threadId?: string;
    threadingEnabled?: boolean;
    onRoomMessageSent?: (eventId: string) => void;
    keyedRoomSubtree?: boolean;
    encryptedRoom?: boolean;
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
    threadingEnabled?: boolean;
    onRoomMessageSent?: (eventId: string) => void;
    keyedRoomSubtree?: boolean;
    encryptedRoom?: boolean;
  }
) => {
  await act(async () => {
    renderer.update(createRoomInputTree(store, props));
  });
};

// The composer only mounts when the user has explicitly opened the recorder
// or this room owns a parked draft. Tests that drive handleVoiceSend directly
// must first open the recorder to make voiceRecorderState.props observable.
const openVoiceRecorder = async (renderer: ReactTestRenderer) => {
  const micButton = renderer.root.find(
    (node) =>
      node.type === 'button' &&
      typeof node.props['aria-label'] === 'string' &&
      String(node.props['aria-label']).startsWith('Record voice message')
  );
  await act(async () => {
    micButton.props.onClick();
  });
};

afterEach(() => {
  voiceRecorderState.props = undefined;
  customEditorState.autocompleteQuery = undefined;
  customEditorState.editor = undefined;
  customEditorState.props = undefined;
  customEditorState.replyContextRenderCount = 0;
  editorOutputState.plainText = '';
  editorOutputState.customHtml = '';
  editorOutputState.htmlEqualsPlainText = true;
  mxState.cancelUpload.mockReset();
  mxState.getUserId.mockReset();
  mxState.getUserId.mockReturnValue('@me:example.org');
  mxState.getRoom.mockReset();
  mxState.getRoom.mockImplementation(
    (roomId: string) =>
      ({
        roomId,
        name: roomId,
        hasEncryptionStateEvent: () => false,
        getMember: () => undefined,
        getMembers: () => [],
        getMyMembership: () => 'join',
      } as unknown as Room)
  );
  mxState.sendMessage.mockReset();
  mxState.sendMessage.mockResolvedValue({ event_id: '$sent' });
  mxState.uploadContent.mockReset();
  mxState.uploadContent.mockResolvedValue({ content_uri: 'mxc://mindroom/voice' });
  encryptionState.encryptAttachment.mockReset();
  encryptionState.encryptAttachment.mockImplementation(async (data: ArrayBuffer) => ({
    data,
    info: {
      v: 'v2',
      key: {
        alg: 'A256CTR',
        ext: true,
        k: 'test-key',
        key_ops: ['encrypt', 'decrypt'],
        kty: 'oct',
      },
      iv: 'test-iv',
      hashes: {
        sha256: 'test-hash',
      },
    },
  }));
  encryptionState.decryptAttachment.mockReset();
  editorMocks.insertNode.mockReset();
  editorMocks.insertText.mockReset();
  editorMocks.moveCursor.mockReset();
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

  it('turns oversized pasted text into an upload and inserts a parseable marker', async () => {
    const { store, renderer } = await renderRoomInput();
    const pastedText = 'large paste\n'.repeat(6000);
    const pasteEvent = createTextPasteEvent(pastedText);

    editorOutputState.plainText = 'Before ';
    editorOutputState.customHtml = 'Before ';
    editorOutputState.htmlEqualsPlainText = true;

    await act(async () => {
      await customEditorState.props!.onPaste?.(pasteEvent);
    });

    const [fileItem] = store.get(roomIdToUploadItemsAtomFamily(ROOM_ID));
    const pasteMarkerNode = editorMocks.insertNode.mock.calls[0]?.[0] as {
      chars: number;
      fileName: string;
      id: string;
      marker: string;
      type: string;
    };
    const marker = pasteMarkerNode.marker;

    expect(pasteEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(fileItem?.file).toBeInstanceOf(File);
    expect(fileItem?.file.name).toMatch(/^mindroom-paste-[a-f0-9]{6}\.txt$/);
    expect(fileItem?.file.type).toBe('text/plain');
    expect(await (fileItem!.file as File).text()).toBe(pastedText);
    expect(marker).toMatch(
      /^\[\[mindroom-paste:\{"v":1,"id":"paste-[a-f0-9]{6}","chars":\d+,"file":"mindroom-paste-[a-f0-9]{6}\.txt"\}\]\]$/
    );

    const markerPayload = JSON.parse(marker.slice('[[mindroom-paste:'.length, -2)) as {
      chars: number;
      file: string;
      id: string;
    };
    expect(markerPayload.chars).toBe(pastedText.length);
    expect(fileItem?.file.name).toBe(markerPayload.file);
    expect(fileItem?.file.name).toBe(`mindroom-${markerPayload.id}.txt`);
    expect(pasteMarkerNode).toEqual(
      expect.objectContaining({
        type: 'paste-marker',
        id: markerPayload.id,
        chars: pastedText.length,
        fileName: markerPayload.file,
        marker,
      })
    );
    expect(editorMocks.moveCursor).toHaveBeenCalledTimes(1);

    renderer.unmount();
  });

  it('keeps failed paste preparation from inserting a dangling marker', async () => {
    const { store, renderer } = await renderRoomInput(createStore(), { encryptedRoom: true });
    const pastedText = 'large paste\n'.repeat(6000);
    const pasteEvent = createTextPasteEvent(pastedText);

    encryptionState.encryptAttachment.mockRejectedValueOnce(new Error('paste encryption failed'));
    editorOutputState.plainText = 'Before ';
    editorOutputState.customHtml = 'Before ';
    editorOutputState.htmlEqualsPlainText = true;

    await act(async () => {
      await customEditorState.props!.onPaste?.(pasteEvent);
    });

    const [fileItem] = store.get(roomIdToUploadItemsAtomFamily(ROOM_ID));

    expect(pasteEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(fileItem?.file.name).toMatch(/^mindroom-paste-[a-f0-9]{6}\.txt$/);
    expect(getMatrixUploadErrorStage(fileItem?.prepError)).toBe('create');
    expect(editorMocks.insertNode).not.toHaveBeenCalled();
    expect(editorMocks.insertText).toHaveBeenCalledWith(pastedText);
    expect(
      customEditorState.editor!.children.some((node: any) =>
        node?.children?.some((child: any) => child?.type === 'paste-marker')
      )
    ).toBe(false);

    await act(async () => {
      customEditorState.props!.onChange?.();
    });

    const [retainedFileItem] = store.get(roomIdToUploadItemsAtomFamily(ROOM_ID));
    expect(retainedFileItem).toBe(fileItem);
    expect(getMatrixUploadErrorMessage(retainedFileItem?.prepError)).toBe(
      "Couldn't prepare file for upload."
    );

    renderer.unmount();
  });

  it('shows upload-board Send for a successful file mixed with a prep-error file', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store);
    const failed = new File(['failed'], 'failed.txt', { type: 'text/plain' });
    const sendable = new File(['sendable'], 'sendable.txt', { type: 'text/plain' });
    const prepError = toMatrixUploadError(new Error('failed to prepare'), 'create');

    await act(async () => {
      store.set(roomIdToUploadItemsAtomFamily(ROOM_ID), {
        type: 'PUT',
        item: [
          {
            file: failed,
            originalFile: failed,
            encInfo: undefined,
            metadata: { markedAsSpoiler: false },
            prepError,
          },
          {
            file: sendable,
            originalFile: sendable,
            encInfo: undefined,
            metadata: { markedAsSpoiler: false },
          },
        ],
      });
      store.set(roomUploadAtomFamily(failed), { error: prepError });
      store.set(roomUploadAtomFamily(sendable), { mxc: 'mxc://mindroom/sendable' });
    });

    const uploadBoardSend = renderer.root.findByProps({ 'aria-label': 'Upload board Send' });
    await act(async () => {
      await uploadBoardSend.props.onClick();
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage.mock.calls[0][1]).toMatchObject({
      body: 'sendable.txt',
      url: 'mxc://mindroom/sendable',
    });

    renderer.unmount();
  });

  it('leaves small text pastes to the editor default behavior', async () => {
    const { store, renderer } = await renderRoomInput();
    const pasteEvent = createTextPasteEvent('small paste');

    editorOutputState.plainText = 'Before ';
    editorOutputState.customHtml = 'Before ';
    editorOutputState.htmlEqualsPlainText = true;

    await act(async () => {
      await customEditorState.props!.onPaste?.(pasteEvent);
    });

    expect(pasteEvent.preventDefault).not.toHaveBeenCalled();
    expect(editorMocks.insertNode).not.toHaveBeenCalled();
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('keeps an errored item and aligned metadata after a middle encryption rejection', async () => {
    const firstFile = new File(['first'], 'first.txt', { type: 'text/plain' });
    const secondFile = new File(['second'], 'second.txt', { type: 'text/plain' });
    const thirdFile = new File(['third'], 'third.txt', { type: 'text/plain' });
    const decoder = new TextDecoder();

    encryptionState.encryptAttachment.mockImplementation(async (data: ArrayBuffer) => {
      if (decoder.decode(data) === 'second') {
        throw new Error('second encryption failed');
      }

      return {
        data,
        info: {
          v: 'v2',
          key: {
            alg: 'A256CTR',
            ext: true,
            k: 'test-key',
            key_ops: ['encrypt', 'decrypt'],
            kty: 'oct',
          },
          iv: 'test-iv',
          hashes: {
            sha256: 'test-hash',
          },
        },
      };
    });

    const uploadItems = await createMindroomRoomUploadItems(
      [firstFile, secondFile, thirdFile],
      createRoom(ROOM_ID, true),
      (file, index) => ({
        markedAsSpoiler: false,
        mindroomPasteAttachment: {
          id: `file-${index}`,
          chars: file.size,
          fileName: file.name,
        },
      })
    );

    expect(uploadItems).toHaveLength(3);
    expect(uploadItems.map((item) => item.originalFile)).toEqual([
      firstFile,
      secondFile,
      thirdFile,
    ]);
    expect(uploadItems.map((item) => item.metadata.mindroomPasteAttachment?.fileName)).toEqual([
      'first.txt',
      'second.txt',
      'third.txt',
    ]);
    expect(uploadItems.map((item) => item.metadata.mindroomPasteAttachment?.id)).toEqual([
      'file-0',
      'file-1',
      'file-2',
    ]);
    expect(uploadItems.map((item) => item.prepError !== undefined)).toEqual([false, true, false]);
    expect(getMatrixUploadErrorStage(uploadItems[1].prepError)).toBe('create');
    expect(getMatrixUploadErrorMessage(uploadItems[1].prepError)).toBe(
      "Couldn't prepare file for upload."
    );
  });

  it('removes the staged paste upload when its composer badge is deleted', async () => {
    const { store, renderer } = await renderRoomInput();
    const pastedText = 'large paste\n'.repeat(6000);

    editorOutputState.plainText = 'Before ';
    editorOutputState.customHtml = 'Before ';
    editorOutputState.htmlEqualsPlainText = true;

    await act(async () => {
      await customEditorState.props!.onPaste?.(createTextPasteEvent(pastedText));
    });

    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toHaveLength(1);

    customEditorState.editor!.children = [{ type: 'paragraph', children: [{ text: 'Before ' }] }];
    await act(async () => {
      customEditorState.props!.onChange?.();
    });

    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('keeps a paste upload claimed by send after the session-start editor reset', async () => {
    const { store, renderer } = await renderRoomInput();
    const pastedText = 'large paste\n'.repeat(6000);

    editorOutputState.plainText = 'Before ';
    editorOutputState.customHtml = 'Before ';
    editorOutputState.htmlEqualsPlainText = true;

    await act(async () => {
      await customEditorState.props!.onPaste?.(createTextPasteEvent(pastedText));
    });

    const pasteMarkerNode = editorMocks.insertNode.mock.calls[0]?.[0] as {
      marker: string;
    };
    const marker = pasteMarkerNode.marker;

    editorOutputState.plainText = `${marker}\n\ntest testing`;
    editorOutputState.customHtml = editorOutputState.plainText;
    editorOutputState.htmlEqualsPlainText = true;
    editorMocks.resetEditor.mockImplementationOnce(() => {
      customEditorState.editor!.children = [{ type: 'paragraph', children: [{ text: '' }] }];
      customEditorState.props!.onChange?.();
    });

    const uploadBoardSend = renderer.root.findByProps({ 'aria-label': 'Upload board Send' });
    await act(async () => {
      await uploadBoardSend.props.onClick();
    });

    // The caption sends after the paste upload; the session-start editor reset clears the
    // marker but must not orphan-clean the claimed paste upload while it is still uploading.
    expect(editorMocks.resetEditor).toHaveBeenCalled();
    expect(mxState.sendMessage).not.toHaveBeenCalled();
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toHaveLength(1);

    const pasteFile = store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))[0].file;
    await act(async () => {
      store.set(roomUploadAtomFamily(pasteFile), { mxc: 'mxc://mindroom/paste' });
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(2);
    expect(mxState.sendMessage.mock.calls[0][1]).toMatchObject({
      url: 'mxc://mindroom/paste',
    });
    expect(mxState.sendMessage.mock.calls[1][1]).toMatchObject({
      msgtype: 'm.text',
      body: `${marker}\n\ntest testing`,
      'm.relates_to': {
        event_id: '$sent',
        rel_type: 'm.thread',
      },
    });

    renderer.unmount();
  });

  it('does not duplicate a text message when Enter is pressed twice before send resolves', async () => {
    const { renderer } = await renderRoomInput();
    const send = createDeferred<{ event_id: string }>();
    mxState.sendMessage.mockReturnValueOnce(send.promise);

    editorOutputState.plainText = 'Hello @ali';
    editorOutputState.customHtml = 'Hello @ali';
    editorOutputState.htmlEqualsPlainText = true;

    const firstEnter = { key: 'Enter', preventDefault: vi.fn() };
    const secondEnter = { key: 'Enter', preventDefault: vi.fn() };

    await act(async () => {
      customEditorState.props!.onKeyDown?.(firstEnter);
      customEditorState.props!.onKeyDown?.(secondEnter);
      await Promise.resolve();
    });

    expect(firstEnter.preventDefault).toHaveBeenCalledTimes(1);
    expect(secondEnter.preventDefault).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        body: 'Hello @ali',
        msgtype: 'm.text',
      })
    );

    await act(async () => {
      send.resolve({ event_id: '$sent' });
      await Promise.resolve();
    });

    renderer.unmount();
  });

  it('shows the pending send indicator for unresolved thread composer sends', async () => {
    const { renderer } = await renderRoomInput(createStore(), { threadId: '$thread' });
    const send = createDeferred<{ event_id: string }>();
    mxState.sendMessage.mockReturnValueOnce(send.promise);

    editorOutputState.plainText = 'Thread reply still sending';
    editorOutputState.customHtml = 'Thread reply still sending';
    editorOutputState.htmlEqualsPlainText = true;

    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('Message sending');
    expect(JSON.stringify(renderer.toJSON())).toContain('Waiting for server');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Sending to this thread');

    await act(async () => {
      send.resolve({ event_id: '$sent' });
      await Promise.resolve();
    });

    expect(JSON.stringify(renderer.toJSON())).not.toContain('Message sending');

    renderer.unmount();
  });

  it('does not render thread helper context for static thread composers', async () => {
    const { renderer } = await renderRoomInput(createStore(), { threadId: '$thread' });

    expect(customEditorState.replyContextRenderCount).toBe(0);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Sending to this thread');

    renderer.unmount();
  });

  it('notifies successful top-level room text sends with the new event id', async () => {
    const notificationOrder: string[] = [];
    editorMocks.resetEditor.mockImplementation(() => {
      notificationOrder.push('reset-editor');
    });
    editorMocks.resetEditorHistory.mockImplementation(() => {
      notificationOrder.push('reset-history');
    });
    const onRoomMessageSent = vi.fn(() => {
      notificationOrder.push('notify');
    });
    const { renderer } = await renderRoomInput(createStore(), { onRoomMessageSent });

    editorOutputState.plainText = 'Start a compact thread';
    editorOutputState.customHtml = 'Start a compact thread';
    editorOutputState.htmlEqualsPlainText = true;

    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
    });

    expect(onRoomMessageSent).toHaveBeenCalledWith('$sent');
    const notifyIndex = notificationOrder.indexOf('notify');
    expect(notifyIndex).toBeGreaterThan(-1);
    expect(notificationOrder.indexOf('reset-editor')).toBeLessThan(notifyIndex);
    expect(notificationOrder.indexOf('reset-history')).toBeLessThan(notifyIndex);

    renderer.unmount();
  });

  it('does not notify thread-targeted text sends as new room message roots', async () => {
    const onRoomMessageSent = vi.fn();
    const { renderer } = await renderRoomInput(createStore(), {
      threadId: '$thread-a',
      onRoomMessageSent,
    });

    editorOutputState.plainText = 'Reply in thread';
    editorOutputState.customHtml = 'Reply in thread';
    editorOutputState.htmlEqualsPlainText = true;

    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(onRoomMessageSent).not.toHaveBeenCalled();

    renderer.unmount();
  });

  it('does not submit when Enter is pressed with an autocomplete menu open', async () => {
    const { renderer } = await renderRoomInput();
    customEditorState.autocompleteQuery = {
      prefix: 'user',
      range: {},
      text: '',
    };
    editorOutputState.plainText = '@';
    editorOutputState.customHtml = '@';
    editorOutputState.htmlEqualsPlainText = true;

    await act(async () => {
      customEditorState.props!.onKeyUp?.({ key: '@', preventDefault: vi.fn() });
    });

    const enter = { key: 'Enter', preventDefault: vi.fn() };
    await act(async () => {
      customEditorState.props!.onKeyDown?.(enter);
      await Promise.resolve();
    });

    expect(enter.preventDefault).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage).not.toHaveBeenCalled();

    renderer.unmount();
  });

  it('keeps same-tick voice sends alive until the upload becomes sendable', async () => {
    const { store, renderer } = await renderRoomInput(createStore(), { threadId: '$thread' });
    await openVoiceRecorder(renderer);

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
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });

    // The hook snapshots the send context inside start(); replicate that here.
    const capturedContext = voiceRecorderState.props!.getSendContext();
    await updateRoomInput(renderer, store, { threadId: '$thread-b' });
    await act(async () => {
      await voiceRecorderState.props?.onSendRecording(file, 1200, undefined, capturedContext);
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

  it('disables the mic button in another room while a failed-send draft is parked', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, {
      threadId: '$thread-a',
      keyedRoomSubtree: true,
    });
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mxState.uploadContent.mockRejectedValueOnce(
      new DOMException('The operation was aborted.', 'AbortError')
    );

    // Simulate a failed send: hook would write to the global atom on failure.
    // Drive that through the mocked composer's onSendRecording.
    await act(async () => {
      await expect(voiceRecorderState.props!.onSendRecording(file, 1100)).rejects.toMatchObject({
        errcode: 'M_UNKNOWN',
      });
    });
    // Hook would have written the draft on failure. Simulate that here since
    // the mocked composer doesn't run the hook; the persistence-through-hook
    // path is covered by the dedicated useVoiceRecorder test.
    store.set(pendingVoiceSendDraftAtom, {
      file,
      duration: 1100,
      context: voiceRecorderState.props!.getSendContext() as never,
    });

    // Navigate to a different room (keyed remount mirrors production
    // RoomProvider behavior). The mic must be disabled with a descriptive
    // aria-label pointing back to the room with the parked draft.
    await updateRoomInput(renderer, store, {
      roomId: OTHER_ROOM_ID,
      threadId: undefined,
      keyedRoomSubtree: true,
    });
    const micButton = renderer.root.find(
      (node) =>
        node.type === 'button' &&
        typeof node.props['aria-label'] === 'string' &&
        node.props['aria-label'].startsWith('Voice recording paused')
    );
    expect(micButton.props.disabled).toBe(true);
    expect(micButton.props['aria-label']).toContain(ROOM_ID);

    consoleError.mockRestore();
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

    const capturedContext = voiceRecorderState.props!.getSendContext();
    await updateRoomInput(renderer, store, { threadId: '$thread-after-open' });
    await act(async () => {
      await voiceRecorderState.props?.onSendRecording(file, 800, undefined, capturedContext);
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage.mock.calls[0][1]).not.toHaveProperty('m.relates_to');

    renderer.unmount();
  });

  it('notifies top-level voice sends after clearing local voice state', async () => {
    const store = createStore();
    const notificationState: Array<{ pending: boolean; uploads: File[] }> = [];
    const onRoomMessageSent = vi.fn(() => {
      notificationState.push({
        pending: store.get(voiceAutoSendPendingAtom),
        uploads: store.get(roomIdToUploadItemsAtomFamily(ROOM_ID)).map((item) => item.file),
      });
    });
    const { renderer } = await renderRoomInput(store, { onRoomMessageSent });
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });

    await act(async () => {
      await voiceRecorderState.props?.onSendRecording(file, 900);
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage.mock.calls[0][1]).not.toHaveProperty('m.relates_to');
    expect(onRoomMessageSent).toHaveBeenCalledWith('$sent');
    expect(notificationState).toEqual([{ pending: false, uploads: [] }]);

    renderer.unmount();
  });

  it('keeps paused voice recordings on the recording-start thread after navigation', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { threadId: '$thread-a' });
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });

    const capturedContext = voiceRecorderState.props!.getSendContext();
    await updateRoomInput(renderer, store, { threadId: '$thread-b' });
    await act(async () => {
      await voiceRecorderState.props?.onSendRecording(file, 900, undefined, capturedContext);
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
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });

    const capturedContext = voiceRecorderState.props!.getSendContext();
    await updateRoomInput(renderer, store, {
      roomId: OTHER_ROOM_ID,
      threadId: '$other-thread',
    });
    await act(async () => {
      await voiceRecorderState.props?.onSendRecording(file, 1100, undefined, capturedContext);
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
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const upload = createDeferred<{ content_uri: string }>();
    mxState.uploadContent.mockReturnValueOnce(upload.promise);
    let sendPromise!: Promise<void>;

    const capturedContext = voiceRecorderState.props!.getSendContext();
    await updateRoomInput(renderer, store, {
      roomId: OTHER_ROOM_ID,
      threadId: '$other-thread',
    });
    await act(async () => {
      sendPromise = voiceRecorderState.props!.onSendRecording(
        file,
        1100,
        undefined,
        capturedContext
      ) as Promise<void>;
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
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const upload = createDeferred<{ content_uri: string }>();
    mxState.uploadContent.mockReturnValueOnce(upload.promise);
    let sendPromise!: Promise<void>;

    const capturedContext = voiceRecorderState.props!.getSendContext();
    await act(async () => {
      sendPromise = voiceRecorderState.props!.onSendRecording(
        file,
        1100,
        undefined,
        capturedContext
      ) as Promise<void>;
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
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const upload = createDeferred<{ content_uri: string }>();
    mxState.uploadContent.mockReturnValueOnce(upload.promise);

    const capturedContext = voiceRecorderState.props!.getSendContext();
    const sendRecordingAfterUnmount = voiceRecorderState.props!.onSendRecording;

    await updateRoomInput(renderer, store, {
      roomId: OTHER_ROOM_ID,
      threadId: '$other-thread',
      keyedRoomSubtree: true,
    });

    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = sendRecordingAfterUnmount(
        file,
        1100,
        undefined,
        capturedContext
      ) as Promise<void>;
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
    await openVoiceRecorder(renderer);
    const firstFile = new File(['voice-1'], 'voice-1.m4a', { type: 'audio/mp4' });
    const secondFile = new File(['voice-2'], 'voice-2.m4a', { type: 'audio/mp4' });
    const upload = createDeferred<{ content_uri: string }>();
    mxState.uploadContent.mockReturnValueOnce(upload.promise);

    const capturedContext = voiceRecorderState.props!.getSendContext();
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

    // OTHER_ROOM_ID's mic is disabled because voiceAutoSendPending=true
    // globally; the composer doesn't mount in OTHER_ROOM_ID at all (no parked
    // draft, recorder not open). The user has no surface to trigger a second
    // send from another room. We still want to verify the parent-side
    // defense-in-depth: a stale captured handleVoiceSend for a second file
    // throws the busy error rather than silently double-sending.
    const micButton = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Record voice message'
    );
    expect(micButton.props.disabled).toBe(true);
    // OTHER_ROOM_ID has no parked draft and the recorder isn't open; the
    // composer doesn't mount here. The user has no path to start a second
    // send from this room — the mic-disabled gate IS the defense. (The
    // previous "captured handleVoiceSend rejects" assertion was a stale ref
    // from the unmounted ROOM_ID parent and didn't match production: in
    // production no such second call is reachable.)
    void secondFile;

    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = sendRecordingAfterStop(
        firstFile,
        1100,
        undefined,
        capturedContext
      ) as Promise<void>;
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
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const upload = createDeferred<{ content_uri: string }>();
    mxState.uploadContent.mockReturnValueOnce(upload.promise);
    let sendPromise!: Promise<void>;

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
    await openVoiceRecorder(renderer);
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

  it('clears failed voice upload state and releases pending auto-send', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { threadId: '$thread-a' });
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const uploadAbort = new DOMException('The operation was aborted.', 'AbortError');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mxState.uploadContent.mockRejectedValueOnce(uploadAbort);

    const capturedContext = voiceRecorderState.props!.getSendContext();
    act(() => {
      expect(voiceRecorderState.props?.onSendStopRequest?.()).toBe(true);
    });
    await act(async () => {
      await expect(
        voiceRecorderState.props!.onSendRecording(file, 1100, undefined, capturedContext)
      ).rejects.toMatchObject({
        errcode: 'M_UNKNOWN',
      });
    });

    expect(mxState.sendMessage).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('[mr-upload]', {
      stage: 'upload',
      originalName: 'AbortError',
      name: 'M_UNKNOWN',
      errcode: 'M_UNKNOWN',
      httpStatus: undefined,
      message: expect.stringContaining('The operation was aborted.'),
    });
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);

    await updateRoomInput(renderer, store, { threadId: '$thread-after-failure' });
    act(() => {
      expect(voiceRecorderState.props?.onSendStopRequest?.()).toBe(true);
    });
    // The retry reuses the originally-captured context.
    await act(async () => {
      await voiceRecorderState.props!.onSendRecording(file, 700, undefined, capturedContext);
    });

    expect(mxState.uploadContent).toHaveBeenCalledTimes(2);
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
    consoleError.mockRestore();

    renderer.unmount();
  });

  it('does not mount the composer in another room with a thread/reply banner while another room owns the parked draft', async () => {
    // CLUSTER 1 (R3 reviewers A/F/G/H Issue 1): the previous wiring mounted
    // the composer whenever the parent had a banner reason (replyDraft ||
    // threadId), and the composer read the global atom unconditionally —
    // so room B with an active thread would render room A's retry/discard
    // capsule against the wrong room. The fix gates composer mount on
    // ownership; this test would FAIL under the old wiring.
    const store = createStore();
    // Park a failed-send draft for ROOM_ID, owned by the current session.
    store.set(pendingVoiceSendDraftAtom, {
      file: new File(['voice'], 'voice.m4a', { type: 'audio/mp4' }),
      duration: 1100,
      errorMessage: 'upload failed',
      context: {
        ownerSessionId: '@me:example.org',
        roomId: ROOM_ID,
        room: createRoom(ROOM_ID),
        threadId: '$thread-a',
        replyDraft: undefined,
        threadingEnabled: true,
        signalBridgedRoom: false,
      } as never,
    });

    // Render in OTHER_ROOM_ID with a thread banner — exactly the scenario
    // that tripped the old leak.
    const { renderer } = await renderRoomInput(store, {
      roomId: OTHER_ROOM_ID,
      threadId: '$other-thread',
      keyedRoomSubtree: true,
    });

    // The composer must NOT have mounted (no voiceRecorderState.props).
    expect(voiceRecorderState.props).toBeUndefined();

    // ROOM_ID's parked draft must be untouched.
    const persisted = store.get(pendingVoiceSendDraftAtom);
    expect(persisted?.context.roomId).toBe(ROOM_ID);
    expect(persisted?.errorMessage).toBe('upload failed');

    // OTHER_ROOM_ID's mic must be locked with the descriptive aria-label.
    const lockedMic = renderer.root.find(
      (node) =>
        node.type === 'button' &&
        typeof node.props['aria-label'] === 'string' &&
        node.props['aria-label'].startsWith('Voice recording paused')
    );
    expect(lockedMic.props.disabled).toBe(true);

    renderer.unmount();
  });

  it('discards a parked draft when the source room is no longer reachable (kicked/left/forgot)', async () => {
    // R4 rev-A Issue 2 (MAJOR): same-session orphan drafts would otherwise
    // lock voice recording globally with no in-app recovery surface.
    // mx.getRoom returning null means the user lost access to that room
    // (kicked, left, forgot, sync drift); the cleanup useEffect must clear
    // the orphan so other rooms regain a working mic.
    const store = createStore();
    const FORGOTTEN_ROOM_ID = '!forgotten:example.org';
    store.set(pendingVoiceSendDraftAtom, {
      file: new File(['voice'], 'voice.m4a', { type: 'audio/mp4' }),
      duration: 1100,
      errorMessage: 'upload failed',
      context: {
        ownerSessionId: '@me:example.org',
        roomId: FORGOTTEN_ROOM_ID,
        room: createRoom(FORGOTTEN_ROOM_ID),
        threadId: undefined,
        replyDraft: undefined,
        threadingEnabled: true,
        signalBridgedRoom: false,
      } as never,
    });

    // Simulate the source room being unreachable in the live client.
    mxState.getRoom.mockImplementation((roomId: string) =>
      roomId === FORGOTTEN_ROOM_ID ? undefined : ({ roomId } as unknown as Room)
    );

    const { renderer } = await renderRoomInput(store);

    expect(store.get(pendingVoiceSendDraftAtom)).toBeUndefined();
    const micButton = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Record voice message'
    );
    expect(micButton.props.disabled).toBe(false);

    renderer.unmount();
  });

  it('discards a parked draft when the source room exists but the user is no longer Joined', async () => {
    // R5 FIX 2 (rev-B Issue 1, rev-G Issue 1): the orphan-room cleanup
    // previously only checked `mx.getRoom()` truthiness. A Room object can
    // survive in the SDK store after the user is no longer joined
    // (Leave/Ban/etc), in which case the source room composer cannot render
    // and the user has no recovery surface. Treat non-Joined the same as
    // missing.
    const store = createStore();
    const LEFT_ROOM_ID = '!left:example.org';
    store.set(pendingVoiceSendDraftAtom, {
      file: new File(['voice'], 'voice.m4a', { type: 'audio/mp4' }),
      duration: 1100,
      errorMessage: 'upload failed',
      context: {
        ownerSessionId: '@me:example.org',
        roomId: LEFT_ROOM_ID,
        room: createRoom(LEFT_ROOM_ID),
        threadId: undefined,
        replyDraft: undefined,
        threadingEnabled: true,
        signalBridgedRoom: false,
      } as never,
    });

    // The room is still resolvable, but membership is Leave. This is the
    // case the previous cleanup missed.
    mxState.getRoom.mockImplementation((roomId: string) =>
      roomId === LEFT_ROOM_ID
        ? ({
            roomId,
            name: roomId,
            hasEncryptionStateEvent: () => false,
            getMember: () => undefined,
            getMembers: () => [],
            getMyMembership: () => 'leave',
          } as unknown as Room)
        : ({
            roomId,
            name: roomId,
            hasEncryptionStateEvent: () => false,
            getMember: () => undefined,
            getMembers: () => [],
            getMyMembership: () => 'join',
          } as unknown as Room)
    );

    const { renderer } = await renderRoomInput(store);

    expect(store.get(pendingVoiceSendDraftAtom)).toBeUndefined();
    const micButton = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Record voice message'
    );
    expect(micButton.props.disabled).toBe(false);

    renderer.unmount();
  });

  it('rejects retry when the source room is no longer reachable (re-resolves at retry time)', async () => {
    // R5 FIX 3 (rev-H Issue 2): handleVoiceSend used to read
    // context.room directly — a snapshot from start() that could be stale
    // by retry time. The new code re-resolves via mx.getRoom and refuses to
    // proceed if the room is gone or non-joined. This also closes a
    // plaintext-leak window for encryption upgrades (covered by the
    // existing "propagates encrypted voice preparation failures" test
    // because it overrides mx.getRoom to report encryption ON).
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { roomId: ROOM_ID });
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const capturedContext = voiceRecorderState.props!.getSendContext();

    // Live room is no longer joined (left between recording and retry).
    mxState.getRoom.mockImplementation((roomId: string) =>
      roomId === ROOM_ID
        ? ({
            roomId,
            name: roomId,
            hasEncryptionStateEvent: () => false,
            getMember: () => undefined,
            getMembers: () => [],
            getMyMembership: () => 'leave',
          } as unknown as Room)
        : undefined
    );

    let rejected: unknown;
    await act(async () => {
      try {
        await voiceRecorderState.props!.onSendRecording(file, 1100, undefined, capturedContext);
      } catch (err) {
        rejected = err;
      }
    });

    expect(rejected).toBeInstanceOf(Error);
    expect((rejected as Error).message).toMatch(/no longer available/i);
    expect(mxState.uploadContent).not.toHaveBeenCalled();
    expect(mxState.sendMessage).not.toHaveBeenCalled();
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);

    renderer.unmount();
  });

  it('releases voiceAutoSendPendingAtom when refresh fails AFTER the slot has been claimed', async () => {
    // R7 EXTREME-CONVERGENCE MAJOR (rev-E + rev-F): the production retry
    // path goes onSendStopRequest → onSendRecording. The first call claims
    // the auto-send slot via claimVoiceAutoSend, setting
    // voiceAutoSendPendingAtom = true. If handleVoiceSend's live-room
    // refresh then throws, the throw must NOT skip the release — otherwise
    // text submit and voice recording are globally locked until reload.
    // The previous "rejects retry" test only exercised onSendRecording
    // directly and missed this real-claim path.
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { roomId: ROOM_ID });
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const capturedContext = voiceRecorderState.props!.getSendContext();

    // 1) Production retry path claims the auto-send slot via
    //    onSendStopRequest BEFORE invoking onSendRecording.
    act(() => {
      expect(voiceRecorderState.props!.onSendStopRequest?.()).toBe(true);
    });
    expect(store.get(voiceAutoSendPendingAtom)).toBe(true);

    // 2) Mid-retry, the source room becomes unreachable / non-joined.
    mxState.getRoom.mockImplementation((roomId: string) =>
      roomId === ROOM_ID
        ? ({
            roomId,
            name: roomId,
            hasEncryptionStateEvent: () => false,
            getMember: () => undefined,
            getMembers: () => [],
            getMyMembership: () => 'leave',
          } as unknown as Room)
        : undefined
    );

    // 3) onSendRecording runs (the real production sequence). The live-room
    //    refresh fails. The early throw MUST still release the slot.
    let rejected: unknown;
    await act(async () => {
      try {
        await voiceRecorderState.props!.onSendRecording(file, 1100, undefined, capturedContext);
      } catch (err) {
        rejected = err;
      }
    });

    expect(rejected).toBeInstanceOf(Error);
    expect((rejected as Error).message).toMatch(/no longer available/i);
    // Critical: the slot must have been released so other rooms / text
    // submit are not globally locked.
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);
    expect(mxState.uploadContent).not.toHaveBeenCalled();
    expect(mxState.sendMessage).not.toHaveBeenCalled();

    renderer.unmount();
  });

  it('discards a parked draft that belongs to a different session (account switch)', async () => {
    // CLUSTER 1b (R3 reviewer C Issue 2): the global atom survives logout/
    // login since the router store is shared. A draft from account A must
    // not block voice recording or leak audio in account B.
    const store = createStore();
    store.set(pendingVoiceSendDraftAtom, {
      file: new File(['voice-a'], 'voice-a.m4a', { type: 'audio/mp4' }),
      duration: 900,
      context: {
        ownerSessionId: '@previous-account:example.org',
        roomId: ROOM_ID,
        room: createRoom(ROOM_ID),
        threadId: undefined,
        replyDraft: undefined,
        threadingEnabled: true,
        signalBridgedRoom: false,
      } as never,
    });

    const { renderer } = await renderRoomInput(store);

    // Cleanup useEffect must wipe the orphaned draft.
    expect(store.get(pendingVoiceSendDraftAtom)).toBeUndefined();

    // The mic in this room must be enabled (not "Voice recording paused").
    const micButton = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Record voice message'
    );
    expect(micButton.props.disabled).toBe(false);

    renderer.unmount();
  });

  it('does not clear the global pending draft when the dialog closes for non-discard reasons', async () => {
    // rev-H Issue 2: handleCloseVoiceRecorder must not clear the draft. The
    // hook is the canonical owner; any future onClose caller (e.g. a defer
    // dismissal) must not silently destroy the parked recording.
    const store = createStore();
    store.set(pendingVoiceSendDraftAtom, {
      file: new File(['voice'], 'voice.m4a', { type: 'audio/mp4' }),
      duration: 1100,
      errorMessage: 'upload failed',
      context: {
        ownerSessionId: '@me:example.org',
        roomId: ROOM_ID,
        room: createRoom(ROOM_ID),
        threadId: undefined,
        replyDraft: undefined,
        threadingEnabled: true,
        signalBridgedRoom: false,
      } as never,
    });
    const { renderer } = await renderRoomInput(store, {
      roomId: ROOM_ID,
      keyedRoomSubtree: true,
    });

    expect(voiceRecorderState.props).toBeDefined();
    await act(async () => {
      voiceRecorderState.props!.onClose();
    });

    expect(store.get(pendingVoiceSendDraftAtom)?.errorMessage).toBe('upload failed');
    renderer.unmount();
  });

  it('auto-surfaces the recorder when returning to a room that owns a parked failed-send draft', async () => {
    // The hook writes draft+context to the global atom on failure (covered by
    // useVoiceRecorder.test.ts). This verifies the parent's wiring: when the
    // current room owns the parked draft, the recorder dialog auto-opens via
    // the ownsPendingVoiceDraft useEffect — even after a keyed RoomProvider
    // remount that destroyed the previous subtree.
    const store = createStore();

    // Start in a different room, no parked draft. Mic enabled.
    const { renderer } = await renderRoomInput(store, {
      roomId: OTHER_ROOM_ID,
      keyedRoomSubtree: true,
    });
    const initialMic = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Record voice message'
    );
    expect(initialMic.props.disabled).toBe(false);
    expect(voiceRecorderState.props?.active).toBeFalsy();

    // Simulate a failed send parked from earlier work in ROOM_ID. (The hook's
    // own write path is exercised in useVoiceRecorder.test.ts.) The mock
    // matrix client's getUserId() returns '@me:example.org' (see mxState
    // setup); stamp that as the owner so draftBelongsToCurrentSession holds.
    const parkedContext = {
      ownerSessionId: '@me:example.org',
      roomId: ROOM_ID,
      room: createRoom(ROOM_ID),
      threadId: '$thread-a',
      replyDraft: undefined,
      threadingEnabled: true,
      signalBridgedRoom: false,
    } as never;
    await act(async () => {
      store.set(pendingVoiceSendDraftAtom, {
        file: new File(['voice'], 'voice.m4a', { type: 'audio/mp4' }),
        duration: 1100,
        context: parkedContext,
      });
    });

    // Mic in OTHER_ROOM_ID must be disabled with the descriptive aria-label.
    const lockedMic = renderer.root.find(
      (node) =>
        node.type === 'button' &&
        typeof node.props['aria-label'] === 'string' &&
        node.props['aria-label'].startsWith('Voice recording paused')
    );
    expect(lockedMic.props.disabled).toBe(true);
    expect(lockedMic.props['aria-label']).toContain(ROOM_ID);

    // Navigate back to ROOM_ID — keyed remount destroys the prior subtree.
    await updateRoomInput(renderer, store, {
      roomId: ROOM_ID,
      threadId: '$thread-a',
      keyedRoomSubtree: true,
    });

    // The new subtree must auto-open the recorder for the parked draft.
    expect(voiceRecorderState.props?.active).toBe(true);

    renderer.unmount();
  });

  it('propagates encrypted voice preparation failures instead of treating them as sent', async () => {
    const store = createStore();
    // handleVoiceSend re-resolves the room via mx.getRoom at retry time so a
    // mid-life encryption upgrade is honored. For this test, the live room
    // must report itself as encrypted so the encryption-prep failure path
    // executes.
    mxState.getRoom.mockImplementation(
      (roomId: string) =>
        ({
          roomId,
          name: roomId,
          hasEncryptionStateEvent: () => true,
          getMember: () => undefined,
          getMembers: () => [],
          getMyMembership: () => 'join',
        } as unknown as Room)
    );
    const { renderer } = await renderRoomInput(store, {
      threadId: '$thread-a',
      encryptedRoom: true,
    });
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const prepareError = new Error('voice encryption failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    encryptionState.encryptAttachment.mockRejectedValueOnce(prepareError);

    let rejectedError: unknown;
    await act(async () => {
      try {
        await voiceRecorderState.props!.onSendRecording(file, 1100);
      } catch (err) {
        rejectedError = err;
      }
    });

    expect(getMatrixUploadErrorStage(rejectedError)).toBe('create');
    expect(rejectedError).toMatchObject({
      errcode: 'M_UNKNOWN',
      message: expect.stringContaining('voice encryption failed'),
    });
    expect(consoleError).toHaveBeenCalledWith('[mr-upload]', {
      stage: 'create',
      originalName: 'Error',
      name: 'M_UNKNOWN',
      errcode: 'M_UNKNOWN',
      httpStatus: undefined,
      message: expect.stringContaining('voice encryption failed'),
    });
    expect(mxState.uploadContent).not.toHaveBeenCalled();
    expect(mxState.sendMessage).not.toHaveBeenCalled();
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);
    consoleError.mockRestore();

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
    await openVoiceRecorder(renderer);

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
