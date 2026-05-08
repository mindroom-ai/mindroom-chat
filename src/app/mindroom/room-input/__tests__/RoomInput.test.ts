import React, { createRef } from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RelationType } from 'matrix-js-sdk';
import { createMindroomRoomUploadItems, RoomInput } from '../MindroomRoomInput';
import { MATRIX_AUDIO_DETAILS_PROPERTY_NAME } from '../../../../types/matrix/common';
import {
  IReplyDraft,
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
  },
  editorOutputState: {
    plainText: '',
    customHtml: '',
    htmlEqualsPlainText: true,
  },
  mxState: {
    cancelUpload: vi.fn(),
    getUserId: vi.fn(() => '@me:example.org'),
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
          onSendRecording: (file: File, duration: number, waveform?: number[]) => Promise<void>;
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

const createRoom = (roomId = ROOM_ID, encrypted = false) =>
  ({
    roomId,
    hasEncryptionStateEvent: () => encrypted,
    getMember: () => undefined,
    getMembers: () => [],
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
    })
  );

const renderRoomInput = async (
  store = createStore(),
  props?: {
    roomId?: string;
    threadId?: string;
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
    keyedRoomSubtree?: boolean;
    encryptedRoom?: boolean;
  }
) => {
  await act(async () => {
    renderer.update(createRoomInputTree(store, props));
  });
};

afterEach(() => {
  voiceRecorderState.props = undefined;
  customEditorState.autocompleteQuery = undefined;
  customEditorState.editor = undefined;
  customEditorState.props = undefined;
  editorOutputState.plainText = '';
  editorOutputState.customHtml = '';
  editorOutputState.htmlEqualsPlainText = true;
  mxState.cancelUpload.mockReset();
  mxState.getUserId.mockReset();
  mxState.getUserId.mockReturnValue('@me:example.org');
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

  it('keeps a paste upload claimed by send after the text-send editor reset clears the marker', async () => {
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

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toHaveLength(1);

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage.mock.calls[0][1]).toMatchObject({
      msgtype: 'm.text',
      body: `${marker}\n\ntest testing`,
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

  it('clears failed voice upload state and releases pending auto-send', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { threadId: '$thread-a' });
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const uploadAbort = new DOMException('The operation was aborted.', 'AbortError');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mxState.uploadContent.mockRejectedValueOnce(uploadAbort);

    await act(async () => {
      await expect(voiceRecorderState.props!.onSendRecording(file, 1100)).rejects.toMatchObject({
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

    await act(async () => {
      await voiceRecorderState.props!.onSendRecording(file, 700);
    });

    expect(mxState.uploadContent).toHaveBeenCalledTimes(2);
    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();

    renderer.unmount();
  });

  it('propagates encrypted voice preparation failures instead of treating them as sent', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, {
      threadId: '$thread-a',
      encryptedRoom: true,
    });
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
