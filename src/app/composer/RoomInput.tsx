import React, {
  ClipboardEvent,
  DragEvent,
  forwardRef,
  KeyboardEvent,
  ReactNode,
  RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ReactEditor } from 'slate-react';
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
import { createEmoticonElement, moveCursor } from '../editor/utils';
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
import { useRoomName } from '../matrix/hooks/useRoomMeta';
import { useRoomThreadMode } from '../matrix/hooks/useRoomThreadMode';
import { mDirectAtom } from '../matrix/state/mDirectList';
import { useTypingStatusUpdater } from './useTypingStatusUpdater';
import { useSetting } from '../preferences/useSetting';
import {
  getHomeAskDraftKey,
  getRoomInputDraftKey,
  homeAskDestinationAtomFamily,
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
import { getModelController } from '../models/modelController';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { hasExplicitThreadContext, hasMatchingReplyDraft } from './roomInputSendSession';
import { ComposerIconButton } from './ComposerIconButton';
import { ComposerFormattingToolbar } from './ComposerFormattingToolbar';
import { ComposerActionsMenu } from './ComposerActionsMenu';
import { ComposerAttachButton } from './ComposerAttachButton';
import { ComposerSendButton } from './ComposerSendButton';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { composeTextMessage, holdsNoText, withMention } from './composeTextMessage';
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
import { hasSendableStagedFiles } from './roomInputAttachmentAccess';
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
import { VoiceMessageIcon } from './voice/VoiceMessageIcon';
import { useRoomInputDictation } from './dictation/useRoomInputDictation';
import { handoffComposerDictationSend } from './dictation/dictationSendHandoff';
import { useVoiceComposer } from './voiceHoldShortcut';
import { isComposerExpanded, useComposerFocus } from './composerExpansion';
import { type HeldSend, useUnconfirmedRootSends } from './useUnconfirmedRootSends';
import { type ThreadForkRef, threadForkDraftId } from '../event-store/threads/threadFork';
import { useThreadStreamingState } from '../event-store/threads/useThreadStreamingState';
import { isLocalEchoEventId } from '../event-store/threads/threadRouteUtils';
import { MID_TURN_MODE_KEY } from '../matrix/protocol/midTurn';
import type { MidTurnMode } from '../preferences/midTurnModes';

export type RoomInputProps = {
  editor: Editor;
  /** The area that accepts dropped files, usually the whole room view. */
  fileDropContainerRef: RefObject<HTMLElement | null>;
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
  /**
   * Home's ask field: text only, kept under the account's Home draft whichever room it goes to.
   * Each message starts a thread addressed to `agentUserId`; `pickers` (who answers, and where)
   * take the row's controls' place. Nothing sends while `canSend` says no: asked at the press,
   * and again for the question on its way, with the room it goes to (`sentTo`), just before its
   * message goes out, when that room or the agent may have changed. `onSendingChange` hears
   * while a send is on its way, to its end, and `onLocalEcho` of the message the client made for
   * it and the room that is in, both also after the composer has gone. A send keeps the three as
   * they were at its press, whatever the field shows by then. `isDirect` says the room was picked
   * as the agent's direct chat, which a question returned to Home's draft keeps.
   */
  ask?: {
    agentUserId: string;
    isDirect?: boolean;
    placeholder: string;
    pickers: ReactNode;
    canSend: (sentTo?: Room) => boolean;
    onSendingChange?: (sending: boolean) => void;
    onLocalEcho?: (eventId: string, room: Room) => void;
  };
};

// Home's ask field takes text only: nothing dropped goes in, neither a file nor a paste chip
// dragged out of a room's composer.
const refuseDrop = (event: DragEvent<HTMLElement>) => event.preventDefault();

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
  return withPasteAttachmentMetadata(content, item.metadata.mindroomPasteAttachment);
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
      ask,
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
    const textKey = ask
      ? getHomeAskDraftKey(userId)
      : getRoomInputDraftKey(userId, roomId, draftThreadId);
    // Home's ask field scopes paste cleanup to its own draft key, never touching the destination
    // room's saved pastes.
    const draftKey = ask || draftThreadId ? textKey : undefined;
    // Another view of the room (a plugin's thread view) has a reply of its own. A fork draft takes
    // none: the reply chosen in its thread stays for the thread.
    const view = useContext(ConversationViewContext);
    const viewReplyDraft = useAtomValue(composerReplyDraftAtom(roomId, view));
    const replyDraft = forkFrom || ask ? undefined : viewReplyDraft;
    // The placeholder says where sent text goes: into the thread it joins, or, from the timeline, a
    // new thread only where every agent of the room answers in threads (mode `thread`); mixed or
    // unknown modes promise nothing. Files sent with text, or several files, start a thread of their
    // own (`getRoomInputSendMode`); the placeholder speaks for text alone.
    const roomThreadMode = useRoomThreadMode(roomId, true);
    const newThread =
      !ask &&
      threadingEnabled &&
      !threadId &&
      !forkFrom &&
      !replyDraft &&
      roomThreadMode === 'thread';
    const roomName = revealDirectionControls(useRoomName(room) || t('composer.roomFallback'));
    const direct = useAtomValue(mDirectAtom).has(roomId);
    let placeholder = t('composer.placeholder');
    if (forkFrom) placeholder = t('threadFork.continueInNewThread');
    else if (hasExplicitThreadContext(threadId, replyDraft, threadingEnabled))
      placeholder = t('composer.replyInThread');
    else if (newThread)
      placeholder = direct
        ? t('composer.newThreadWith', { name: roomName })
        : t('composer.newThreadIn', { room: roomName });
    const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
    // Typing in Home's ask field tells no room: the room it would go to is not open.
    const sendTypingStatus = useTypingStatusUpdater(mx, roomId, hideActivity || !!ask);
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
    // Whether the editor holds no text to send, blank lines at most, for the Send button's menu.
    // It changes only as it flips, so typing renders nothing more.
    const parseCommands = !ask;
    const [noText, setNoText] = useState(() => holdsNoText(editor, parseCommands));
    // Whether it shows nothing typed, for its layout: a lone `/me` is no text to send but shows.
    const [empty, setEmpty] = useState(() => isEmptyEditor(editor));
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
      <ThreadModelPicker
        room={room}
        threadId={threadId}
        newThread={newThread}
        conversationHidden={conversationHidden}
      />
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
    const rootConfirmedRef = useRef<(sends: HeldSend[]) => void>(undefined);
    const { hold: holdForRoot, waiting: waitingForRoot } = useUnconfirmedRootSends({
      room,
      roomId,
      threadId,
      userId,
      onConfirmedRef: rootConfirmedRef,
    });
    const saveDraft = useRoomInputDraft(editor, textKey);
    const { lostFileNames, dismissLostFiles } = useKeptComposerState(userId, roomId);
    const linkSchemes = useOptionalClientConfig()?.messageRendering?.additionalAllowedUriSchemes;
    const commands = useCommands(room, threadingEnabled ? threadId : undefined);
    // Home's ask field does not run client slash commands (such as /leave) on an unseen room.
    const commandList = useMemo(() => (ask ? [] : Object.values(commands)), [ask, commands]);
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

    const restoreReplyDraft = useCallback(
      (saved: IReplyDraft) => {
        const replyAtom = composerReplyDraftAtom(roomId, view);
        if (store.get(replyAtom) !== undefined) return;
        store.set(replyAtom, saved);
        if (userId && view === undefined) keepReplyDraft(userId, roomId, saved);
      },
      [roomId, store, userId, view]
    );

    const restoreDictationAttachments = useCallback(
      (targetRoomId: string, items: TUploadItem[]) => {
        const existing = new Set(
          attachments.access.snapshot(targetRoomId).staged.map((item) => item.file)
        );
        const missing = items.filter((item) => !existing.has(item.file));
        if (missing.length > 0) attachments.access.append(targetRoomId, missing);
      },
      [attachments.access]
    );

    const askedAgent = ask?.agentUserId;
    const askedDirect = !!ask?.isDirect;
    const restoreComposerFallbackForRoom = useCallback(
      (fallbackRoomId: string, fragment: Descendant[], fallbackThreadId?: string) => {
        // Home's question returns to Home's draft alone, never to a room's, and that draft goes
        // where the question went: as it does already, since nothing moves it while a question
        // is being sent. Set to what it is, it writes nothing.
        if (askedAgent !== undefined) {
          store.set(homeAskDestinationAtomFamily(userId), {
            agentId: askedAgent,
            roomId: fallbackRoomId,
            ...(askedDirect ? { isDirect: true } : {}),
          });
        }
        // After any text typed there since: a failed caption is never dropped.
        restoreTextToDraft(
          store,
          askedAgent === undefined
            ? getRoomInputDraftKey(userId, fallbackRoomId, fallbackThreadId)
            : textKey,
          fragment
        );
      },
      [askedAgent, askedDirect, store, textKey, userId]
    );

    const rootModelContext = useLatestRef({ roomId, newThread });
    const takeRootModelDraft = useCallback(
      (target: Room) => {
        const { roomId: liveRoomId, newThread: liveNewThread } = rootModelContext.current;
        return mountedRef.current && liveNewThread && liveRoomId === target.roomId
          ? getModelController(mx).takeRootModelDraft(target)
          : undefined;
      },
      [mx, rootModelContext]
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
      takeRootModelDraft,
    });

    const { restoreText: restoreSentText } = sessions;
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
        // Into the editor only while it still shows that room and thread, as a failed text send
        // is: asked from a send that began before the composer moved on, it goes to that draft.
        restoreText: (restoreRoomId: string, fragment: Descendant[], restoreThreadId?: string) =>
          restoreSentText({ roomId: restoreRoomId, threadId: restoreThreadId }, fragment),
        clearConsumedReply: clearReplyDraft,
      }),
      [
        clearReplyDraft,
        editor,
        replyDraft,
        restoreSentText,
        room,
        roomId,
        threadId,
        threadingEnabled,
        view,
      ]
    );

    const rootRef = useRef<HTMLDivElement | null>(null);
    const dictationOwnerKey = `${textKey}:${view ?? 'room'}`;
    const dictation = useRoomInputDictation({
      editor,
      roomId,
      threadId,
      thread: threadId !== undefined || forkFrom !== undefined,
      ownerKey: dictationOwnerKey,
      sendKey: textKey,
      draftKey: textKey,
      rootRef,
      containerRef: fileDropContainerRef,
      onCommandProblem: setCommandProblem,
      restoreAttachments: restoreDictationAttachments,
      restoreReplyDraft,
      saveDraft,
    });

    // A fork draft neither shows nor sends a recording: one would start a thread, not the fork.
    // Home's ask field takes text only, so it neither shows nor sends a recording either. Neither
    // brings one back from disk: it would hold it from a tab that can show it.
    const voiceActive = !forkFrom && !ask;
    const voice = useRoomInputVoice({
      mx,
      composer,
      attachments: attachments.access,
      transport,
      sessions,
      takeRootModelDraft,
      onRoomMessageSent,
      recover: voiceActive,
    });

    // Every text message says what MindRoom does with it should it arrive while an agent replies
    // in its thread; the send session keeps it on the message for a retry. A question asked from
    // Home mentions its agent, so that agent answers in a room with several.
    const buildTextContent = useCallback(
      (mode: MidTurnMode): IContent | undefined => {
        const content = composeTextMessage(
          editor,
          isMarkdown,
          mx.getUserId() ?? undefined,
          linkSchemes,
          parseCommands
        );
        if (!content) return undefined;
        const addressed = askedAgent ? withMention(content, askedAgent) : content;
        return { ...addressed, [MID_TURN_MODE_KEY]: mode };
      },
      [askedAgent, editor, isMarkdown, linkSchemes, mx, parseCommands]
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
          // A composer that went away meanwhile keeps the text in its own draft.
          composer.restoreText(roomId, typed, draftThreadId);
          if (mountedRef.current) setCommandProblem(describeCommandFailure(t, acting, error));
        } finally {
          if (mountedRef.current) setSubmitPending(false);
        }
      },
      [composer, draftThreadId, roomId, sendTypingStatus, t]
    );

    const dictationHandoffRef = useLatestRef({
      composerKey: dictationOwnerKey,
      ownerKey: textKey,
      draftKey: textKey,
      room,
      roomId,
      roomName,
      threadId,
      draftThreadId,
      replyDraft,
      threadingEnabled,
      forkFrom,
      isMarkdown,
      linkSchemes,
      parseCommands,
      commands,
      ask,
      restoreReplyDraft,
      sessions,
    });

    const submit = useCallback(
      async (
        explicitMode: MidTurnMode | undefined,
        waited: boolean,
        options?: { voiceOnly?: boolean }
      ) => {
        const voiceOnly = options?.voiceOnly === true;
        if (voiceActive && voice.blocksSubmit()) return;
        const mode = explicitMode ?? midTurnSend;
        const liveDictation = voiceOnly ? 'idle' : dictation.getLiveStatus();
        if (liveDictation === 'blocked') return;
        if (!waited && liveDictation === 'sendable') {
          const startKey = dictationHandoffRef.current.composerKey;
          const settled = ask ? true : settlePastes();
          if (settled !== true) {
            const ok = await settled.catch(() => false);
            if (
              !ok ||
              !mountedRef.current ||
              dictationHandoffRef.current.composerKey !== startKey
            ) {
              return;
            }
            if (settlePastes() !== true) return;
          }
          const { composerKey: _composerKey, ...live } = dictationHandoffRef.current;
          if (isLocalEchoEventId(live.threadId) || (live.ask && !live.ask.canSend())) return;
          const detached = dictation.detachForSend();
          if (!detached) return;
          handoffComposerDictationSend({
            ...live,
            store,
            mx,
            editor,
            composerContext: { roomId: live.roomId, threadId: live.draftThreadId },
            session: detached.session,
            savedSelection: detached.savedSelection,
            preExistingContent: buildTextContent(mode),
            midTurnMode: mode,
            explicitMidTurnMode: explicitMode !== undefined,
            ownUserId: mx.getUserId() ?? undefined,
            attachments: attachments.access,
            takeRootModelDraft,
            restoreRootModelDraft: (target, content) =>
              getModelController(mx).restoreRootModelDraft(target, content),
            uploadItem: transport.uploadItem,
            clearReplyDraft,
            resetComposer: composer.resetText,
            stopTyping: () => sendTypingStatus(false),
            dismissLostNotices: () => {
              dismissLostFiles();
              dismissLostPastes();
            },
          });
          return;
        }
        if (!ask) {
          // A `/word` that is no command, such as a typo of one, stays in the composer unsent; one
          // of MindRoom's commands (`/schedule`) has no `run` and goes out as typed.
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
        }
        // A paste chip whose text a reload lost leaves the draft with a notice instead of sending.
        // Home's ask field restores and stages none.
        const settled = ask ? true : settlePastes();
        // Sending the text answers the notices of files and pastes a reload lost.
        const takeText = (resolvedMode: MidTurnMode = mode) => {
          const content = buildTextContent(resolvedMode);
          if (content && !ask) {
            dismissLostFiles();
            dismissLostPastes();
          }
          return content;
        };
        // A Send takes the recording at the press (useRoomInputVoice's `sendAtPress`), before
        // anything here waits: what follows is only for a Send without a voice message. One that
        // `waited` for its root and goes out now is no press, and takes no recording made since.
        const voiceSend =
          voiceActive && !waited
            ? voice.sendAtPress(takeText, settled !== true, explicitMode)
            : undefined;
        if (voiceSend) {
          setSubmitPending(true);
          await voiceSend.finally(() => {
            if (mountedRef.current) setSubmitPending(false);
          });
          return;
        }
        if (voiceOnly) return;
        if (settled !== true && !(await settled)) return;
        if (holdForRoot({ kind: 'message', mode: explicitMode })) return;
        const textContent = takeText();
        // Home's ask field sends text alone: with none there is no send to tell of.
        if (ask && !textContent) return;
        setSubmitPending(true);
        ask?.onSendingChange?.(true);
        try {
          const sending = sessions.startSendSession({
            textContent,
            midTurnMode: mode,
            explicitMidTurnMode: explicitMode !== undefined,
            // Home's question is asked about, and told of, as it was at this press.
            beforeSend: ask && ((sentTo) => ask.canSend(sentTo)),
            onLocalEchoCreated: ask?.onLocalEcho,
          });
          // The composer is free again once the send session owns the text.
          sendTypingStatus(false);
          await sending;
        } finally {
          ask?.onSendingChange?.(false);
          if (mountedRef.current) setSubmitPending(false);
        }
      },
      [
        ask,
        attachments.access,
        buildTextContent,
        clearReplyDraft,
        commands,
        composer,
        dictation,
        dictationHandoffRef,
        dismissLostFiles,
        dismissLostPastes,
        editor,
        holdForRoot,
        midTurnSend,
        mx,
        runActingCommand,
        sendTypingStatus,
        sessions,
        settlePastes,
        store,
        t,
        takeRootModelDraft,
        transport.uploadItem,
        voice,
        voiceActive,
      ]
    );

    // Every send path goes through here: failures are logged once, and the promise still
    // rejects for a caller that awaits it. Without a mode picked from the Send button's menu, the
    // message takes the one the Chats settings name. `waited`: held for its thread's root till now.
    const askBlocked = !!ask && !ask.canSend();
    const handleSend = useCallback(
      (explicitMode?: MidTurnMode, waited = false, options?: { voiceOnly?: boolean }) => {
        if (ask && !ask.canSend()) return Promise.resolve();
        const sending = submit(explicitMode, waited, options);
        sending.catch((error: unknown) => {
          // eslint-disable-next-line no-console
          console.warn('[room-input] could not send the message', error);
        });
        return sending;
      },
      [ask, submit]
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
        ? (getAgentCommandQuery(editor, range) ??
          getAutocompleteQuery(editor, range, AUTOCOMPLETE_PREFIXES))
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
      const draftAtom = roomIdToMsgDraftAtomFamily(textKey);
      const draftBefore = store.get(draftAtom);
      saveDraft();
      attachments.onEditorChange();
      const empty = isEmptyEditor(editor);
      setNoText(holdsNoText(editor, parseCommands));
      setEmpty(empty);
      // An empty editor holds no query. The query follows key releases, and a reset (a send by
      // tap, a cleared draft) comes without one, which would leave it naming text that is gone.
      if (empty) setAutocompleteQuery(undefined);
      if (store.get(draftAtom) !== draftBefore) sendTypingStatus(!empty);
    }, [attachments, editor, parseCommands, saveDraft, sendTypingStatus, store, textKey]);

    // Home's ask field takes text only: of a paste, the plain text, split in lines as Slate
    // pastes it, never a file or a paste chip copied from a room's composer.
    const pasteTextOnly = useCallback(
      (event: ClipboardEvent<HTMLElement>) => {
        event.preventDefault();
        editor.insertTextData(event.clipboardData);
      },
      [editor]
    );

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
        else void handleSend(send.mode, true);
      });
    const openBoard = (tab: EmojiBoardTab, anchor: RectCords) => {
      setBoardTab(tab);
      setEmojiAnchor(anchor);
    };
    const toggleFormatting = () => setFormattingOpen((open) => !open);
    const hasVoice = voiceActive && voice.hasVoice;
    const recorder = voiceActive
      ? voice.renderRecorder(() => void handleSend(undefined, false, { voiceOnly: true }))
      : null;
    // Two rows, text over controls; a phone shows one row until the user writes (`isComposerExpanded`).
    // Only a phone's composer follows focus; elsewhere it always shows two rows.
    const focus = useComposerFocus(phone);
    const { setRoot } = focus;
    const setComposerRef = useCallback(
      (node: HTMLDivElement | null) => {
        rootRef.current = node;
        setRoot(node);
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      },
      [ref, setRoot]
    );
    // The voice key records here (useVoiceHoldShortcut): a send takes the same path as Enter,
    // and only from a composer with nothing else in it. In a thread whose root is unconfirmed, the
    // key sends nothing (the recording keeps going), as Enter's send would wait for the root.
    useVoiceComposer(
      voiceActive
        ? {
            ...voice.voiceKey,
            root: () => rootRef.current,
            container: () => fileDropContainerRef?.current ?? null,
            thread: threadId !== undefined,
            hasContent: () =>
              !isEmptyEditor(editor) || attachments.access.snapshot().staged.length > 0,
            send: () => {
              if (!isLocalEchoEventId(threadId)) void handleSend();
            },
            focus: () => ReactEditor.focus(editor),
          }
        : forkFrom
          ? {
              root: () => rootRef.current,
              container: () => fileDropContainerRef?.current ?? null,
              thread: true,
              disabled: true,
            }
          : undefined
    );
    const expanded = isComposerExpanded({
      phone,
      focused: focus.focused,
      pressing: focus.pressing,
      empty,
      // Home's ask field keeps both rows, so its pickers have the row to themselves.
      busy:
        !!ask ||
        !!replyDraft ||
        !!attachments.board ||
        !!recorder ||
        !!dictation.capsule ||
        emojiAnchor !== undefined ||
        autocompleteMenuOpen ||
        formattingOpen,
    });

    const dictationCanSend = Boolean(dictation.canSend);
    const sendLabel = dictationCanSend
      ? t('composer.dictation.finishAndSend')
      : t('composer.sendMessage');
    const emojiLabel = t('composer.emoji');
    const boardOpen = emojiAnchor !== undefined;
    const composerEmpty = noText && !attachments.hasSendableFiles && !hasVoice && !dictationCanSend;
    const showPhoneEmptyVoice =
      phone && !ask && dictation.available && !forkFrom && !dictation.active && composerEmpty;

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
      <div
        ref={setComposerRef}
        // Home's column sets the field's width itself.
        style={ask ? undefined : COMPOSER_STYLE}
        data-composer-expanded={expanded}
        // Only a press on the expanded composer holds it open (`isComposerExpanded`).
        onPointerDown={phone && expanded ? focus.onPointerDown : undefined}
      >
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
        {!ask && lostFileNames.length > 0 && (
          <LostNotice
            text={t('composer.lostFiles', {
              files: lostFileNames.map(revealDirectionControls).join(', '),
            })}
            dismissLabel={t('composer.dismissLostFiles')}
            onDismiss={dismissLostFiles}
          />
        )}
        {!ask && attachments.lostPastes && (
          <LostNotice
            text={t('composer.lostPastes')}
            dismissLabel={t('composer.dismissLostFiles')}
            onDismiss={attachments.dismissLostPastes}
          />
        )}
        {recorder}
        {dictation.capsule}
        <CustomEditor
          editor={editor}
          editableName="RoomInput"
          layout={expanded ? 'stacked' : 'row'}
          styleMarkdown={isMarkdown}
          linkSchemes={linkSchemes}
          markdownCommands
          // The composer floats over the timeline and the cards, which scroll beneath it.
          className={glassDenseOverBackdrop}
          // A phone keeps the formatting toolbar in a row of its own however wide its composer.
          inlineBottom={!phone}
          placeholder={ask?.placeholder ?? placeholder}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onKeyUp={resyncAfterKey}
          onPaste={ask ? pasteTextOnly : attachments.onPaste}
          onDrop={ask ? refuseDrop : undefined}
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
            ask?.pickers ??
            (phone ? (
              <>
                {modelPicker}
                <ComposerActionsMenu
                  formattingOpen={formattingOpen}
                  onAttach={attachments.pickFiles}
                  onAttachAppLogs={attachments.attachAppLogs}
                  onToggleFormatting={toggleFormatting}
                  onEmoji={(anchor) => openBoard('Emoji', anchor)}
                  voiceAction={
                    dictation.available && !forkFrom && !showPhoneEmptyVoice
                      ? {
                          label: voice.microphoneLabel,
                          icon: VoiceMessageIcon,
                          disabled: voice.microphoneDisabled,
                          onSelect: () => {
                            voice.startRecording();
                          },
                        }
                      : undefined
                  }
                />
                {!dictation.available && !forkFrom && voice.microphone}
              </>
            ) : (
              <>
                {modelPicker}
                <ComposerAttachButton
                  onAttach={attachments.pickFiles}
                  onAttachAppLogs={attachments.attachAppLogs}
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
            ))
          }
          bottom={formattingOpen && <ComposerFormattingToolbar />}
          after={
            <>
              {!phone && !ask && (
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
              {dictation.button}
              {showPhoneEmptyVoice ? (
                voice.microphone
              ) : (
                <ComposerSendButton
                  label={sendLabel}
                  alone={phone && !dictation.available}
                  agentReplying={agentReplying}
                  hasContent={() =>
                    buildTextContent(midTurnSend) !== undefined ||
                    hasSendableStagedFiles(attachments.access.snapshot()) ||
                    hasVoice ||
                    dictationCanSend
                  }
                  empty={composerEmpty}
                  defaultMode={midTurnSend}
                  disabled={askBlocked || dictation.blocksSubmit}
                  onSend={handleSend}
                />
              )}
            </>
          }
        />
      </div>
    );
  }
);

RoomInput.displayName = 'RoomInput';
