import React, {
  forwardRef,
  KeyboardEvent,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useAtomValue, useStore } from 'jotai';
import { isKeyHotkey } from 'is-hotkey';
import { type IContent, MsgType, type Room } from 'matrix-js-sdk';
import type { Descendant, Editor } from 'slate';
import { Box, Icon, Icons, IconSrc, PopOut, RectCords, Text, color, config } from 'folds';
import { Editor as SlateEditor } from 'slate';
import {
  AUTOCOMPLETE_PREFIXES,
  AutocompletePrefix,
  type AutocompleteQuery,
  CustomEditor,
  customHtmlEqualsPlainText,
  getAutocompleteQuery,
  getBeginCommand,
  getMentions,
  getPrevWorldRange,
  isEmptyEditor,
  resetEditor,
  resetEditorHistory,
  toMatrixCustomHTML,
  toPlainText,
  trimCommand,
  trimCustomHtml,
  UserMentionAutocomplete,
} from '../../components/editor';
import {
  createEmoticonElement,
  moveCursor,
  restoreEditorContent,
} from '../../components/editor/utils';
import { EmojiBoard } from '../../components/emoji-board';
import { IconButton } from '../../components/glass/GlassPrimitives';
import {
  getAudioMsgContent,
  getFileMsgContent,
  getImageMsgContent,
  getVideoMsgContent,
} from '../../features/room/msgContent';
import { useComposingCheck } from '../../hooks/useComposingCheck';
import { useImagePackRooms } from '../../hooks/useImagePackRooms';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useTypingStatusUpdater } from '../../hooks/useTypingStatusUpdater';
import { useSetting } from '../../state/hooks/settings';
import {
  getRoomInputDraftKey,
  type IReplyDraft,
  roomIdToMsgDraftAtomFamily,
  roomIdToReplyDraftAtomFamily,
  type TUploadItem,
} from '../../state/room/roomInputDrafts';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import { settingsAtom } from '../../state/settings';
import { mobileOrTablet } from '../../utils/user-agent';
import { withMindroomPasteAttachmentMetadata } from '../messages/pasteAttachmentMarker';
import { getMindroomCommandSuggestions } from '../commands/mindroomCommandSuggestions';
import { ThreadModelPicker } from '../models/ModelPicker';
import { hasMatchingReplyDraft } from '../threads/roomInputSendSession';
import { IconTooltip } from '../tooltip/IconTooltip';
import {
  getMindroomRoomInputAutocompleteQuery,
  isMindroomRoomInputAutocompleteQuery,
  MindroomRoomInputAutocomplete,
  MindroomRoomInputReplyContext,
  useRoomInputSendSessionController,
} from './RoomInputMindroomExtensions';
import { RoomInputReplyPreview } from './RoomInputReplyPreview';
import { createMindroomRoomUploadItems } from './roomInputUploadPreparation';
import { useRoomInputAttachments } from './useRoomInputAttachments';
import { useRoomInputDraft } from './useRoomInputDraft';
import {
  getVoiceMessageContentOptions,
  useRoomInputUploadTransport,
} from './useRoomInputUploadTransport';
import { useRoomInputVoice } from './useRoomInputVoice';

export { createMindroomRoomUploadItems } from './roomInputUploadPreparation';

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

/** A leading `/me` or `/notice` picks the message type; the command itself is not sent. */
const COMMAND_MSGTYPES: ReadonlyMap<string, MsgType> = new Map([
  ['me', MsgType.Emote],
  ['notice', MsgType.Notice],
]);

/** The message the composer holds, or undefined when no text is left to send. */
const composeTextMessage = (
  editor: Editor,
  markdown: boolean,
  ownUserId: string | undefined
): IContent | undefined => {
  const command = getBeginCommand(editor);
  const commandType = command === undefined ? undefined : COMMAND_MSGTYPES.get(command);
  const withoutCommand = (value: string): string =>
    command !== undefined && commandType !== undefined ? trimCommand(command, value) : value;

  const body = withoutCommand(toPlainText(editor.children, markdown).trim());
  if (body === '') return undefined;
  const html = withoutCommand(
    trimCustomHtml(
      toMatrixCustomHTML(editor.children, {
        allowInlineMarkdown: markdown,
        allowBlockMarkdown: markdown,
        allowTextFormatting: true,
      })
    )
  );

  // Intentional mentions (MSC3952): only the users and @room the composer holds as pills.
  const { users, room: mentionsRoom } = getMentions(editor, ownUserId);
  const mentions: { user_ids?: string[]; room?: boolean } = {};
  if (users.size > 0) mentions.user_ids = [...users];
  if (mentionsRoom) mentions.room = true;

  const formatted = customHtmlEqualsPlainText(html, body)
    ? {}
    : { format: 'org.matrix.custom.html', formatted_body: html };
  return { msgtype: commandType ?? MsgType.Text, body, ...formatted, 'm.mentions': mentions };
};

type ComposerIconButtonProps = {
  label: string;
  icon: IconSrc;
  /** Pressed state of a toggle, which also fills its icon. */
  pressed?: boolean;
  variant?: 'Primary' | 'SurfaceVariant';
  onPress: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

/** An icon-only composer button, named by its tooltip and its aria-label alike. */
function ComposerIconButton({
  label,
  icon,
  pressed,
  variant = 'SurfaceVariant',
  onPress,
}: ComposerIconButtonProps) {
  return (
    <IconTooltip position="Top" label={label}>
      {(triggerRef) => (
        <IconButton
          ref={triggerRef}
          onClick={onPress}
          aria-label={label}
          aria-pressed={pressed}
          variant={variant}
          radii="300"
          size="300"
        >
          <Icon src={icon} filled={pressed} />
        </IconButton>
      )}
    </IconTooltip>
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
  return withMindroomPasteAttachmentMetadata(
    content,
    item.metadata.mindroomPasteAttachment
  ) as IContent;
};

/**
 * The composer: text with Markdown, mentions and MindRoom `!` commands, attachments (picked,
 * dropped, pasted, or large pastes as files), voice messages, and the reply being written. One
 * send session carries text and attachments in order; a voice message joins it when sent from
 * the primary Send button.
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
    },
    ref
  ) => {
    const { t } = useTranslation();
    const mx = useMatrixClient();
    const store = useStore();
    const [isMarkdown] = useSetting(settingsAtom, 'isMarkdown');
    const [enterForNewline] = useSetting(settingsAtom, 'enterForNewline');
    const userId = mx.getUserId() ?? '';
    const draftKey = threadId ? getRoomInputDraftKey(userId, roomId, threadId) : undefined;
    const replyDraft = useAtomValue(roomIdToReplyDraftAtomFamily(roomId));
    const sendTypingStatus = useTypingStatusUpdater(mx, roomId);
    const isComposing = useComposingCheck();
    const [autocompleteQuery, setAutocompleteQuery] = useState<AutocompleteQuery<string>>();
    // Set when the mention menu reports that an `@` query matches no member, so it shows nothing.
    const [mentionMenuEmpty, setMentionMenuEmpty] = useState(false);
    const handleMentionSuggestions = useCallback(
      (hasSuggestions: boolean) => setMentionMenuEmpty(!hasSuggestions),
      []
    );
    const [submitPending, setSubmitPending] = useState(false);
    const [emojiAnchor, setEmojiAnchor] = useState<RectCords>();
    const imagePackRooms = useImagePackRooms(roomId, useAtomValue(roomToParentsAtom));
    const mountedRef = useRef(true);
    const saveDraft = useRoomInputDraft(editor, userId, roomId, threadId);

    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    }, []);

    const createUploadItems = useCallback(
      (files: File[], getMetadata?: Parameters<typeof createMindroomRoomUploadItems>[2]) =>
        createMindroomRoomUploadItems(files, room, getMetadata),
      [room]
    );
    const attachments = useRoomInputAttachments({
      mx,
      room,
      roomId,
      draftKey,
      editor,
      isMarkdown,
      fileDropContainerRef,
      createUploadItems,
    });
    const transport = useRoomInputUploadTransport(mx, store, room);

    const clearReplyDraft = useCallback(
      ({
        roomId: replyRoomId,
        replyDraft: consumed,
      }: {
        roomId: string;
        replyDraft?: IReplyDraft;
      }) => {
        const replyAtom = roomIdToReplyDraftAtomFamily(replyRoomId);
        // A reply chosen after this send started stays for the next message.
        if (consumed && hasMatchingReplyDraft(consumed, store.get(replyAtom))) {
          store.set(replyAtom, undefined);
        }
      },
      [store]
    );

    const restoreComposerFallbackForRoom = useCallback(
      (fallbackRoomId: string, fragment: Descendant[], fallbackThreadId?: string) => {
        if (fragment.length === 0) return;
        const draftAtom = roomIdToMsgDraftAtomFamily(
          getRoomInputDraftKey(userId, fallbackRoomId, fallbackThreadId)
        );
        if (store.get(draftAtom).length === 0) store.set(draftAtom, fragment);
      },
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
    });

    const composer = useMemo(
      () => ({
        getContext: () => ({ roomId, room, threadId, replyDraft, threadingEnabled }),
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
      ]
    );

    const voice = useRoomInputVoice({
      mx,
      roomId,
      composer,
      attachments: attachments.access,
      transport,
      sessions,
      onRoomMessageSent,
    });

    const buildTextContent = useCallback(
      (): IContent | undefined =>
        composeTextMessage(editor, isMarkdown, mx.getUserId() ?? undefined),
      [editor, isMarkdown, mx]
    );

    const submit = useCallback(async () => {
      if (voice.blocksSubmit()) return;
      const textContent = buildTextContent();
      setSubmitPending(true);
      try {
        if (await voice.submitIfActive(textContent)) return;
        const sending = sessions.startSendSession({ textContent });
        // The composer is free again once the send session owns the text.
        sendTypingStatus(false);
        await sending;
      } finally {
        if (mountedRef.current) setSubmitPending(false);
      }
    }, [buildTextContent, sendTypingStatus, sessions, voice]);

    // Every send path goes through here: failures are logged once, and the promise still
    // rejects for a caller that awaits it.
    const handleSend = useCallback(() => {
      const sending = submit();
      sending.catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[room-input] could not send the message', error);
      });
      return sending;
    }, [submit]);

    // Only `@` mentions and `!` commands with a match show a menu; anything else sends on Enter.
    let autocompleteMenuOpen = false;
    if (autocompleteQuery && isMindroomRoomInputAutocompleteQuery(autocompleteQuery)) {
      autocompleteMenuOpen = getMindroomCommandSuggestions(autocompleteQuery.text).length > 0;
    } else if (autocompleteQuery) {
      autocompleteMenuOpen =
        autocompleteQuery.prefix === AutocompletePrefix.UserMention && !mentionMenuEmpty;
    }

    const handleKeyDown = useCallback(
      (event: KeyboardEvent<HTMLDivElement>) => {
        if (isComposing(event.nativeEvent)) return;
        const keyEvent = event.nativeEvent ?? event;
        // With a menu open, Enter picks its suggestion; it never sends then.
        if (autocompleteMenuOpen && isEnter(keyEvent)) {
          event.preventDefault();
          return;
        }
        const sendKey = enterForNewline || mobileOrTablet() ? isModEnter : isEnter;
        if (sendKey(keyEvent)) {
          event.preventDefault();
          handleSend();
        }
      },
      [autocompleteMenuOpen, enterForNewline, handleSend, isComposing]
    );

    const syncAutocompleteQuery = useCallback(() => {
      const range = getPrevWorldRange(editor);
      const query = range
        ? getMindroomRoomInputAutocompleteQuery(editor, range) ??
          getAutocompleteQuery(editor, range, AUTOCOMPLETE_PREFIXES)
        : undefined;
      setAutocompleteQuery(query);
    }, [editor]);

    const handleChange = useCallback(() => {
      saveDraft();
      attachments.onEditorChange();
      sendTypingStatus(!isEmptyEditor(editor));
    }, [attachments, editor, saveDraft, sendTypingStatus]);

    const closeAutocomplete = useCallback(() => setAutocompleteQuery(undefined), []);
    const insertEmoji = useCallback(
      (insert: () => void) => {
        insert();
        moveCursor(editor);
      },
      [editor]
    );
    const sendLabel = t('composer.sendMessage');
    const emojiLabel = t('composer.emoji');
    const attachLabel = t('composer.attach');

    const autocomplete =
      autocompleteQuery &&
      (isMindroomRoomInputAutocompleteQuery(autocompleteQuery) ? (
        <MindroomRoomInputAutocomplete
          editor={editor}
          query={autocompleteQuery}
          requestClose={closeAutocomplete}
        />
      ) : (
        autocompleteQuery.prefix === AutocompletePrefix.UserMention && (
          <UserMentionAutocomplete
            room={room}
            editor={editor}
            query={autocompleteQuery}
            requestClose={closeAutocomplete}
            onSuggestionsChange={handleMentionSuggestions}
          />
        )
      ));

    return (
      <div ref={ref} style={COMPOSER_STYLE}>
        {autocomplete}
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
              {t('composer.dropFiles', { roomName: room.name || t('composer.roomFallback') })}
            </Text>
            <Text size="T300" align="Center">
              {t('composer.dropFilesHint')}
            </Text>
          </Box>
        )}
        {attachments.board}
        {voice.renderRecorder(handleSend)}
        <CustomEditor
          editor={editor}
          editableName="RoomInput"
          placeholder={t('composer.placeholder')}
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onKeyUp={syncAutocompleteQuery}
          onPaste={attachments.onPaste}
          top={
            <>
              <ThreadModelPicker room={room} threadId={threadId} />
              {replyDraft ? (
                <RoomInputReplyPreview
                  room={room}
                  replyDraft={replyDraft}
                  submitPending={submitPending}
                  onCancel={() => clearReplyDraft({ roomId, replyDraft })}
                />
              ) : (
                threadId &&
                submitPending && (
                  <MindroomRoomInputReplyContext room={room} relation={undefined} pendingSend />
                )
              )}
            </>
          }
          before={
            <>
              <ComposerIconButton
                label={attachLabel}
                icon={Icons.PlusCircle}
                onPress={attachments.pickFiles}
              />
              {voice.microphone}
            </>
          }
          after={
            <>
              <ComposerIconButton
                label={emojiLabel}
                icon={Icons.Smile}
                pressed={emojiAnchor !== undefined}
                onPress={(event) => setEmojiAnchor(event.currentTarget.getBoundingClientRect())}
              />
              <PopOut
                anchor={emojiAnchor}
                position="Top"
                align="End"
                offset={16}
                content={
                  <EmojiBoard
                    imagePackRooms={imagePackRooms}
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
              <ComposerIconButton
                label={sendLabel}
                icon={Icons.Send}
                variant="Primary"
                onPress={handleSend}
              />
            </>
          }
        />
      </div>
    );
  }
);

RoomInput.displayName = 'RoomInput';
