import React, {
  forwardRef,
  KeyboardEvent,
  RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useAtomValue, useStore } from 'jotai';
import { isKeyHotkey } from 'is-hotkey';
import { type IContent, type Room } from 'matrix-js-sdk';
import type { Descendant, Editor } from 'slate';
import { Box, Icon, Icons, RectCords, Text, color, config } from 'folds';
import { PopOut, revealDirectionControls } from '../ui/directional';
import { Editor as SlateEditor } from 'slate';
import { getPrevWorldRange, isEmptyEditor, resetEditor, resetEditorHistory } from '../editor/utils';
import { CustomEditor } from '../editor/Editor';
import {
  AUTOCOMPLETE_PREFIXES,
  AutocompletePrefix,
  type AutocompleteQuery,
  getAutocompleteQuery,
} from '../editor/autocomplete/autocompleteQuery';
import { UserMentionAutocomplete } from '../editor/autocomplete/UserMentionAutocomplete';
import { EmoticonAutocomplete } from '../editor/autocomplete/EmoticonAutocomplete';
import { createEmoticonElement, moveCursor, restoreEditorContent } from '../editor/utils';
import { toggleKeyboardShortcut } from '../editor/keyboard';
import { EmojiBoard } from '../emoji/board/LazyEmojiBoard';
import { type EmojiBoardTab } from '../emoji/board/EmojiBoard';
import { IconButton } from '../ui/glass/GlassPrimitives';
import { glassDenseOverBackdrop } from '../ui/styles/Glass.css';
import {
  getAudioMsgContent,
  getFileMsgContent,
  getImageMsgContent,
  getVideoMsgContent,
} from '../matrix/send/msgContent';
import { CommandAutocomplete } from './commands/CommandAutocomplete';
import { useCommands } from './commands/useCommands';
import { useComposingCheck } from '../lib/hooks/useComposingCheck';
import { useImagePackRooms } from '../emoji/useImagePackRooms';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useTypingStatusUpdater } from './useTypingStatusUpdater';
import { useSetting } from '../preferences/useSetting';
import {
  getRoomInputDraftKey,
  type IReplyDraft,
  keepReplyDraft,
  restoreTextToDraft,
  roomIdToMsgDraftAtomFamily,
  composerReplyDraftAtom,
} from './roomInputDrafts';
import type { TUploadItem } from '../matrix/state/upload';
import { roomToParentsAtom } from '../matrix/state/roomToParents';
import { ConversationViewContext, useConversationHidden } from '../navigation/conversationView';
import { settingsAtom } from '../preferences/settings';
import { mobileOrTablet } from '../lib/user-agent';
import { withPasteAttachmentMetadata } from '../matrix/protocol/pasteAttachmentMarker';
import { MINDROOM_COMMANDS } from './commands/agentCommands';
import { ThreadModelPicker } from '../models/ModelPicker';
import { hasMatchingReplyDraft } from './roomInputSendSession';
import { ComposerIconButton } from './ComposerIconButton';
import { ComposerFormattingToolbar } from './ComposerFormattingToolbar';
import { ComposerActionsMenu } from './ComposerActionsMenu';
import { ComposerSendButton } from './ComposerSendButton';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { composeTextMessage } from './composeTextMessage';
import {
  type ActingCommand,
  describeCommandFailure,
  getCommandSuggestions,
  isSlashCommandQuery,
  readActingCommand,
  readUnknownCommand,
} from './slashCommandQuery';
import { sendComposerSticker } from './composerSticker';
import {
  isRoomInputAutocompleteQuery,
  RoomInputAutocomplete,
  RoomInputReplyContext,
} from './RoomInputExtensions';
import { getAgentCommandQuery } from './commands/agentCommandQuery';
import { RoomInputReplyPreview } from './RoomInputReplyPreview';
import { createRoomUploadItems } from '../matrix/send/roomInputUploadPreparation';
import { useRoomInputAttachments } from './useRoomInputAttachments';
import { useRoomInputDraft } from './useRoomInputDraft';
import { useKeptComposerState } from './useKeptComposerState';
import { useOptionalClientConfig } from '../config/useClientConfig';
import { useRoomInputSendSessionController } from './useRoomInputSendSessionController';
import {
  getVoiceMessageContentOptions,
  useRoomInputUploadTransport,
} from './useRoomInputUploadTransport';
import { useRoomInputVoice } from './useRoomInputVoice';
import { type HeldSend, useUnconfirmedRootSends } from './useUnconfirmedRootSends';
import { useSavedVoiceDraft } from './voice/savedVoiceDraft';
import { type ThreadForkRef, threadForkDraftId } from '../event-store/threads/threadFork';
import { useThreadStreamingState } from '../event-store/threads/useThreadStreamingState';
import { MID_TURN_MODE_KEY } from '../matrix/protocol/midTurn';
import type { MidTurnMode } from '../preferences/midTurnModes';

export type RoomInputProps = {
  editor: Editor;
  /** The area that accepts dropped files, usually the whole room view. */
  fileDropContainerRef: RefObject<HTMLElement>;
  roomId: string;
  room: Room;
  /** The thread the composer writes to; undefined for the room's main timeline. */
  threadId?: string;
  /** False in rooms that show a classic timeline: replies get no thread relation. */
  threadingEnabled?: boolean;
  /** Called with the ID of a sent room-level message; return true when the timeline shows it. */
  onRoomMessageSent?: (eventId: string) => boolean | void;
  /**
   * A fork draft's composer: it writes no thread but a new top-level message that starts the fork,
   * keeps its text apart from the thread's, and takes no reply.
   */
  forkFrom?: ThreadForkRef;
};

const isEnter = isKeyHotkey('enter');

// The composer card lines up with the approval and typing bars above it.
const COMPOSER_STYLE: React.CSSProperties = { marginInline: config.space.S400 };

// Shown over the composer while files are dragged in; it never takes the drop itself. Built
// on first use, so the theme tokens are read once the app has loaded them.
const dropZoneStyle = (): React.CSSProperties => ({
  pointerEvents: 'none',
  color: color.Primary.OnContainer,
  backgroundColor: color.Primary.Container,
  border: `${config.borderWidth.B400} dashed ${color.Primary.Main}`,
  borderRadius: config.radii.R400,
  padding: config.space.S400,
  marginBlockEnd: config.space.S200,
});
const isModEnter = isKeyHotkey('mod+enter');

// Why the last slash command did not run, in the critical color above the composer.
const commandProblemStyle = (): React.CSSProperties => ({
  color: color.Critical.Main,
  paddingInline: config.space.S200,
  paddingBlockEnd: config.space.S200,
});

// The files a reload could not keep, named above the composer until dismissed.
const lostFilesStyle = (): React.CSSProperties => ({
  color: color.Warning.Main,
  paddingInlineStart: config.space.S200,
  paddingBlockEnd: config.space.S200,
});

/** A warning above the composer about what a reload could not keep, until dismissed. */
function LostNotice({
  text,
  dismissLabel,
  onDismiss,
}: {
  text: string;
  dismissLabel: string;
  onDismiss: () => void;
}) {
  return (
    <Box role="status" alignItems="Center" gap="200" style={lostFilesStyle()}>
      <Icon size="100" src={Icons.Warning} style={{ flexShrink: 0 }} />
      <Text size="T300" style={{ flexGrow: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
        {text}
      </Text>
      {/* A long list of names wraps; the button keeps its size beside it. */}
      <IconButton
        style={{ flexShrink: 0 }}
        size="300"
        radii="300"
        variant="SurfaceVariant"
        aria-label={dismissLabel}
        onClick={onDismiss}
      >
        <Icon size="50" src={Icons.Cross} />
      </IconButton>
    </Box>
  );
}

const buildUploadMessageContent = async (
  mx: ReturnType<typeof useMatrixClient>,
  item: TUploadItem,
  mxc: string,
  signalBridgedRoom: boolean
): Promise<IContent> => {
  const type = item.originalFile.type;
  let content: IContent;
  if (type.startsWith('image/')) content = await getImageMsgContent(mx, item, mxc);
  else if (type.startsWith('video/')) content = await getVideoMsgContent(mx, item, mxc);
  else if (type.startsWith('audio/') || item.metadata.voiceMessage) {
    content = getAudioMsgContent(item, mxc, getVoiceMessageContentOptions(signalBridgedRoom));
  } else content = getFileMsgContent(item, mxc);
  return withPasteAttachmentMetadata(content, item.metadata.mindroomPasteAttachment) as IContent;
};

/**
 * The composer: text with Markdown, mentions, slash commands (MindRoom's commands among them,
 * sent as typed; their older `!` form still works), attachments (picked, dropped, pasted, or large pastes as files), voice messages, and the reply
 * being written. One send session carries text and attachments in order; a voice message joins
 * it when sent from the primary Send button.
 */
export const RoomInput = forwardRef<HTMLDivElement, RoomInputProps>(
  (
    {
      editor,
      fileDropContainerRef,
      roomId,
      room,
      threadId,
      threadingEnabled = true,
      onRoomMessageSent,
      forkFrom,
    },
    ref
  ) => {
    const { t } = useTranslation();
    const mx = useMatrixClient();
    const store = useStore();
    const [isMarkdown] = useSetting(settingsAtom, 'isMarkdown');
    const [enterForNewline] = useSetting(settingsAtom, 'enterForNewline');
    const [midTurnSend] = useSetting(settingsAtom, 'midTurnSend');
    const userId = mx.getUserId() ?? '';
    // A fork draft keeps its text under a key of its own, not its thread's.
    const draftThreadId = forkFrom ? threadForkDraftId(forkFrom) : threadId;
    const draftKey = draftThreadId
      ? getRoomInputDraftKey(userId, roomId, draftThreadId)
      : undefined;
    // Another view of the room (a plugin's thread view) has a reply of its own. A fork draft takes
    // none: the reply chosen in its thread stays for the thread.
    const view = useContext(ConversationViewContext);
    const viewReplyDraft = useAtomValue(composerReplyDraftAtom(roomId, view));
    const replyDraft = forkFrom ? undefined : viewReplyDraft;
    const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
    const sendTypingStatus = useTypingStatusUpdater(mx, roomId, hideActivity);
    const isComposing = useComposingCheck();
    const [autocompleteQuery, setAutocompleteQuery] = useState<AutocompleteQuery<string>>();
    // Set when the open menu reports that its query matches nothing (an `@` query no member has,
    // a `:` query no emoji has), so it shows nothing and Enter sends.
    const [suggestionMenuEmpty, setSuggestionMenuEmpty] = useState(false);
    const handleMenuSuggestions = useCallback(
      (hasSuggestions: boolean) => setSuggestionMenuEmpty(!hasSuggestions),
      []
    );
    const [submitPending, setSubmitPending] = useState(false);
    const [emojiAnchor, setEmojiAnchor] = useState<RectCords>();
    // Whether the editor holds nothing, for the Send button's menu. It changes only as it flips,
    // so typing renders nothing more.
    const [editorEmpty, setEditorEmpty] = useState(() => isEmptyEditor(editor));
    // The board and the autocomplete menu, whose Tab the window takes, close as the conversation
    // hides, under a plugin's cover or behind a side panel.
    const conversationHidden = useConversationHidden();
    if (conversationHidden && emojiAnchor) setEmojiAnchor(undefined);
    if (conversationHidden && autocompleteQuery) setAutocompleteQuery(undefined);
    const [boardTab, setBoardTab] = useState<EmojiBoardTab>('Emoji');
    const [formattingOpen, setFormattingOpen] = useState(false);
    // A phone row keeps voice and Send beside the text; Attach, Formatting and Emoji move into a
    // "More actions" menu, so the text gets their width.
    const phone = useScreenSizeContext() === ScreenSize.Mobile;
    // A thread's model button starts the row, on phones too: its provider's logo, and a menu.
    const modelPicker = (
      <ThreadModelPicker room={room} threadId={threadId} conversationHidden={conversationHidden} />
    );
    // While an agent replies in the thread, holding Send offers how the message meets the reply.
    // A fork draft starts a thread of its own, and the main timeline has no such check yet.
    const agentReplying = useThreadStreamingState(
      room,
      threadingEnabled && !forkFrom ? threadId : undefined
    );
    // Phones reach stickers through the emoji board's tabs instead of a button of their own.
    const imagePackRooms = useImagePackRooms(roomId, useAtomValue(roomToParentsAtom));
    const mountedRef = useRef(true);
    // In a thread whose root the server has not confirmed, sends wait for it (set further down).
    const rootConfirmedRef = useRef<(sends: HeldSend[]) => void>();
    const { hold: holdForRoot, waiting: waitingForRoot } = useUnconfirmedRootSends({
      room,
      roomId,
      threadId,
      userId,
      onConfirmedRef: rootConfirmedRef,
    });
    const saveDraft = useRoomInputDraft(editor, userId, roomId, draftThreadId);
    const { lostFileNames, dismissLostFiles } = useKeptComposerState(userId, roomId);
    const linkSchemes = useOptionalClientConfig()?.messageRendering?.additionalAllowedUriSchemes;
    const commands = useCommands(room, threadingEnabled ? threadId : undefined);
    const commandList = useMemo(() => Object.values(commands), [commands]);
    const [commandProblem, setCommandProblem] = useState<string>();

    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    }, []);

    const createUploadItems = useCallback(
      (files: File[], getMetadata?: Parameters<typeof createRoomUploadItems>[2]) =>
        createRoomUploadItems(files, room, getMetadata),
      [room]
    );
    const attachments = useRoomInputAttachments({
      mx,
      userId,
      room,
      roomId,
      draftKey,
      editor,
      isMarkdown,
      fileDropContainerRef,
      createUploadItems,
    });
    const { settlePastes, dismissLostPastes } = attachments;
    const transport = useRoomInputUploadTransport(mx, store, room);

    const clearReplyDraft = useCallback(
      ({
        roomId: replyRoomId,
        replyDraft: consumed,
      }: {
        roomId: string;
        replyDraft?: IReplyDraft;
      }) => {
        const replyAtom = composerReplyDraftAtom(replyRoomId, view);
        // A reply chosen after this send started stays for the next message.
        if (consumed && hasMatchingReplyDraft(consumed, store.get(replyAtom))) {
          store.set(replyAtom, undefined);
          // The composer may show another room by now; its kept reply goes too.
          if (userId && view === undefined) keepReplyDraft(userId, replyRoomId, undefined);
        }
      },
      [store, userId, view]
    );

    const restoreComposerFallbackForRoom = useCallback(
      (fallbackRoomId: string, fragment: Descendant[], fallbackThreadId?: string) =>
        // After any text typed there since: a failed caption is never dropped.
        restoreTextToDraft(
          store,
          getRoomInputDraftKey(userId, fallbackRoomId, fallbackThreadId),
          fragment
        ),
      [store, userId]
    );

    const sessions = useRoomInputSendSessionController({
      mx,
      room,
      roomId,
      threadId,
      replyDraft,
      threadingEnabled,
      clearReplyDraft,
      editor,
      sendTypingStatus,
      attachments: attachments.access,
      mountedRef,
      buildUploadMessageContent: (item, mxc, signalBridgedRoom) =>
        buildUploadMessageContent(mx, item, mxc, signalBridgedRoom),
      restoreComposerFallbackForRoom,
      onRoomMessageSent,
      forkFrom,
    });

    const composer = useMemo(
      () => ({
        getContext: () => ({
          roomId,
          room,
          threadId,
          replyDraft,
          threadingEnabled,
          threadView: view !== undefined,
        }),
        snapshotText: () => structuredClone(editor.children),
        resetText: () => {
          resetEditor(editor);
          resetEditorHistory(editor);
        },
        restoreText: (restoreRoomId: string, fragment: Descendant[], restoreThreadId?: string) => {
          if (restoreRoomId === roomId && restoreThreadId === threadId && mountedRef.current) {
            restoreEditorContent(editor, fragment);
            return;
          }
          restoreComposerFallbackForRoom(restoreRoomId, fragment, restoreThreadId);
        },
        clearConsumedReply: clearReplyDraft,
      }),
      [
        clearReplyDraft,
        editor,
        replyDraft,
        restoreComposerFallbackForRoom,
        room,
        roomId,
        threadId,
        threadingEnabled,
        view,
      ]
    );

    // A voice message whose send failed survives a reload, as the dialog promises.
    useSavedVoiceDraft(mx);
    const voice = useRoomInputVoice({
      mx,
      composer,
      attachments: attachments.access,
      transport,
      sessions,
      onRoomMessageSent,
    });

    // Every text message says what MindRoom does with it should it arrive while an agent replies
    // in its thread; the send session keeps it on the message for a retry.
    const buildTextContent = useCallback(
      (mode: MidTurnMode): IContent | undefined => {
        const content = composeTextMessage(
          editor,
          isMarkdown,
          mx.getUserId() ?? undefined,
          linkSchemes
        );
        return content && { ...content, [MID_TURN_MODE_KEY]: mode };
      },
      [editor, isMarkdown, linkSchemes, mx]
    );

    // A command that acts sends nothing: the composer empties while it runs and gets the text
    // back, with the reason, when it fails.
    const runActingCommand = useCallback(
      async (acting: ActingCommand) => {
        const typed = composer.snapshotText();
        setCommandProblem(undefined);
        setSubmitPending(true);
        composer.resetText();
        sendTypingStatus(false);
        try {
          await acting.run(acting.args);
        } catch (error) {
          // A composer that went away meanwhile keeps the text as its room's draft.
          composer.restoreText(roomId, typed, threadId);
          if (mountedRef.current) setCommandProblem(describeCommandFailure(t, acting, error));
        } finally {
          if (mountedRef.current) setSubmitPending(false);
        }
      },
      [composer, roomId, sendTypingStatus, t, threadId]
    );

    // A recording begun in the thread stays the thread's: a fork draft neither shows nor sends it.
    const voiceActive = !forkFrom;
    const submit = useCallback(
      async (mode: MidTurnMode) => {
        if (voiceActive && voice.blocksSubmit()) return;
        // A `/word` that is no command, such as a typo of one, stays in the composer unsent; one of
        // MindRoom's commands (`/schedule`) has no `run` and goes out as typed.
        const unknownCommand = readUnknownCommand(editor.children, commands);
        if (unknownCommand !== undefined) {
          setCommandProblem(
            t('featureUi.room.commandAutocomplete.unknown', { command: `/${unknownCommand}` })
          );
          return;
        }
        const acting = readActingCommand(editor.children, commands);
        if (acting) {
          if (acting.command.inThread && holdForRoot({ kind: 'message' })) return;
          await runActingCommand(acting);
          return;
        }
        // A paste chip whose text a reload lost leaves the draft with a notice instead of sending.
        const settled = settlePastes();
        if (settled !== true && !(await settled)) return;
        if (holdForRoot({ kind: 'message' })) return;
        const textContent = buildTextContent(mode);
        // Sending the text answers the notices of files and pastes a reload lost.
        if (textContent) {
          dismissLostFiles();
          dismissLostPastes();
        }
        setSubmitPending(true);
        try {
          if (voiceActive && (await voice.submitIfActive(textContent))) return;
          const sending = sessions.startSendSession({ textContent });
          // The composer is free again once the send session owns the text.
          sendTypingStatus(false);
          await sending;
        } finally {
          if (mountedRef.current) setSubmitPending(false);
        }
      },
      [
        buildTextContent,
        commands,
        dismissLostFiles,
        dismissLostPastes,
        editor,
        holdForRoot,
        runActingCommand,
        sendTypingStatus,
        sessions,
        settlePastes,
        t,
        voice,
        voiceActive,
      ]
    );

    // Every send path goes through here: failures are logged once, and the promise still
    // rejects for a caller that awaits it. Without a mode picked from the Send button's menu, the
    // message takes the one the Chats settings name.
    const handleSend = useCallback(
      (mode?: MidTurnMode) => {
        const sending = submit(mode ?? midTurnSend);
        sending.catch((error: unknown) => {
          // eslint-disable-next-line no-console
          console.warn('[room-input] could not send the message', error);
        });
        return sending;
      },
      [midTurnSend, submit]
    );

    // Only `@` mentions, `:` emoji, and `!` and `/` commands with a match show a menu; anything
    // else sends on Enter.
    const slashQuery = isSlashCommandQuery(editor, autocompleteQuery)
      ? autocompleteQuery
      : undefined;
    let autocompleteMenuOpen = false;
    if (autocompleteQuery && isRoomInputAutocompleteQuery(autocompleteQuery)) {
      autocompleteMenuOpen =
        getCommandSuggestions(MINDROOM_COMMANDS, autocompleteQuery.text).length > 0;
    } else if (slashQuery) {
      autocompleteMenuOpen = getCommandSuggestions(commandList, slashQuery.text).length > 0;
    } else if (autocompleteQuery) {
      autocompleteMenuOpen =
        (autocompleteQuery.prefix === AutocompletePrefix.UserMention ||
          autocompleteQuery.prefix === AutocompletePrefix.Emoticon) &&
        !suggestionMenuEmpty;
    }

    const handleKeyDown = useCallback(
      (event: KeyboardEvent<HTMLDivElement>) => {
        if (isComposing(event.nativeEvent)) return;
        setCommandProblem(undefined);
        const keyEvent = event.nativeEvent ?? event;
        if (toggleKeyboardShortcut(editor, event)) return;
        // With a menu open, Enter picks its suggestion; it never sends then.
        if (autocompleteMenuOpen && isEnter(keyEvent)) {
          event.preventDefault();
          return;
        }
        const sendKey = enterForNewline || mobileOrTablet() ? isModEnter : isEnter;
        if (sendKey(keyEvent)) {
          event.preventDefault();
          void handleSend();
        }
      },
      [autocompleteMenuOpen, editor, enterForNewline, handleSend, isComposing]
    );

    const syncAutocompleteQuery = useCallback(() => {
      const range = getPrevWorldRange(editor);
      const query = range
        ? getAgentCommandQuery(editor, range) ??
          getAutocompleteQuery(editor, range, AUTOCOMPLETE_PREFIXES)
        : undefined;
      setAutocompleteQuery(query);
    }, [editor]);
    // Escape closes the suggestions as the key goes down; its release must not reopen them.
    const resyncAfterKey = useCallback(
      (event?: KeyboardEvent<HTMLDivElement>) => {
        if (event?.key !== 'Escape') syncAutocompleteQuery();
      },
      [syncAutocompleteQuery]
    );

    const handleChange = useCallback(() => {
      // Only an edit changes the saved draft. A draft put back into the editor (opening its
      // room, switching accounts, reloading) or a moved cursor leaves it as it was, and is
      // not typing.
      const draftAtom = roomIdToMsgDraftAtomFamily(
        getRoomInputDraftKey(userId, roomId, draftThreadId)
      );
      const draftBefore = store.get(draftAtom);
      saveDraft();
      attachments.onEditorChange();
      const empty = isEmptyEditor(editor);
      setEditorEmpty(empty);
      if (store.get(draftAtom) !== draftBefore) sendTypingStatus(!empty);
    }, [attachments, draftThreadId, editor, roomId, saveDraft, sendTypingStatus, store, userId]);

    const closeAutocomplete = useCallback(() => setAutocompleteQuery(undefined), []);
    const insertEmoji = useCallback(
      (insert: () => void) => {
        insert();
        moveCursor(editor);
      },
      [editor]
    );
    const sendSticker = useCallback(
      (mxc: string, label: string) => {
        if (holdForRoot({ kind: 'sticker', mxc, label })) return;
        const target = { roomId, threadId, replyDraft, threadingEnabled };
        sendComposerSticker(mx, target, { mxc, label }, imagePackRooms).catch((error: unknown) => {
          // eslint-disable-next-line no-console
          console.warn('[room-input] could not send the sticker', error);
        });
        if (replyDraft) clearReplyDraft({ roomId, replyDraft });
      },
      [
        clearReplyDraft,
        imagePackRooms,
        mx,
        replyDraft,
        roomId,
        holdForRoot,
        threadId,
        threadingEnabled,
      ]
    );
    rootConfirmedRef.current = (sends) =>
      sends.forEach((send) => {
        if (send.kind === 'sticker') sendSticker(send.mxc, send.label);
        else void handleSend();
      });
    const openBoard = (tab: EmojiBoardTab, anchor: RectCords) => {
      setBoardTab(tab);
      setEmojiAnchor(anchor);
    };
    const toggleFormatting = () => setFormattingOpen((open) => !open);

    const sendLabel = t('composer.sendMessage');
    const emojiLabel = t('composer.emoji');
    const attachLabel = t('composer.attach');
    const boardOpen = emojiAnchor !== undefined;

    const autocomplete =
      autocompleteQuery &&
      (isRoomInputAutocompleteQuery(autocompleteQuery) ? (
        <RoomInputAutocomplete
          editor={editor}
          query={autocompleteQuery}
          requestClose={closeAutocomplete}
        />
      ) : (
        <>
          {slashQuery && (
            <CommandAutocomplete
              editor={editor}
              query={slashQuery}
              title={t('featureUi.room.commandAutocomplete.commands')}
              commands={commandList}
              requestClose={closeAutocomplete}
            />
          )}
          {autocompleteQuery.prefix === AutocompletePrefix.UserMention && (
            <UserMentionAutocomplete
              room={room}
              editor={editor}
              query={autocompleteQuery}
              requestClose={closeAutocomplete}
              onSuggestionsChange={handleMenuSuggestions}
            />
          )}
          {autocompleteQuery.prefix === AutocompletePrefix.Emoticon && (
            <EmoticonAutocomplete
              packRooms={imagePackRooms}
              editor={editor}
              query={autocompleteQuery}
              requestClose={closeAutocomplete}
              onSuggestionsChange={handleMenuSuggestions}
            />
          )}
        </>
      ));

    return (
      <div ref={ref} style={COMPOSER_STYLE}>
        {autocomplete}
        {attachments.board}
        {/* After the staged files anchor, so that panel floats above the drop hint, not over it. */}
        {attachments.dropZoneVisible && (
          <Box
            direction="Column"
            alignItems="Center"
            gap="100"
            role="status"
            style={dropZoneStyle()}
          >
            <Icon size="400" src={Icons.File} />
            <Text size="H5" align="Center">
              {t('composer.dropFiles', {
                roomName: room.name
                  ? revealDirectionControls(room.name)
                  : t('composer.roomFallback'),
              })}
            </Text>
            <Text size="T300" align="Center">
              {t('composer.dropFilesHint')}
            </Text>
          </Box>
        )}
        {commandProblem && (
          <Text as="p" role="alert" size="T300" style={commandProblemStyle()}>
            {commandProblem}
          </Text>
        )}
        {lostFileNames.length > 0 && (
          <LostNotice
            text={t('composer.lostFiles', {
              files: lostFileNames.map(revealDirectionControls).join(', '),
            })}
            dismissLabel={t('composer.dismissLostFiles')}
            onDismiss={dismissLostFiles}
          />
        )}
        {attachments.lostPastes && (
          <LostNotice
            text={t('composer.lostPastes')}
            dismissLabel={t('composer.dismissLostFiles')}
            onDismiss={attachments.dismissLostPastes}
          />
        )}
        {voiceActive && voice.renderRecorder(() => void handleSend())}
        <CustomEditor
          editor={editor}
          editableName="RoomInput"
          styleMarkdown={isMarkdown}
          linkSchemes={linkSchemes}
          markdownCommands
          // The composer floats over the timeline and the cards, which scroll beneath it.
          className={glassDenseOverBackdrop}
          placeholder={forkFrom ? t('threadFork.continueInNewThread') : t('composer.placeholder')}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onKeyUp={resyncAfterKey}
          onPaste={attachments.onPaste}
          top={
            <>
              {replyDraft ? (
                <RoomInputReplyPreview
                  room={room}
                  replyDraft={replyDraft}
                  submitPending={submitPending}
                  onCancel={() => clearReplyDraft({ roomId, replyDraft })}
                />
              ) : (
                threadId &&
                (submitPending || waitingForRoot || sessions.joinedSendPending) && (
                  <RoomInputReplyContext room={room} relation={undefined} pendingSend />
                )
              )}
            </>
          }
          before={
            phone ? (
              <>
                {modelPicker}
                <ComposerActionsMenu
                  formattingOpen={formattingOpen}
                  onAttach={attachments.pickFiles}
                  onToggleFormatting={toggleFormatting}
                  onEmoji={(anchor) => openBoard('Emoji', anchor)}
                />
                {/* A fork draft records no voice: one would start a thread, not the fork. */}
                {!forkFrom && voice.microphone}
              </>
            ) : (
              <>
                {modelPicker}
                <ComposerIconButton
                  label={attachLabel}
                  icon={Icons.PlusCircle}
                  onPress={attachments.pickFiles}
                />
                {/* A fork draft records no voice: one would start a thread, not the fork. */}
                {!forkFrom && voice.microphone}
                <ComposerIconButton
                  label={t('composer.formatting')}
                  icon={Icons.Text}
                  pressed={formattingOpen}
                  onPress={toggleFormatting}
                />
              </>
            )
          }
          bottom={formattingOpen && <ComposerFormattingToolbar />}
          after={
            <>
              {!phone && (
                <ComposerIconButton
                  label={emojiLabel}
                  icon={Icons.Smile}
                  pressed={boardOpen && boardTab === 'Emoji'}
                  onPress={(event) =>
                    openBoard('Emoji', event.currentTarget.getBoundingClientRect())
                  }
                />
              )}
              <PopOut
                anchor={emojiAnchor}
                position="Top"
                align={phone ? 'Start' : 'End'}
                offset={16}
                content={
                  <EmojiBoard
                    imagePackRooms={imagePackRooms}
                    // A fork draft offers no stickers: one would start a thread, not the fork.
                    tab={forkFrom ? 'Emoji' : boardTab}
                    onTabChange={setBoardTab}
                    onStickerSelect={
                      forkFrom ? undefined : (mxc, _shortcode, label) => sendSticker(mxc, label)
                    }
                    returnFocusOnDeactivate={false}
                    requestClose={() => setEmojiAnchor(undefined)}
                    onEmojiSelect={(unicode) =>
                      insertEmoji(() => SlateEditor.insertText(editor, unicode))
                    }
                    onCustomEmojiSelect={(mxc, shortcode) =>
                      insertEmoji(() =>
                        SlateEditor.insertNode(editor, createEmoticonElement(mxc, shortcode))
                      )
                    }
                  />
                }
              />
              <ComposerSendButton
                label={sendLabel}
                alone={phone}
                agentReplying={agentReplying}
                hasText={() => buildTextContent(midTurnSend) !== undefined}
                empty={editorEmpty}
                defaultMode={midTurnSend}
                onSend={handleSend}
              />
            </>
          }
        />
      </div>
    );
  }
);

RoomInput.displayName = 'RoomInput';
