import React, { createRef, useEffect } from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import { conversationBehindPanelAtom } from '../navigation/conversationCover';
import type { SlashCommand } from './commands/useCommands';
import { importBeforeTests } from '../../test/utils/importBeforeTests';

type EditorProps = {
  editableName?: string;
  placeholder?: string;
  onKeyDown?: (event: unknown) => void;
  onKeyUp?: () => void;
};

const state = vi.hoisted(() => ({
  editorProps: undefined as EditorProps | undefined,
  mentionHasSuggestions: true,
  mentionShown: false,
  modelPickerHidden: undefined as boolean | undefined,
  startSendSession: vi.fn(async () => undefined),
  commands: {} as Record<string, SlashCommand>,
  resetEditor: vi.fn(),
  restoreEditorContent: vi.fn(),
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
    color: { Primary: {}, Critical: {} },
    config: { space: {}, radii: {}, borderWidth: {} },
  };
});
vi.mock('../editor/utils', () => ({
  getMentions: () => ({ users: new Set<string>(), room: false }),
  getPrevWorldRange: () => ({}),
  isEmptyEditor: () => false,
  resetEditor: state.resetEditor,
  resetEditorHistory: vi.fn(),
  createEmoticonElement: vi.fn(),
  moveCursor: vi.fn(),
  restoreEditorContent: state.restoreEditorContent,
}));
vi.mock('../editor/output', () => ({
  customHtmlEqualsPlainText: () => true,
  toMatrixCustomHTML: () => '@zz',
  toPlainText: () => '@zz',
  trimCustomHtml: (value: string) => value,
}));
vi.mock('../editor/Editor', () => ({
  CustomEditor: (props: EditorProps & { top?: React.ReactNode }) => {
    state.editorProps = props;
    return <>{props.top}</>;
  },
}));
vi.mock('../editor/autocomplete/autocompleteQuery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../editor/autocomplete/autocompleteQuery')>();
  return {
    ...actual,
    AUTOCOMPLETE_PREFIXES: ['@'],
    AutocompletePrefix: { ...actual.AutocompletePrefix, UserMention: '@' },
    getAutocompleteQuery: () => ({ prefix: '@', range: {}, text: 'zz' }),
  };
});
vi.mock('../editor/autocomplete/EmoticonAutocomplete', () => ({}));
vi.mock('../editor/autocomplete/UserMentionAutocomplete', () => ({
  // Reports its suggestions the way the real mention menu does.
  UserMentionAutocomplete: ({
    onSuggestionsChange,
  }: {
    onSuggestionsChange?: (hasSuggestions: boolean) => void;
  }) => {
    useEffect(() => onSuggestionsChange?.(state.mentionHasSuggestions), [onSuggestionsChange]);
    useEffect(() => {
      state.mentionShown = true;
      return () => {
        state.mentionShown = false;
      };
    }, []);
    return null;
  },
}));
vi.mock('../emoji/board/LazyEmojiBoard', () => ({ EmojiBoard: () => null }));
vi.mock('../matrix/send/msgContent', () => ({
  getAudioMsgContent: vi.fn(),
  getFileMsgContent: vi.fn(),
  getImageMsgContent: vi.fn(),
  getVideoMsgContent: vi.fn(),
}));
vi.mock('./commands/CommandAutocomplete', () => ({ CommandAutocomplete: () => null }));
vi.mock('./commands/useCommands', () => ({
  SHRUG: 'shrug-face',
  TABLEFLIP: 'tableflip-face',
  UNFLIP: 'unflip-face',
  useCommands: () => state.commands,
}));
vi.mock('../lib/hooks/useComposingCheck', () => ({ useComposingCheck: () => () => false }));
vi.mock('../emoji/useImagePackRooms', () => ({ useImagePackRooms: () => [] }));
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@alice:example.org' }),
}));
vi.mock('./useTypingStatusUpdater', () => ({
  useTypingStatusUpdater: () => vi.fn(),
}));
vi.mock('../preferences/useSetting', () => ({ useSetting: () => [false] }));
vi.mock('../lib/user-agent', () => ({ mobileOrTablet: () => false }));
vi.mock('../matrix/protocol/pasteAttachmentMarker', () => ({
  withPasteAttachmentMetadata: (content: unknown) => content,
}));
vi.mock('../models/ModelPicker', () => ({
  ThreadModelPicker: ({ conversationHidden }: { conversationHidden?: boolean }) => {
    state.modelPickerHidden = conversationHidden;
    return null;
  },
}));
vi.mock('../ui/IconTooltip', () => ({ IconTooltip: () => null }));
vi.mock('./commands/agentCommandQuery', () => ({ getAgentCommandQuery: () => undefined }));
vi.mock('./RoomInputExtensions', () => ({
  isRoomInputAutocompleteQuery: () => false,
  RoomInputAutocomplete: () => null,
  RoomInputReplyContext: () => null,
}));
vi.mock('./useRoomInputSendSessionController', () => ({
  useRoomInputSendSessionController: () => ({ startSendSession: state.startSendSession }),
}));
vi.mock('./RoomInputReplyPreview', () => ({ RoomInputReplyPreview: () => null }));
vi.mock('../matrix/send/roomInputUploadPreparation', () => ({
  createRoomUploadItems: vi.fn(),
}));
vi.mock('./useRoomInputAttachments', () => ({
  useRoomInputAttachments: () => ({
    access: {},
    board: null,
    dropZoneVisible: false,
    onEditorChange: vi.fn(),
    onPaste: vi.fn(),
    pickFiles: vi.fn(),
    lostPastes: false,
    dismissLostPastes: vi.fn(),
    settlePastes: () => true,
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
  state.resetEditor.mockClear();
  state.restoreEditorContent.mockClear();
  state.commands = {};
});

/** Mounts the composer holding `document` and presses Enter; resolves with whether it sent. */
const pressEnterAfterMention = async (document: unknown[] = []): Promise<boolean> => {
  const { RoomInput } = await import('./RoomInput');
  const room = { roomId: '!room:example.org', name: 'Room' } as unknown as Room;
  act(() => {
    renderer = create(
      <Provider store={createStore()}>
        <RoomInput
          editor={{ children: document } as never}
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

importBeforeTests(() => import('./RoomInput'));

describe('composer', () => {
  it('names its text box RoomInput for the timeline shortcuts', async () => {
    state.mentionHasSuggestions = true;
    await pressEnterAfterMention();
    expect(state.editorProps?.editableName).toBe('RoomInput');
    expect(state.editorProps?.placeholder).toBeTruthy();
  });

  it('closes the mention menu and the model picker as a side panel hides the conversation', async () => {
    state.mentionHasSuggestions = true;
    const { RoomInput } = await import('./RoomInput');
    const room = { roomId: '!room:example.org', name: 'Room' } as unknown as Room;
    const store = createStore();
    act(() => {
      renderer = create(
        <Provider store={store}>
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
    expect(state.mentionShown).toBe(true);
    expect(state.modelPickerHidden).toBe(false);
    act(() => store.set(conversationBehindPanelAtom, true));
    // Its Tab would pick a completion into the hidden draft.
    expect(state.mentionShown).toBe(false);
    expect(state.modelPickerHidden).toBe(true);
  });

  it('leaves Enter to the mention menu while it shows suggestions', async () => {
    state.mentionHasSuggestions = true;
    expect(await pressEnterAfterMention()).toBe(false);
  });

  it('sends on Enter when an @ mention matches nobody', async () => {
    state.mentionHasSuggestions = false;
    expect(await pressEnterAfterMention()).toBe(true);
  });

  describe('slash commands', () => {
    const typed = [
      { type: 'paragraph', children: [{ text: '/invite @bob:example.org -r come in' }] },
    ];
    const withInvite = (run: SlashCommand['run']) => {
      state.mentionHasSuggestions = false;
      state.commands = {
        invite: { name: 'invite', description: 'Invite user to room.', run },
      } as Record<string, SlashCommand>;
    };
    const alerts = () =>
      renderer?.root.findAll((node) => node.props.role === 'alert').map((node) => node.props);

    it('runs an acting command with its arguments instead of sending a message', async () => {
      const run = vi.fn(async () => undefined);
      withInvite(run);
      expect(await pressEnterAfterMention(typed)).toBe(false);
      expect(run).toHaveBeenCalledWith('@bob:example.org -r come in');
      expect(state.resetEditor).toHaveBeenCalled();
      expect(state.restoreEditorContent).not.toHaveBeenCalled();
      expect(alerts()).toEqual([]);
    });

    it('gives the text back with the reason when the command fails', async () => {
      withInvite(vi.fn(async () => Promise.reject(new Error('You are not allowed to invite'))));
      expect(await pressEnterAfterMention(typed)).toBe(false);
      expect(state.restoreEditorContent).toHaveBeenCalledWith(expect.anything(), typed);
      expect(JSON.stringify(alerts())).toContain('You are not allowed to invite');
    });

    it('sends an unknown /word as a message', async () => {
      withInvite(vi.fn(async () => undefined));
      const path = [{ type: 'paragraph', children: [{ text: '/usr/bin is on the path' }] }];
      expect(await pressEnterAfterMention(path)).toBe(true);
    });
  });
});
