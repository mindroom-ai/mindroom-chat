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
import { Box, Icon, IconButton, Icons, PopOut, RectCords, Text, color, config } from 'folds';
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
const isModEnter = isKeyHotkey('mod+enter');

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
    const [hasText, setHasText] = useState(() => !isEmptyEditor(editor));
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

    const buildTextContent = useCallback((): IContent | undefined => {










      if (command === 'me' || command === 'notice') {
        plainText = trimCommand(command, plainText);
        customHtml = trimCommand(command, customHtml);
        msgtype = command === 'me' ? MsgType.Emote : MsgType.Notice;
      }
      if (plainText === '') return undefined;
      const content: IContent = { msgtype, body: plainText };
      if (!customHtmlEqualsPlainText(customHtml, plainText)) {
        content.format = 'org.matrix.custom.html';
        content.formatted_body = customHtml;
      }
      const mentions = getMentions(editor, mx.getUserId() ?? undefined);
      content['m.mentions'] = {
        ...(mentions.users.size > 0 ? { user_ids: Array.from(mentions.users) } : {}),
        ...(mentions.room ? { room: true } : {}),
      };
      return content;
    }, [editor, isMarkdown, mx]);

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

    const handleKeyUp = useCallback(() => {
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
      const typed = !isEmptyEditor(editor);
      setHasText(typed);
      sendTypingStatus(typed);
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



            requestClose={closeAutocomplete}
            onSuggestionsChange={handleMentionSuggestions}
          />
        )
      ));

    return (
      <div ref={ref}>
        {autocomplete}
        {attachments.dropZoneVisible && (
          <Box
            direction="Column"
            alignItems="Center"
            gap="100"
            role="status"
            style={{
              margin: `0 ${config.space.S200} ${config.space.S200}`,
              padding: config.space.S400,
              borderRadius: config.radii.R400,
              border: `${config.borderWidth.B400} dashed ${color.Primary.Main}`,
              backgroundColor: color.Primary.Container,
              color: color.Primary.OnContainer,
              pointerEvents: 'none',
            }}
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
            <IconTooltip label={attachLabel} position="Top">
              {(triggerRef) => (
                <IconButton
                  ref={triggerRef}
                  variant="SurfaceVariant"
                  size="300"
                  radii="300"
                  aria-label={attachLabel}
                  onClick={attachments.pickFiles}
                >
                  <Icon src={Icons.PlusCircle} />
                </IconButton>
              )}
            </IconTooltip>
          }
          after={
            <Box alignItems="Center" gap="100" style={{ paddingInlineEnd: config.space.S100 }}>
              <IconTooltip label={emojiLabel} position="Top">
                {(triggerRef) => (
                  <IconButton
                    ref={triggerRef}
                    variant="SurfaceVariant"
                    size="300"
                    radii="300"
                    aria-label={emojiLabel}
                    aria-pressed={!!emojiAnchor}
                    onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
                      setEmojiAnchor(event.currentTarget.getBoundingClientRect())
                    }
                  >
                    <Icon src={Icons.Smile} filled={!!emojiAnchor} />
                  </IconButton>
                )}
              </IconTooltip>
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
              {voice.microphone}
              <IconTooltip label={sendLabel} position="Top">
                {(triggerRef) => (
                  <IconButton
                    ref={triggerRef}
                    variant={hasText || attachments.board ? 'Primary' : 'SurfaceVariant'}
                    size="300"
                    radii="300"
                    aria-label={sendLabel}
                    onClick={handleSend}
                  >
                    <Icon src={Icons.Send} />
                  </IconButton>
                )}
              </IconTooltip>
            </Box>
          }
        />
      </div>
    );
  }
);

RoomInput.displayName = 'RoomInput';
