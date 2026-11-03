import React, { createRef, useEffect } from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';

type EditorProps = {
  editableName?: string;
  placeholder?: string;
  onKeyDown?: (event: unknown) => void;
  onKeyUp?: () => void;
};

const state = vi.hoisted(() => ({
  editorProps: undefined as EditorProps | undefined,
  mentionHasSuggestions: true,
  startSendSession: vi.fn(async () => undefined),
}));

vi.mock('folds', () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    Box: passthrough,
    Icon: () => null,
    IconButton: passthrough,
    Icons: {},
    PopOut: () => null,
    Text: passthrough,
    color: { Primary: {} },
    config: { space: {}, radii: {}, borderWidth: {} },
  };
});
vi.mock('../../components/editor', () => ({
  AUTOCOMPLETE_PREFIXES: ['@'],
  AutocompletePrefix: { UserMention: '@' },
  CustomEditor: (props: EditorProps) => {
    state.editorProps = props;
    return null;
  },
  customHtmlEqualsPlainText: () => true,
  getAutocompleteQuery: () => ({ prefix: '@', range: {}, text: 'zz' }),
  getBeginCommand: () => undefined,
  getMentions: () => ({ users: new Set<string>(), room: false }),
  getPrevWorldRange: () => ({}),
  isEmptyEditor: () => false,
  resetEditor: vi.fn(),
  resetEditorHistory: vi.fn(),
  toMatrixCustomHTML: () => '@zz',
  toPlainText: () => '@zz',
  trimCommand: (_command: string, value: string) => value,
  trimCustomHtml: (value: string) => value,
  // Reports its suggestions the way the real mention menu does.
  UserMentionAutocomplete: ({
    onSuggestionsChange,
  }: {
    onSuggestionsChange?: (hasSuggestions: boolean) => void;
  }) => {
    useEffect(() => onSuggestionsChange?.(state.mentionHasSuggestions), [onSuggestionsChange]);
    return null;
  },
}));
vi.mock('../../components/editor/utils', () => ({
  createEmoticonElement: vi.fn(),
  moveCursor: vi.fn(),
  restoreEditorContent: vi.fn(),
}));
vi.mock('../../components/emoji-board', () => ({ EmojiBoard: () => null }));
vi.mock('../../features/room/msgContent', () => ({
  getAudioMsgContent: vi.fn(),
  getFileMsgContent: vi.fn(),
  getImageMsgContent: vi.fn(),
  getVideoMsgContent: vi.fn(),
}));
vi.mock('../../hooks/useComposingCheck', () => ({ useComposingCheck: () => () => false }));
vi.mock('../../hooks/useImagePackRooms', () => ({ useImagePackRooms: () => [] }));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@alice:example.org' }),
}));
vi.mock('../../hooks/useTypingStatusUpdater', () => ({
  useTypingStatusUpdater: () => vi.fn(),
}));
vi.mock('../../state/hooks/settings', () => ({ useSetting: () => [false] }));
vi.mock('../../utils/user-agent', () => ({ mobileOrTablet: () => false }));
vi.mock('../messages/pasteAttachmentMarker', () => ({
  withMindroomPasteAttachmentMetadata: (content: unknown) => content,
}));
vi.mock('../models/ModelPicker', () => ({ ThreadModelPicker: () => null }));
vi.mock('../tooltip/IconTooltip', () => ({ IconTooltip: () => null }));
vi.mock('./RoomInputMindroomExtensions', () => ({
  getMindroomRoomInputAutocompleteQuery: () => undefined,
  isMindroomRoomInputAutocompleteQuery: () => false,
  MindroomRoomInputAutocomplete: () => null,
  MindroomRoomInputReplyContext: () => null,
  useRoomInputSendSessionController: () => ({ startSendSession: state.startSendSession }),
}));
vi.mock('./RoomInputReplyPreview', () => ({ RoomInputReplyPreview: () => null }));
vi.mock('./roomInputUploadPreparation', () => ({ createMindroomRoomUploadItems: vi.fn() }));
vi.mock('./useRoomInputAttachments', () => ({
  useRoomInputAttachments: () => ({
    access: {},
    board: null,
    dropZoneVisible: false,
    onEditorChange: vi.fn(),
    onPaste: vi.fn(),
    pickFiles: vi.fn(),
  }),
}));
vi.mock('./useRoomInputDraft', () => ({ useRoomInputDraft: () => vi.fn() }));
vi.mock('./useRoomInputUploadTransport', () => ({
  getVoiceMessageContentOptions: () => ({}),
  useRoomInputUploadTransport: () => ({}),
}));
vi.mock('./useRoomInputVoice', () => ({
  useRoomInputVoice: () => ({
    blocksSubmit: () => false,
    submitIfActive: async () => false,
    renderRecorder: () => null,
    microphone: null,
  }),
}));

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  state.editorProps = undefined;
  state.startSendSession.mockClear();
});

/** Mounts the composer, types `@zz` and presses Enter; resolves with whether it sent. */
const pressEnterAfterMention = async (): Promise<boolean> => {
  const { RoomInput } = await import('./MindroomRoomInput');
  const room = { roomId: '!room:example.org', name: 'Room' } as unknown as Room;
  act(() => {
    renderer = create(
      <Provider store={createStore()}>
        <RoomInput
          editor={{ children: [] } as never}
          fileDropContainerRef={createRef()}
          roomId={room.roomId}
          room={room}
        />
      </Provider>
    );
  });
  act(() => state.editorProps?.onKeyUp?.());
  await act(async () => {
    state.editorProps?.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
  });
  return state.startSendSession.mock.calls.length > 0;
};

describe('composer', () => {
  it('names its text box RoomInput for the timeline shortcuts', async () => {
    state.mentionHasSuggestions = true;
    await pressEnterAfterMention();
    expect(state.editorProps?.editableName).toBe('RoomInput');
    expect(state.editorProps?.placeholder).toBeTruthy();
  });

  it('leaves Enter to the mention menu while it shows suggestions', async () => {
    state.mentionHasSuggestions = true;
    expect(await pressEnterAfterMention()).toBe(false);
  });

  it('sends on Enter when an @ mention matches nobody', async () => {
    state.mentionHasSuggestions = false;
    expect(await pressEnterAfterMention()).toBe(true);
  });
});
