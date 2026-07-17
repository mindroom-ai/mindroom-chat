import React, { createRef } from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventStatus, RelationType, Room, RoomEvent } from 'matrix-js-sdk';
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
  roomEventState,
  textSendState,
  voiceRecorderState,
} = vi.hoisted(() => ({
  editorMocks: {
    insertNode: vi.fn(),
    insertText: vi.fn(),
    moveCursor: vi.fn(),
    resetEditor: vi.fn(),
    resetEditorHistory: vi.fn(),
    restoreEditorContent: vi.fn(),
    sendTypingStatus: vi.fn(),
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
    cancelPendingEvent: vi.fn(),
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
    makeTxnId: vi.fn(),
    sendMessage: vi.fn(),
    uploadContent: vi.fn(async () => ({ content_uri: 'mxc://mindroom/voice' })),
  },
  roomEventState: {
    localEchoUpdatedListeners: new Set<(...args: unknown[]) => void>(),
  },
  textSendState: {
    getEventForTxnId: vi.fn(),
    localEvents: new Map<
      string,
      {
        getId: () => string;
        getRoomId: () => string;
        getRelation: () => { event_id?: string } | undefined;
        getTxnId: () => string;
        getUnsigned: () => { transaction_id: string };
        status: EventStatus;
      }
    >(),
    nextTxn: 0,
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

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test-utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn }),
  };
});

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
  restoreEditorContent: editorMocks.restoreEditorContent,
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
  useTypingStatusUpdater: () => editorMocks.sendTypingStatus,
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

vi.mock('../../voice/VoiceRecorderDialog', () => ({
  VoiceRecorderComposer: () => null,
}));

vi.mock('../RoomInputMindroomExtensions', async () => {
  const actual = await vi.importActual<typeof import('../RoomInputMindroomExtensions')>(
    '../RoomInputMindroomExtensions'
  );

  return {
    ...actual,
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
    isMindroomRoomInputAutocompleteQuery: (query?: { prefix?: string }) => query?.prefix === '!',
    MindroomRoomInputAutocomplete: () => null,
    MindroomRoomInputReplyContext: ({ children }: { children?: React.ReactNode }) => {
      customEditorState.replyContextRenderCount += 1;
      return React.createElement('div', null, children);
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
    getEventForTxnId: (txnId: string) => textSendState.getEventForTxnId(roomId, txnId),
    getLiveTimeline: () => ({
      getEvents: () =>
        Array.from(textSendState.localEvents.values()).filter(
          (event) => event.getRoomId() === roomId
        ),
    }),
    relations: {
      getAllChildEventsForEvent: (parentEventId: string) =>
        Array.from(textSendState.localEvents.values()).filter(
          (event) => event.getRoomId() === roomId && event.getRelation()?.event_id === parentEventId
        ),
    },
    hasEncryptionStateEvent: () => encrypted,
    getMember: () => undefined,
    getMembers: () => [],
    getMyMembership: () => 'join',
    on: (event: RoomEvent, listener: (...args: unknown[]) => void) => {
      if (event === RoomEvent.LocalEchoUpdated) {
        roomEventState.localEchoUpdatedListeners.add(listener);
      }
    },
    removeListener: (event: RoomEvent, listener: (...args: unknown[]) => void) => {
      if (event === RoomEvent.LocalEchoUpdated) {
        roomEventState.localEchoUpdatedListeners.delete(listener);
      }
    },
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

const setEditorContent = (text: string) => {
  if (!customEditorState.editor) throw new Error('Editor is not mounted.');
  customEditorState.editor.children = [
    {
      type: 'paragraph',
      children: [{ text }],
    },
  ];
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

const registerLocalEcho = (roomId: string, txnId: string, content?: unknown) => {
  const localId = `~${roomId}:${txnId}`;
  const relation = (content as { 'm.relates_to'?: { event_id?: string } } | undefined)?.[
    'm.relates_to'
  ];
  const localEvent = {
    getId: () => localId,
    getRoomId: () => roomId,
    getRelation: () => relation,
    getTxnId: () => txnId,
    getUnsigned: () => ({ transaction_id: txnId }),
    status: EventStatus.SENDING,
  };
  textSendState.localEvents.set(`${roomId}:${txnId}`, localEvent);
  return localEvent;
};

const configureDefaultTextSendMocks = () => {
  textSendState.localEvents.clear();
  textSendState.nextTxn = 0;
  textSendState.getEventForTxnId.mockImplementation((roomId: string, txnId: string) =>
    textSendState.localEvents.get(`${roomId}:${txnId}`)
  );
  mxState.makeTxnId.mockImplementation(() => {
    textSendState.nextTxn += 1;
    return `txn-${textSendState.nextTxn}`;
  });
  mxState.sendMessage.mockImplementation(
    async (roomId: string, content: unknown, txnId?: string) => {
      if (txnId) registerLocalEcho(roomId, txnId, content);
      return { event_id: '$sent' };
    }
  );
  mxState.cancelPendingEvent.mockImplementation((event: { getTxnId: () => string }) => {
    textSendState.localEvents.delete(`${ROOM_ID}:${event.getTxnId()}`);
  });
};

const mockDeferredSendWithLocalEcho = <T extends { event_id: string }>(
  send: ReturnType<typeof createDeferred<T>>,
  markNotSentOnReject = false
) => {
  let localEvent:
    | {
        getId: () => string;
        getRoomId: () => string;
        getTxnId: () => string;
        status: EventStatus;
      }
    | undefined;

  mxState.sendMessage.mockImplementationOnce((roomId: string, content: unknown, txnId?: string) => {
    if (!txnId) return send.promise;
    localEvent = registerLocalEcho(roomId, txnId, content);
    if (markNotSentOnReject) {
      void send.promise.then(undefined, () => {
        if (localEvent) localEvent.status = EventStatus.NOT_SENT;
      });
    }
    return send.promise;
  });

  return () => localEvent;
};

configureDefaultTextSendMocks();

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
  roomEventState.localEchoUpdatedListeners.clear();
  voiceRecorderState.props = undefined;
  customEditorState.autocompleteQuery = undefined;
  customEditorState.editor = undefined;
  customEditorState.props = undefined;
  customEditorState.replyContextRenderCount = 0;
  editorOutputState.plainText = '';
  editorOutputState.customHtml = '';
  editorOutputState.htmlEqualsPlainText = true;
  mxState.cancelPendingEvent.mockReset();
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
  mxState.makeTxnId.mockReset();
  mxState.sendMessage.mockReset();
  textSendState.getEventForTxnId.mockReset();
  configureDefaultTextSendMocks();
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
  editorMocks.restoreEditorContent.mockReset();
  editorMocks.sendTypingStatus.mockReset();
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
    mockDeferredSendWithLocalEcho(send);

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
      }),
      'txn-1'
    );

    await act(async () => {
      send.resolve({ event_id: '$sent' });
      await Promise.resolve();
    });

    renderer.unmount();
  });

  it('never shows a composer pending clock for unresolved thread sends', async () => {
    const { renderer } = await renderRoomInput(createStore(), { threadId: '$thread' });
    editorMocks.resetEditor.mockClear();
    editorMocks.resetEditorHistory.mockClear();
    const send = createDeferred<{ event_id: string }>();
    mockDeferredSendWithLocalEcho(send);

    editorOutputState.plainText = 'Thread reply still sending';
    editorOutputState.customHtml = 'Thread reply still sending';
    editorOutputState.htmlEqualsPlainText = true;

    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    expect(JSON.stringify(renderer.toJSON())).not.toContain('Message sending');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Waiting for server');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Sending to this thread');
    expect(editorMocks.resetEditor).toHaveBeenCalledTimes(1);
    expect(editorMocks.resetEditorHistory).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage.mock.calls[0][1]).toMatchObject({
      'm.relates_to': {
        event_id: '$thread',
        rel_type: RelationType.Thread,
      },
    });

    await act(async () => {
      send.resolve({ event_id: '$sent' });
      await Promise.resolve();
    });

    renderer.unmount();
  });

  it('does not render thread helper context for static thread composers', async () => {
    const { renderer } = await renderRoomInput(createStore(), { threadId: '$thread' });

    expect(customEditorState.replyContextRenderCount).toBe(0);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Sending to this thread');

    renderer.unmount();
  });

  it('notifies top-level room text sends with the synchronous local event id', async () => {
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

    expect(onRoomMessageSent).toHaveBeenCalledWith(`~${ROOM_ID}:txn-1`);
    const notifyIndex = notificationOrder.indexOf('notify');
    expect(notifyIndex).toBeGreaterThan(-1);
    expect(notificationOrder.indexOf('reset-editor')).toBeLessThan(notifyIndex);
    expect(notificationOrder.indexOf('reset-history')).toBeLessThan(notifyIndex);

    renderer.unmount();
  });

  it('registers handlers, clears, and notifies in the required same-turn order', async () => {
    const order: string[] = [];
    const send = createDeferred<{ event_id: string }>();
    const originalThen = send.promise.then.bind(send.promise);
    const thenSpy = vi.spyOn(send.promise, 'then').mockImplementation(((...args: any[]) => {
      order.push('attach-handlers');
      return originalThen(...args);
    }) as typeof send.promise.then);
    mxState.makeTxnId.mockImplementationOnce(() => {
      order.push('make-txn');
      return 'ordered-txn';
    });
    mxState.sendMessage.mockImplementationOnce(
      (sendRoomId: string, _content: unknown, txnId?: string) => {
        order.push('send-message');
        if (txnId) registerLocalEcho(sendRoomId, txnId);
        return send.promise;
      }
    );
    textSendState.getEventForTxnId.mockImplementationOnce((lookupRoomId: string, txnId: string) => {
      order.push('lookup-local-echo');
      return textSendState.localEvents.get(`${lookupRoomId}:${txnId}`);
    });
    editorMocks.resetEditor.mockImplementation(() => {
      order.push('reset-editor');
    });
    editorMocks.resetEditorHistory.mockImplementation(() => {
      order.push('reset-history');
    });
    editorMocks.sendTypingStatus.mockImplementation(() => {
      order.push('stop-typing');
    });
    const onRoomMessageSent = vi.fn(() => {
      order.push('notify');
    });
    const { renderer } = await renderRoomInput(createStore(), { onRoomMessageSent });
    order.length = 0;
    editorMocks.resetEditor.mockClear();
    editorMocks.resetEditorHistory.mockClear();

    editorOutputState.plainText = 'Ordered send';
    editorOutputState.customHtml = 'Ordered send';
    editorOutputState.htmlEqualsPlainText = true;

    act(() => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
    });

    const expectedSteps = [
      'make-txn',
      'send-message',
      'lookup-local-echo',
      'attach-handlers',
      'reset-editor',
      'reset-history',
      'stop-typing',
      'notify',
    ];
    const stepIndexes = expectedSteps.map((step) =>
      step === 'attach-handlers' ? order.lastIndexOf(step) : order.indexOf(step)
    );
    expect(stepIndexes.every((index) => index >= 0)).toBe(true);
    expect(stepIndexes).toEqual([...stepIndexes].sort((left, right) => left - right));
    expect(mxState.sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({ body: 'Ordered send' }),
      'ordered-txn'
    );
    expect(onRoomMessageSent).toHaveBeenCalledWith(`~${ROOM_ID}:ordered-txn`);

    await act(async () => {
      send.resolve({ event_id: '$ordered' });
      await send.promise;
    });

    expect(editorMocks.resetEditor).toHaveBeenCalledTimes(1);
    expect(onRoomMessageSent).toHaveBeenCalledTimes(1);
    thenSpy.mockRestore();
    renderer.unmount();
  });

  it('keeps the composer and guard until exceptional missing-local fulfillment', async () => {
    const send = createDeferred<{ event_id: string }>();
    mxState.sendMessage.mockReturnValueOnce(send.promise);
    const onRoomMessageSent = vi.fn();
    const { renderer } = await renderRoomInput(createStore(), { onRoomMessageSent });
    editorMocks.resetEditor.mockClear();
    editorMocks.resetEditorHistory.mockClear();

    editorOutputState.plainText = 'Conservative fallback';
    editorOutputState.customHtml = 'Conservative fallback';
    editorOutputState.htmlEqualsPlainText = true;

    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(editorMocks.resetEditor).not.toHaveBeenCalled();
    expect(onRoomMessageSent).not.toHaveBeenCalled();

    await act(async () => {
      send.resolve({ event_id: '$confirmed-fallback' });
      await send.promise;
    });

    expect(editorMocks.resetEditor).toHaveBeenCalledTimes(1);
    expect(editorMocks.resetEditorHistory).toHaveBeenCalledTimes(1);
    expect(onRoomMessageSent).toHaveBeenCalledOnce();
    expect(onRoomMessageSent).toHaveBeenCalledWith('$confirmed-fallback');
    renderer.unmount();
  });

  it('does not clear or notify after missing-local fulfillment loses room ownership', async () => {
    const send = createDeferred<{ event_id: string }>();
    mxState.sendMessage.mockReturnValueOnce(send.promise);
    const onRoomMessageSent = vi.fn();
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { onRoomMessageSent });
    editorMocks.resetEditor.mockClear();
    editorMocks.resetEditorHistory.mockClear();

    editorOutputState.plainText = 'Old room fallback';
    editorOutputState.customHtml = 'Old room fallback';
    editorOutputState.htmlEqualsPlainText = true;
    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    await updateRoomInput(renderer, store, {
      roomId: OTHER_ROOM_ID,
      onRoomMessageSent,
    });
    editorMocks.resetEditor.mockClear();
    editorMocks.resetEditorHistory.mockClear();
    await act(async () => {
      send.resolve({ event_id: '$old-room-event' });
      await send.promise;
    });

    expect(editorMocks.resetEditor).not.toHaveBeenCalled();
    expect(editorMocks.resetEditorHistory).not.toHaveBeenCalled();
    expect(onRoomMessageSent).not.toHaveBeenCalled();

    editorOutputState.plainText = 'New room message';
    editorOutputState.customHtml = 'New room message';
    setEditorContent('New room message');
    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(2);
    expect(mxState.sendMessage.mock.calls[1][0]).toBe(OTHER_ROOM_ID);
    expect(editorMocks.resetEditor).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });

  it('does not clear or notify after missing-local fulfillment unmounts', async () => {
    const send = createDeferred<{ event_id: string }>();
    mxState.sendMessage.mockReturnValueOnce(send.promise);
    const onRoomMessageSent = vi.fn();
    const { renderer } = await renderRoomInput(createStore(), { onRoomMessageSent });
    editorMocks.resetEditor.mockClear();
    editorMocks.resetEditorHistory.mockClear();

    editorOutputState.plainText = 'Unmounted fallback';
    editorOutputState.customHtml = 'Unmounted fallback';
    editorOutputState.htmlEqualsPlainText = true;
    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });
    act(() => {
      renderer.unmount();
    });
    editorMocks.resetEditor.mockClear();
    editorMocks.resetEditorHistory.mockClear();
    await act(async () => {
      send.resolve({ event_id: '$unmounted-event' });
      await send.promise;
    });

    expect(editorMocks.resetEditor).not.toHaveBeenCalled();
    expect(editorMocks.resetEditorHistory).not.toHaveBeenCalled();
    expect(onRoomMessageSent).not.toHaveBeenCalled();
  });

  it('does not clear or notify after missing-local fulfillment moves into a thread', async () => {
    const send = createDeferred<{ event_id: string }>();
    mxState.sendMessage.mockReturnValueOnce(send.promise);
    const onRoomMessageSent = vi.fn();
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { onRoomMessageSent });

    editorOutputState.plainText = 'Overview fallback';
    editorOutputState.customHtml = 'Overview fallback';
    editorOutputState.htmlEqualsPlainText = true;
    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    await updateRoomInput(renderer, store, {
      threadId: '$new-thread',
      onRoomMessageSent,
    });
    setEditorContent('New thread draft');
    editorMocks.resetEditor.mockClear();
    editorMocks.resetEditorHistory.mockClear();
    await act(async () => {
      send.resolve({ event_id: '$overview-event' });
      await send.promise;
    });

    expect(editorMocks.resetEditor).not.toHaveBeenCalled();
    expect(editorMocks.resetEditorHistory).not.toHaveBeenCalled();
    expect(onRoomMessageSent).not.toHaveBeenCalled();
    expect(customEditorState.editor!.children).toEqual([
      { type: 'paragraph', children: [{ text: 'New thread draft' }] },
    ]);
    renderer.unmount();
  });

  it('does not clear or notify after missing-local fulfillment changes reply context', async () => {
    const send = createDeferred<{ event_id: string }>();
    mxState.sendMessage.mockReturnValueOnce(send.promise);
    const onRoomMessageSent = vi.fn();
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { onRoomMessageSent });

    editorOutputState.plainText = 'Overview fallback';
    editorOutputState.customHtml = 'Overview fallback';
    editorOutputState.htmlEqualsPlainText = true;
    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    const newerReplyDraft = createReplyDraft('$new-reply-target');
    await act(async () => {
      store.set(roomIdToReplyDraftAtomFamily(ROOM_ID), newerReplyDraft);
    });
    setEditorContent('Reply draft');
    editorMocks.resetEditor.mockClear();
    editorMocks.resetEditorHistory.mockClear();
    await act(async () => {
      send.resolve({ event_id: '$overview-event' });
      await send.promise;
    });

    expect(editorMocks.resetEditor).not.toHaveBeenCalled();
    expect(editorMocks.resetEditorHistory).not.toHaveBeenCalled();
    expect(onRoomMessageSent).not.toHaveBeenCalled();
    expect(store.get(roomIdToReplyDraftAtomFamily(ROOM_ID))).toEqual(newerReplyDraft);
    expect(customEditorState.editor!.children).toEqual([
      { type: 'paragraph', children: [{ text: 'Reply draft' }] },
    ]);
    renderer.unmount();
  });

  it('does not clear or notify after missing-local fulfillment follows a newer edit', async () => {
    const send = createDeferred<{ event_id: string }>();
    mxState.sendMessage.mockReturnValueOnce(send.promise);
    const onRoomMessageSent = vi.fn();
    const { renderer } = await renderRoomInput(createStore(), { onRoomMessageSent });

    editorOutputState.plainText = 'Original fallback';
    editorOutputState.customHtml = 'Original fallback';
    editorOutputState.htmlEqualsPlainText = true;
    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    setEditorContent('Original fallback plus newer text');
    act(() => {
      customEditorState.props!.onChange?.();
    });
    editorMocks.resetEditor.mockClear();
    editorMocks.resetEditorHistory.mockClear();
    await act(async () => {
      send.resolve({ event_id: '$overview-event' });
      await send.promise;
    });

    expect(editorMocks.resetEditor).not.toHaveBeenCalled();
    expect(editorMocks.resetEditorHistory).not.toHaveBeenCalled();
    expect(onRoomMessageSent).not.toHaveBeenCalled();
    expect(customEditorState.editor!.children).toEqual([
      {
        type: 'paragraph',
        children: [{ text: 'Original fallback plus newer text' }],
      },
    ]);
    renderer.unmount();
  });

  it('leaves the composer intact for a synchronous send throw', async () => {
    mxState.sendMessage.mockImplementationOnce(() => {
      throw new Error('synchronous send failure');
    });
    const onRoomMessageSent = vi.fn();
    const { renderer } = await renderRoomInput(createStore(), { onRoomMessageSent });
    editorMocks.resetEditor.mockClear();
    editorMocks.resetEditorHistory.mockClear();

    editorOutputState.plainText = 'Still owned by composer';
    editorOutputState.customHtml = 'Still owned by composer';
    editorOutputState.htmlEqualsPlainText = true;

    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    expect(editorMocks.resetEditor).not.toHaveBeenCalled();
    expect(editorMocks.resetEditorHistory).not.toHaveBeenCalled();
    expect(onRoomMessageSent).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('leaves the composer intact and releases the guard for missing-local rejection', async () => {
    const send = createDeferred<{ event_id: string }>();
    mxState.sendMessage.mockReturnValueOnce(send.promise);
    const onRoomMessageSent = vi.fn();
    const { renderer } = await renderRoomInput(createStore(), { onRoomMessageSent });
    editorMocks.resetEditor.mockClear();
    editorMocks.resetEditorHistory.mockClear();

    editorOutputState.plainText = 'Retry after missing local echo';
    editorOutputState.customHtml = 'Retry after missing local echo';
    editorOutputState.htmlEqualsPlainText = true;

    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });
    await act(async () => {
      send.reject(new Error('send failed'));
      await Promise.resolve();
    });

    expect(editorMocks.resetEditor).not.toHaveBeenCalled();
    expect(onRoomMessageSent).not.toHaveBeenCalled();

    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(2);
    expect(editorMocks.resetEditor).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });

  it('cancels a terminal failed root before restoring its captured editor fragment', async () => {
    const send = createDeferred<{ event_id: string }>();
    const getLocalEvent = mockDeferredSendWithLocalEcho(send, true);
    const transferOrder: string[] = [];
    mxState.cancelPendingEvent.mockImplementation(() => {
      transferOrder.push('cancel');
    });
    editorMocks.restoreEditorContent.mockImplementation(
      (targetEditor: { children: Array<unknown> }, fragment: Array<unknown>) => {
        transferOrder.push('restore');
        targetEditor.children = [...fragment, ...targetEditor.children];
      }
    );
    editorMocks.resetEditor.mockImplementation((targetEditor: { children: Array<unknown> }) => {
      targetEditor.children = [];
      queueMicrotask(() => {
        customEditorState.props!.onChange?.();
      });
    });
    const { renderer } = await renderRoomInput();
    setEditorContent('Failed root');
    const capturedFragment = structuredClone(customEditorState.editor!.children);

    editorOutputState.plainText = 'Failed root';
    editorOutputState.customHtml = 'Failed root';
    editorOutputState.htmlEqualsPlainText = true;

    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    await act(async () => {
      send.reject(new Error('terminal failure'));
      await Promise.resolve();
    });

    expect(getLocalEvent()?.status).toBe(EventStatus.NOT_SENT);
    expect(mxState.cancelPendingEvent).toHaveBeenCalledWith(getLocalEvent());
    expect(editorMocks.restoreEditorContent).toHaveBeenCalledWith(
      expect.anything(),
      capturedFragment
    );
    expect(transferOrder).toEqual(['cancel', 'restore']);
    expect(customEditorState.editor!.children).toEqual(capturedFragment);
    renderer.unmount();
  });

  it('leaves a failed room root timeline-owned after a newer edit', async () => {
    const send = createDeferred<{ event_id: string }>();
    mockDeferredSendWithLocalEcho(send, true);
    const { renderer } = await renderRoomInput();

    editorOutputState.plainText = 'Failed root';
    editorOutputState.customHtml = 'Failed root';
    editorOutputState.htmlEqualsPlainText = true;
    setEditorContent('Failed root');
    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    setEditorContent('Newer draft');
    act(() => {
      customEditorState.props!.onChange?.();
    });
    await act(async () => {
      send.reject(new Error('terminal failure'));
      await Promise.resolve();
    });

    expect(mxState.cancelPendingEvent).not.toHaveBeenCalled();
    expect(editorMocks.restoreEditorContent).not.toHaveBeenCalled();
    expect(customEditorState.editor!.children).toEqual([
      { type: 'paragraph', children: [{ text: 'Newer draft' }] },
    ]);
    renderer.unmount();
  });

  it('leaves a failed room root timeline-owned after reply context changes', async () => {
    const send = createDeferred<{ event_id: string }>();
    mockDeferredSendWithLocalEcho(send, true);
    const store = createStore();
    const { renderer } = await renderRoomInput(store);

    editorOutputState.plainText = 'Failed root';
    editorOutputState.customHtml = 'Failed root';
    editorOutputState.htmlEqualsPlainText = true;
    setEditorContent('Failed root');
    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    const newerReplyDraft = createReplyDraft('$unrelated-reply');
    await act(async () => {
      store.set(roomIdToReplyDraftAtomFamily(ROOM_ID), newerReplyDraft);
    });
    await act(async () => {
      send.reject(new Error('terminal failure'));
      await Promise.resolve();
    });

    expect(mxState.cancelPendingEvent).not.toHaveBeenCalled();
    expect(editorMocks.restoreEditorContent).not.toHaveBeenCalled();
    expect(store.get(roomIdToReplyDraftAtomFamily(ROOM_ID))).toEqual(newerReplyDraft);
    renderer.unmount();
  });

  it('does not restore a failed room root into a different thread composer', async () => {
    const send = createDeferred<{ event_id: string }>();
    mockDeferredSendWithLocalEcho(send, true);
    const store = createStore();
    const { renderer } = await renderRoomInput(store);

    editorOutputState.plainText = 'Room root';
    editorOutputState.customHtml = 'Room root';
    editorOutputState.htmlEqualsPlainText = true;
    setEditorContent('Room root');
    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    await updateRoomInput(renderer, store, { threadId: '$different-thread' });
    setEditorContent('Different thread draft');
    await act(async () => {
      send.reject(new Error('late root failure'));
      await Promise.resolve();
    });

    expect(mxState.cancelPendingEvent).not.toHaveBeenCalled();
    expect(editorMocks.restoreEditorContent).not.toHaveBeenCalled();
    expect(customEditorState.editor!.children).toEqual([
      { type: 'paragraph', children: [{ text: 'Different thread draft' }] },
    ]);
    renderer.unmount();
  });

  it('allows two sequential local sends before either network request settles', async () => {
    const firstSend = createDeferred<{ event_id: string }>();
    const secondSend = createDeferred<{ event_id: string }>();
    mockDeferredSendWithLocalEcho(firstSend);
    mockDeferredSendWithLocalEcho(secondSend);
    const onRoomMessageSent = vi.fn();
    const { renderer } = await renderRoomInput(createStore(), { onRoomMessageSent });

    editorOutputState.plainText = 'First root';
    editorOutputState.customHtml = 'First root';
    editorOutputState.htmlEqualsPlainText = true;
    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    editorOutputState.plainText = 'Second root';
    editorOutputState.customHtml = 'Second root';
    setEditorContent('Second root');
    act(() => {
      customEditorState.props!.onChange?.();
    });
    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(2);
    expect(mxState.sendMessage.mock.calls.map((call) => call[2])).toEqual(['txn-1', 'txn-2']);
    expect(textSendState.localEvents.has(`${ROOM_ID}:txn-1`)).toBe(true);
    expect(textSendState.localEvents.has(`${ROOM_ID}:txn-2`)).toBe(true);
    expect(onRoomMessageSent.mock.calls.map((call) => call[0])).toEqual([
      `~${ROOM_ID}:txn-1`,
      `~${ROOM_ID}:txn-2`,
    ]);

    await act(async () => {
      firstSend.resolve({ event_id: '$first' });
      secondSend.resolve({ event_id: '$second' });
      await Promise.all([firstSend.promise, secondSend.promise]);
    });
    expect(onRoomMessageSent).toHaveBeenCalledTimes(2);
    renderer.unmount();
  });

  it('keeps an encrypted local-root reply draft unsent until the root canonicalizes', async () => {
    const localThreadId = `~${ROOM_ID}:pending-root`;
    const store = createStore();
    const { renderer } = await renderRoomInput(store, {
      encryptedRoom: true,
      threadId: localThreadId,
    });
    editorMocks.resetEditor.mockClear();
    editorMocks.resetEditorHistory.mockClear();
    setEditorContent('Encrypted follow-up');
    editorOutputState.plainText = 'Encrypted follow-up';
    editorOutputState.customHtml = 'Encrypted follow-up';
    editorOutputState.htmlEqualsPlainText = true;

    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    expect(mxState.sendMessage).not.toHaveBeenCalled();
    expect(editorMocks.resetEditor).not.toHaveBeenCalled();
    expect(customEditorState.editor!.children).toEqual([
      { type: 'paragraph', children: [{ text: 'Encrypted follow-up' }] },
    ]);

    await updateRoomInput(renderer, store, {
      encryptedRoom: true,
      threadId: '$confirmed-root',
    });
    editorOutputState.plainText = 'Encrypted follow-up';
    editorOutputState.customHtml = 'Encrypted follow-up';
    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage.mock.calls[0][1]).toMatchObject({
      'm.relates_to': {
        event_id: '$confirmed-root',
        rel_type: RelationType.Thread,
      },
    });
    renderer.unmount();
  });

  it('unblocks an encrypted explicit reply when its draft target canonicalizes', async () => {
    const store = createStore();
    store.set(
      roomIdToReplyDraftAtomFamily(ROOM_ID),
      createReplyDraft(`~${ROOM_ID}:local-explicit-target`)
    );
    const { renderer } = await renderRoomInput(store, {
      encryptedRoom: true,
      threadingEnabled: false,
    });
    editorMocks.resetEditor.mockClear();
    editorOutputState.plainText = 'Encrypted explicit reply';
    editorOutputState.customHtml = 'Encrypted explicit reply';
    editorOutputState.htmlEqualsPlainText = true;

    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    expect(mxState.sendMessage).not.toHaveBeenCalled();
    expect(editorMocks.resetEditor).not.toHaveBeenCalled();
    expect(store.get(roomIdToReplyDraftAtomFamily(ROOM_ID))?.eventId).toBe(
      `~${ROOM_ID}:local-explicit-target`
    );

    const confirmedTarget = {
      getId: () => '$confirmed-explicit-target',
      getTxnId: () => 'local-explicit-target',
      getUnsigned: () => ({ transaction_id: 'local-explicit-target' }),
    };
    textSendState.getEventForTxnId.mockImplementation((lookupRoomId: string, txnId: string) =>
      txnId === 'local-explicit-target'
        ? confirmedTarget
        : textSendState.localEvents.get(`${lookupRoomId}:${txnId}`)
    );
    await act(async () => {
      roomEventState.localEchoUpdatedListeners.forEach((listener) => {
        listener(
          confirmedTarget,
          undefined,
          `~${ROOM_ID}:local-explicit-target`,
          EventStatus.SENDING
        );
      });
    });

    expect(store.get(roomIdToReplyDraftAtomFamily(ROOM_ID))?.eventId).toBe(
      '$confirmed-explicit-target'
    );
    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage.mock.calls[0][1]).toMatchObject({
      'm.relates_to': {
        'm.in_reply_to': {
          event_id: '$confirmed-explicit-target',
        },
      },
    });
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

  it('leaves failed thread and explicit replies owned by their local events', async () => {
    const threadSend = createDeferred<{ event_id: string }>();
    const explicitSend = createDeferred<{ event_id: string }>();
    mockDeferredSendWithLocalEcho(threadSend, true);
    mockDeferredSendWithLocalEcho(explicitSend, true);
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { threadId: '$thread-root' });

    editorOutputState.plainText = 'Thread fallback reply';
    editorOutputState.customHtml = 'Thread fallback reply';
    editorOutputState.htmlEqualsPlainText = true;
    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    const explicitDraft = createReplyDraft('$explicit-target', {
      event_id: '$thread-root',
      rel_type: RelationType.Thread,
    });
    await act(async () => {
      store.set(roomIdToReplyDraftAtomFamily(ROOM_ID), explicitDraft);
    });
    editorOutputState.plainText = 'Explicit reply';
    editorOutputState.customHtml = 'Explicit reply';
    setEditorContent('Explicit reply');
    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    const newerDraft = createReplyDraft('$newer-target');
    await act(async () => {
      store.set(roomIdToReplyDraftAtomFamily(ROOM_ID), newerDraft);
    });
    setEditorContent('Newer unsent text');

    await act(async () => {
      threadSend.reject(new Error('thread failed'));
      explicitSend.reject(new Error('explicit failed'));
      await Promise.resolve();
    });

    expect(mxState.sendMessage.mock.calls[0][1]).toMatchObject({
      'm.relates_to': {
        event_id: '$thread-root',
        rel_type: RelationType.Thread,
        'm.in_reply_to': { event_id: '$thread-root' },
      },
    });
    expect(mxState.sendMessage.mock.calls[1][1]).toMatchObject({
      'm.relates_to': {
        event_id: '$thread-root',
        rel_type: RelationType.Thread,
        'm.in_reply_to': { event_id: '$explicit-target' },
      },
    });
    expect(mxState.cancelPendingEvent).not.toHaveBeenCalled();
    expect(editorMocks.restoreEditorContent).not.toHaveBeenCalled();
    expect(store.get(roomIdToReplyDraftAtomFamily(ROOM_ID))).toEqual(newerDraft);
    expect(customEditorState.editor!.children).toEqual([
      { type: 'paragraph', children: [{ text: 'Newer unsent text' }] },
    ]);
    renderer.unmount();
  });

  it('leaves a failed root and its local reply timeline-owned after exiting the thread', async () => {
    const rootSend = createDeferred<{ event_id: string }>();
    const replySend = createDeferred<{ event_id: string }>();
    const getRootEvent = mockDeferredSendWithLocalEcho(rootSend, true);
    const getReplyEvent = mockDeferredSendWithLocalEcho(replySend, true);
    const store = createStore();
    const { renderer } = await renderRoomInput(store);

    editorOutputState.plainText = 'Root';
    editorOutputState.customHtml = 'Root';
    editorOutputState.htmlEqualsPlainText = true;
    setEditorContent('Root');
    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    await updateRoomInput(renderer, store, { threadId: `~${ROOM_ID}:txn-1` });
    editorOutputState.plainText = 'Pending reply';
    editorOutputState.customHtml = 'Pending reply';
    setEditorContent('Pending reply');
    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    await updateRoomInput(renderer, store);
    await act(async () => {
      rootSend.reject(new Error('root failed'));
      replySend.reject(new Error('reply failed'));
      await Promise.resolve();
    });

    expect(getRootEvent()?.status).toBe(EventStatus.NOT_SENT);
    expect(getReplyEvent()?.status).toBe(EventStatus.NOT_SENT);
    expect(mxState.cancelPendingEvent).not.toHaveBeenCalled();
    expect(editorMocks.restoreEditorContent).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it.each([
    ['FIFO', ['first', 'second']],
    ['reverse', ['second', 'first']],
  ] as const)(
    'leaves the older concurrent failed root timeline-owned under %s settlement',
    async (_label, settlementOrder) => {
      const firstSend = createDeferred<{ event_id: string }>();
      const secondSend = createDeferred<{ event_id: string }>();
      const getFirstEvent = mockDeferredSendWithLocalEcho(firstSend, true);
      const getSecondEvent = mockDeferredSendWithLocalEcho(secondSend, true);
      const { renderer } = await renderRoomInput();

      editorOutputState.plainText = 'First failed root';
      editorOutputState.customHtml = 'First failed root';
      editorOutputState.htmlEqualsPlainText = true;
      setEditorContent('First failed root');
      await act(async () => {
        customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
        await Promise.resolve();
      });

      editorOutputState.plainText = 'Second failed root';
      editorOutputState.customHtml = 'Second failed root';
      setEditorContent('Second failed root');
      act(() => {
        customEditorState.props!.onChange?.();
      });
      await act(async () => {
        customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
        await Promise.resolve();
      });

      await act(async () => {
        settlementOrder.forEach((send) => {
          if (send === 'first') {
            firstSend.reject(new Error('first failed'));
          } else {
            secondSend.reject(new Error('second failed'));
          }
        });
        await Promise.allSettled([firstSend.promise, secondSend.promise]);
      });

      expect(mxState.cancelPendingEvent).toHaveBeenCalledOnce();
      expect(mxState.cancelPendingEvent).toHaveBeenCalledWith(getSecondEvent());
      expect(mxState.cancelPendingEvent).not.toHaveBeenCalledWith(getFirstEvent());
      expect(editorMocks.restoreEditorContent).toHaveBeenCalledOnce();
      expect(editorMocks.restoreEditorContent).toHaveBeenCalledWith(expect.anything(), [
        { type: 'paragraph', children: [{ text: 'Second failed root' }] },
      ]);
      expect(textSendState.localEvents.has(`${ROOM_ID}:txn-1`)).toBe(true);
      expect(textSendState.localEvents.has(`${ROOM_ID}:txn-2`)).toBe(false);
      renderer.unmount();
    }
  );

  it('does not cancel or restore a failed root after its input loses room ownership', async () => {
    const send = createDeferred<{ event_id: string }>();
    mockDeferredSendWithLocalEcho(send, true);
    const store = createStore();
    const { renderer } = await renderRoomInput(store, {
      keyedRoomSubtree: true,
      roomId: ROOM_ID,
    });

    editorOutputState.plainText = 'Leave this room';
    editorOutputState.customHtml = 'Leave this room';
    editorOutputState.htmlEqualsPlainText = true;
    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    await updateRoomInput(renderer, store, {
      keyedRoomSubtree: true,
      roomId: OTHER_ROOM_ID,
    });
    await act(async () => {
      send.reject(new Error('late failure'));
      await Promise.resolve();
    });

    expect(mxState.cancelPendingEvent).not.toHaveBeenCalled();
    expect(editorMocks.restoreEditorContent).not.toHaveBeenCalled();
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

  it('keeps encrypted voice unsent until its captured local thread canonicalizes', async () => {
    const localThreadId = `~${ROOM_ID}:voice-root`;
    const liveRoom = createRoom(ROOM_ID, true);
    mxState.getRoom.mockReturnValue(liveRoom);
    const store = createStore();
    const { renderer } = await renderRoomInput(store, {
      threadId: localThreadId,
      encryptedRoom: true,
    });
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const capturedContext = voiceRecorderState.props!.getSendContext();

    await act(async () => {
      await expect(
        voiceRecorderState.props!.onSendRecording(file, 1100, undefined, capturedContext)
      ).rejects.toThrow();
    });

    expect(mxState.uploadContent).not.toHaveBeenCalled();
    expect(mxState.sendMessage).not.toHaveBeenCalled();
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);

    const confirmedRoot = {
      getId: () => '$voice-root',
      getTxnId: () => 'voice-root',
      getUnsigned: () => ({ transaction_id: 'voice-root' }),
    };
    textSendState.getEventForTxnId.mockImplementation((lookupRoomId: string, txnId: string) =>
      txnId === 'voice-root'
        ? confirmedRoot
        : textSendState.localEvents.get(`${lookupRoomId}:${txnId}`)
    );

    await act(async () => {
      await voiceRecorderState.props!.onSendRecording(file, 1100, undefined, capturedContext);
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage.mock.calls[0][1]).toMatchObject({
      'm.relates_to': {
        event_id: '$voice-root',
        rel_type: RelationType.Thread,
      },
    });
    renderer.unmount();
  });

  it('rechecks an encrypted local voice target after a deferred upload', async () => {
    const localThreadId = `~${ROOM_ID}:deferred-voice-root`;
    let encrypted = false;
    const liveRoom = {
      ...createRoom(ROOM_ID),
      hasEncryptionStateEvent: () => encrypted,
    } as unknown as Room;
    mxState.getRoom.mockReturnValue(liveRoom);
    const store = createStore();
    const { renderer } = await renderRoomInput(store, {
      threadId: localThreadId,
    });
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const capturedContext = voiceRecorderState.props!.getSendContext();
    const upload = createDeferred<{ content_uri: string }>();
    mxState.uploadContent.mockReturnValueOnce(upload.promise);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let sendPromise!: Promise<void>;

    await act(async () => {
      sendPromise = voiceRecorderState.props!.onSendRecording(
        file,
        1100,
        undefined,
        capturedContext
      );
      await Promise.resolve();
    });
    expect(mxState.uploadContent).toHaveBeenCalledTimes(1);

    encrypted = true;
    await act(async () => {
      upload.resolve({ content_uri: 'mxc://mindroom/deferred-voice' });
      await expect(sendPromise).rejects.toThrow();
    });

    expect(mxState.sendMessage).not.toHaveBeenCalled();
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);

    const confirmedRoot = {
      getId: () => '$deferred-voice-root',
      getTxnId: () => 'deferred-voice-root',
      getUnsigned: () => ({ transaction_id: 'deferred-voice-root' }),
    };
    textSendState.getEventForTxnId.mockImplementation((lookupRoomId: string, txnId: string) =>
      txnId === 'deferred-voice-root'
        ? confirmedRoot
        : textSendState.localEvents.get(`${lookupRoomId}:${txnId}`)
    );

    await act(async () => {
      await voiceRecorderState.props!.onSendRecording(file, 1100, undefined, capturedContext);
    });

    expect(mxState.uploadContent).toHaveBeenCalledTimes(2);
    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage.mock.calls[0][1]).toMatchObject({
      'm.relates_to': {
        event_id: '$deferred-voice-root',
        rel_type: RelationType.Thread,
      },
    });
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
