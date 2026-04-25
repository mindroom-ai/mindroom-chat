import React, { createRef } from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RelationType } from 'matrix-js-sdk';
import { RoomInput } from './RoomInput';
import {
  IReplyDraft,
  roomIdToReplyDraftAtomFamily,
  roomIdToUploadItemsAtomFamily,
  roomUploadAtomFamily,
} from '../../state/room/roomInputDrafts';

const ROOM_ID = '!room:example.org';

const { editorMocks, mxState, voiceRecorderState } = vi.hoisted(() => ({
  editorMocks: {
    resetEditor: vi.fn(),
    resetEditorHistory: vi.fn(),
  },
  mxState: {
    cancelUpload: vi.fn(),
    getUserId: vi.fn(() => '@me:example.org'),
    sendMessage: vi.fn(async () => ({ event_id: '$sent' })),
  },
  voiceRecorderState: {
    props: undefined as
      | {
          onSendRecording: (file: File, duration: number) => Promise<void>;
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

vi.mock('../../components/editor', () => ({
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

vi.mock('../../components/emoji-board', () => ({
  EmojiBoard: () => null,
  EmojiBoardTab: {},
}));

vi.mock('../../components/UseStateProvider', () => ({
  UseStateProvider: ({
    children,
    initial,
  }: {
    children: (state: undefined, setState: (value: undefined) => void) => React.ReactNode;
    initial: undefined;
  }) => children(initial, vi.fn()),
}));

vi.mock('../../components/upload-card', () => ({
  UploadCardRenderer: () => null,
}));

vi.mock('../../components/upload-board', () => ({
  UploadBoard: ({
    header,
    children,
  }: {
    header?: React.ReactNode;
    children?: React.ReactNode;
  }) => React.createElement('div', null, header, children),
  UploadBoardContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
  UploadBoardHeader: () => React.createElement('div'),
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => mxState,
}));

vi.mock('../../hooks/useTypingStatusUpdater', () => ({
  useTypingStatusUpdater: () => vi.fn(),
}));

vi.mock('../../hooks/useFilePicker', () => ({
  useFilePicker: () => vi.fn(),
}));

vi.mock('../../hooks/useFilePasteHandler', () => ({
  useFilePasteHandler: () => vi.fn(),
}));

vi.mock('../../hooks/useFileDrop', () => ({
  useFileDropZone: () => false,
}));

vi.mock('../../state/hooks/settings', () => ({
  useSetting: () => [false, vi.fn()],
}));

vi.mock('../../state/settings', () => ({
  settingsAtom: {},
}));

vi.mock('../../utils/dom', () => ({
  getImageUrlBlob: vi.fn(),
  loadImageElement: vi.fn(),
  pauseAllMediaElements: vi.fn(),
}));

vi.mock('../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../hooks/useImagePackRooms', () => ({
  useImagePackRooms: () => [],
}));

vi.mock('../../hooks/usePowerLevels', () => ({
  usePowerLevelsContext: () => ({}),
}));

vi.mock('../../hooks/useRoom', () => ({
  useIsDirectRoom: () => false,
}));

vi.mock('../../hooks/useMemberPowerTag', () => ({
  useAccessiblePowerTagColors: () => new Map(),
  useGetMemberPowerTag: () => () => undefined,
}));

vi.mock('../../hooks/useRoomCreators', () => ({
  useRoomCreators: () => [],
}));

vi.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({ kind: 'light' }),
}));

vi.mock('../../hooks/useRoomCreatorsTag', () => ({
  useRoomCreatorsTag: () => undefined,
}));

vi.mock('../../hooks/usePowerLevelTags', () => ({
  usePowerLevelTags: () => [],
}));

vi.mock('../../hooks/useComposingCheck', () => ({
  useComposingCheck: () => () => false,
}));

vi.mock('../../hooks/useElementSizeObserver', () => ({
  useElementSizeObserver: vi.fn(),
}));

vi.mock('./CommandAutocomplete', () => ({
  CommandAutocomplete: () => null,
}));

vi.mock('../../hooks/useCommands', () => ({
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

vi.mock('../../mindroom/room-input/RoomInputMindroomExtensions', async () => {
  const { useRoomInputSendSessionController } = await vi.importActual<
    typeof import('../../mindroom/threads/useRoomInputSendSessionController')
  >('../../mindroom/threads/useRoomInputSendSessionController');

  return {
    getMindroomRoomInputAutocompleteQuery: () => undefined,
    isMindroomRoomInputAutocompleteQuery: (query?: { prefix?: string }) => query?.prefix === '!',
    MindroomRoomInputAutocomplete: () => null,
    MindroomVoiceRecorderComposer: (props: {
      onSendRecording: (file: File, duration: number) => Promise<void>;
    }) => {
      voiceRecorderState.props = props;
      return React.createElement('div');
    },
    useRoomInputSendSessionController,
  };
});

vi.mock('../../components/message', () => ({
  ReplyLayout: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../../mindroom/threads/ThreadIndicator', () => ({
  ThreadIndicator: () => React.createElement('div'),
}));

vi.mock('../../utils/user-agent', () => ({
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

const createRoom = () =>
  ({
    roomId: ROOM_ID,
    hasEncryptionStateEvent: () => false,
    getMember: () => undefined,
    getMembers: () => [],
  }) as never;

const createEditor = () =>
  ({
    children: [],
  }) as never;

const renderRoomInput = async (
  store = createStore(),
  props?: {
    threadId?: string;
  }
): Promise<{ renderer: ReactTestRenderer; store: ReturnType<typeof createStore> }> => {
  let renderer!: ReactTestRenderer;

  await act(async () => {
    renderer = create(
      React.createElement(
        Provider,
        { store },
        React.createElement(RoomInput, {
          editor: createEditor(),
          fileDropContainerRef: createRef<HTMLElement>(),
          roomId: ROOM_ID,
          room: createRoom(),
          threadId: props?.threadId,
        })
      )
    );
  });

  return { renderer, store };
};

afterEach(() => {
  voiceRecorderState.props = undefined;
  mxState.cancelUpload.mockReset();
  mxState.getUserId.mockReset();
  mxState.getUserId.mockReturnValue('@me:example.org');
  mxState.sendMessage.mockReset();
  mxState.sendMessage.mockResolvedValue({ event_id: '$sent' });
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

    await act(async () => {
      await voiceRecorderState.props?.onSendRecording(file, 1200);
    });

    const [fileItem] = store.get(roomIdToUploadItemsAtomFamily(ROOM_ID));

    expect(fileItem?.file).toBe(file);
    expect(mxState.sendMessage).not.toHaveBeenCalled();

    await act(async () => {
      store.set(roomUploadAtomFamily(file), { mxc: 'mxc://mindroom/voice' });
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        body: 'voice.m4a',
        msgtype: 'm.audio',
        url: 'mxc://mindroom/voice',
        'm.relates_to': expect.objectContaining({
          event_id: '$thread',
          rel_type: RelationType.Thread,
        }),
      })
    );

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

    await act(async () => {
      await voiceRecorderState.props?.onSendRecording(file, 900);
    });

    await act(async () => {
      store.set(roomIdToReplyDraftAtomFamily(ROOM_ID), newerReplyDraft);
    });

    await act(async () => {
      store.set(roomUploadAtomFamily(file), { mxc: 'mxc://mindroom/voice' });
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(store.get(roomIdToReplyDraftAtomFamily(ROOM_ID))).toEqual(newerReplyDraft);

    renderer.unmount();
  });
});
