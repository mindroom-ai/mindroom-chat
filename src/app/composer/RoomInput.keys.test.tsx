import React, { createRef, useEffect } from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventStatus, type Room } from 'matrix-js-sdk';
import { UserMentionAutocomplete } from '../editor/autocomplete/UserMentionAutocomplete';
import { ThreadModelPicker } from '../models/ModelPicker';
import { conversationBehindPanelAtom } from '../navigation/conversationCover';
import {
  ConversationViewContext,
  composerStateKey,
  shownConversationViewsAtom,
} from '../navigation/conversationView';
import { roomIdToReplyDraftAtomFamily } from './roomInputDrafts';
import { RoomInputReplyPreview } from './RoomInputReplyPreview';
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
  startSendSession: vi.fn(async () => undefined),
  commands: {} as Record<string, SlashCommand>,
  /** The thread the composer last asked for its commands in. */
  commandThread: undefined as string | undefined,
  resetEditor: vi.fn(),
  restoreEditorContent: vi.fn(),
  /** The room the voice messages of the composer last counted as theirs. */
  voiceRoomId: undefined as string | undefined,
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
  CustomEditor: (props: EditorProps & { top?: React.ReactNode; before?: React.ReactNode }) => {
    state.editorProps = props;
    return (
      <>
        {props.top}
        {props.before}
      </>
    );
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
  useCommands: (_room: Room, threadId?: string) => {
    state.commandThread = threadId;
    return state.commands;
  },
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
vi.mock('../models/ModelPicker', () => ({ ThreadModelPicker: () => null }));
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
  useRoomInputVoice: ({ roomId }: { roomId: string }) => {
    state.voiceRoomId = roomId;
    return {
      blocksSubmit: () => false,
      submitIfActive: async () => false,
      renderRecorder: () => null,
      microphone: null,
    };
  },
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
  state.commandThread = undefined;
});

/** Another conversation view than the room page, as a plugin's thread view. */
const VIEW = 'thread-view';

type ComposerProps = {
  store?: ReturnType<typeof createStore>;
  room?: Room;
  threadId?: string;
  threadingEnabled?: boolean;
  /** The key of the conversation view the composer is in, other than the room page. */
  view?: string;
};

/**
 * Mounts the composer holding `document` in `store`, or renders it again with new props, and lets
 * it read the query a key left.
 */
const mountComposer = async (
  document: unknown[] = [],
  {
    store = createStore(),
    room = { roomId: '!room:example.org', name: 'Room' } as unknown as Room,
    view,
    ...props
  }: ComposerProps = {}
) => {
  const { RoomInput } = await import('./RoomInput');
  const element = (
    <Provider store={store}>
      <ConversationViewContext.Provider value={view}>
        <RoomInput
          editor={{ children: document } as never}
          fileDropContainerRef={createRef()}
          roomId={room.roomId}
          room={room}
          {...props}
        />
      </ConversationViewContext.Provider>
    </Provider>
  );
  act(() => {
    if (renderer) renderer.update(element);
    else renderer = create(element);
  });
  act(() => state.editorProps?.onKeyUp?.());
};

/** Presses Enter in the mounted composer. */
const pressEnter = async () => {
  await act(async () => {
    state.editorProps?.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
  });
};

/** Mounts the composer holding `document` and presses Enter; resolves with whether it sent. */
const pressEnterAfterMention = async (document: unknown[] = []): Promise<boolean> => {
  await mountComposer(document);
  await pressEnter();
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
    const store = createStore();
    await mountComposer([], { store });
    const mentionMenus = () => renderer!.root.findAllByType(UserMentionAutocomplete).length;
    const pickerHidden = () =>
      renderer!.root.findByType(ThreadModelPicker).props.conversationHidden;
    expect(mentionMenus()).toBe(1);
    expect(pickerHidden()).toBe(false);
    act(() => store.set(conversationBehindPanelAtom, true));
    // Its Tab would pick a completion into the hidden draft.
    expect(mentionMenus()).toBe(0);
    expect(pickerHidden()).toBe(true);
  });

  it("keeps the mention menu and the model picker of another conversation view open as a side panel hides the room's page", async () => {
    const store = createStore();
    store.set(shownConversationViewsAtom, [{ view: VIEW, roomId: '!room:example.org' }]);
    await mountComposer([], { store, view: VIEW });
    act(() => store.set(conversationBehindPanelAtom, true));
    expect(renderer!.root.findAllByType(UserMentionAutocomplete)).toHaveLength(1);
    expect(renderer!.root.findByType(ThreadModelPicker).props.conversationHidden).toBe(false);
  });

  it("leaves the room page's voice messages to it in another conversation view", async () => {
    await mountComposer([], { view: VIEW });
    expect(state.voiceRoomId).toBe(composerStateKey('!room:example.org', VIEW));
    await mountComposer([]);
    expect(state.voiceRoomId).toBe('!room:example.org');
  });

  it("shows the reply of its own conversation view, not the room page's", async () => {
    const store = createStore();
    const reply = { userId: '@bob:example.org', eventId: '$page', body: 'On the page' };
    store.set(roomIdToReplyDraftAtomFamily('!room:example.org'), reply);
    await mountComposer([], { store, view: VIEW });
    expect(renderer!.root.findAllByType(RoomInputReplyPreview)).toHaveLength(0);
    act(() =>
      store.set(roomIdToReplyDraftAtomFamily(composerStateKey('!room:example.org', VIEW)), {
        ...reply,
        eventId: '$view',
      })
    );
    expect(renderer!.root.findByType(RoomInputReplyPreview).props.replyDraft.eventId).toBe('$view');
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

    describe("a plugin's command in a thread", () => {
      const greeting = [{ type: 'paragraph', children: [{ text: '/greet Hi' }] }];
      const LOCAL_ROOT = '~!room:example.org:txn-root';
      /** The threads `/greet` ran in, as the composer's commands knew them when it ran. */
      let ranIn: Array<string | undefined>;
      const invite = vi.fn(async () => undefined);
      beforeEach(() => {
        ranIn = [];
        invite.mockClear();
        state.mentionHasSuggestions = false;
        const greet = async () => {
          ranIn.push(state.commandThread);
        };
        state.commands = {
          greet: { name: 'greet', description: 'Greets.', run: greet, inThread: true },
          invite: { name: 'invite', description: 'Invite user to room.', run: invite },
        };
      });
      /** A room whose message `LOCAL_ROOT` waits for the server, which gives it `$root`. */
      const roomWithPendingRoot = () => {
        let rootId = LOCAL_ROOT;
        const root = { status: EventStatus.SENDING, getId: () => rootId };
        const room = {
          roomId: '!room:example.org',
          name: 'Room',
          findEventById: (eventId: string) => (eventId === rootId ? root : undefined),
        } as unknown as Room;
        const confirm = () => {
          rootId = '$root:example.org';
        };
        return { room, confirm };
      };

      it('runs in the thread the composer writes to, and outside it in a classic timeline', async () => {
        await mountComposer(greeting, { threadId: '$root:example.org' });
        await pressEnter();
        await mountComposer(greeting, { threadId: '$root:example.org', threadingEnabled: false });
        await pressEnter();
        expect(ranIn).toEqual(['$root:example.org', undefined]);
        expect(state.startSendSession).not.toHaveBeenCalled();
      });

      it("waits for a root the server has not confirmed, then runs once in the root's own ID", async () => {
        const { room, confirm } = roomWithPendingRoot();
        const store = createStore();
        await mountComposer(greeting, { store, room, threadId: LOCAL_ROOT });
        await pressEnter();
        await pressEnter();
        expect(ranIn).toEqual([]);
        // The text stays in the composer while it waits, as a message's does.
        expect(state.resetEditor).not.toHaveBeenCalled();

        confirm();
        await mountComposer(greeting, { store, room, threadId: '$root:example.org' });
        expect(ranIn).toEqual(['$root:example.org']);
      });

      it('leaves a built-in command that acts to run at once there', async () => {
        const { room } = roomWithPendingRoot();
        const typed = [{ type: 'paragraph', children: [{ text: '/invite @bob:example.org' }] }];
        await mountComposer(typed, { room, threadId: LOCAL_ROOT });
        await pressEnter();
        expect(invite).toHaveBeenCalledWith('@bob:example.org');
      });
    });
  });
});
