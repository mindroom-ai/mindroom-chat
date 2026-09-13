import React, {
  RefObject,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAtom, useStore } from 'jotai';
import { IContent, MsgType, Room } from 'matrix-js-sdk';
import { Descendant, Editor, Transforms } from 'slate';

import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  toMatrixCustomHTML,
  toPlainText,
  resetEditor,
  resetEditorHistory,
  customHtmlEqualsPlainText,
  trimCustomHtml,
  isEmptyEditor,
  getBeginCommand,
  trimCommand,
  getMentions,
} from '../../components/editor';
import { useTypingStatusUpdater } from '../../hooks/useTypingStatusUpdater';
import {
  roomIdToMsgDraftAtomFamily,
  roomIdToReplyDraftAtomFamily,
} from '../../state/room/roomInputDrafts';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { getMentionContent } from '../../utils/room';
import { Command, SHRUG, TABLEFLIP, UNFLIP, useCommands } from '../../hooks/useCommands';
import { useRoomInputSendSessionController } from './RoomInputMindroomExtensions';
import type { RoomInputReplyDraftContext } from '../threads/useRoomInputSendSessionController';
import { restoreEditorContent } from '../../components/editor/utils';
import { hasMatchingReplyDraft } from '../threads/roomInputSendSession';
import { useRoomInputAttachments } from './useRoomInputAttachments';
import { useRoomInputUploadTransport } from './useRoomInputUploadTransport';
import { useRoomInputVoice } from './useRoomInputVoice';
import { RoomInputEditor } from './RoomInputEditor';
import { RoomInputReplyPreview } from './RoomInputReplyPreview';

export { createMindroomRoomUploadItems } from './roomInputUploadPreparation';

export interface RoomInputProps {
  editor: Editor;
  fileDropContainerRef: RefObject<HTMLElement>;
  roomId: string;
  room: Room;
  threadId?: string;
  threadingEnabled?: boolean;
  onRoomMessageSent?: (eventId: string) => boolean | void;
}

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
    const mx = useMatrixClient();
    const store = useStore();
    const [isMarkdown] = useSetting(settingsAtom, 'isMarkdown');
    const commands = useCommands(mx, room);

    const [msgDraft, setMsgDraft] = useAtom(roomIdToMsgDraftAtomFamily(roomId));
    const [replyDraft, setReplyDraft] = useAtom(roomIdToReplyDraftAtomFamily(roomId));
    const mountedRef = useRef(true);
    const roomRef = useRef(room);
    roomRef.current = room;
    const roomIdRef = useRef(roomId);
    roomIdRef.current = roomId;
    const threadIdRef = useRef(threadId);
    threadIdRef.current = threadId;
    const replyDraftRef = useRef(replyDraft);
    replyDraftRef.current = replyDraft;

    const [submitPending, setSubmitPending] = useState(false);
    const submitInFlightRef = useRef(false);

    const sendTypingStatus = useTypingStatusUpdater(mx, roomId);

    useEffect(
      () => () => {
        mountedRef.current = false;
      },
      []
    );

    const transport = useRoomInputUploadTransport(mx, store, room);
    const { createUploadItems, buildUploadMessageContent } = transport;

    const attachments = useRoomInputAttachments({
      mx,
      room,
      roomId,
      editor,
      fileDropContainerRef,
      isMarkdown,
      createUploadItems,
    });
    const attachmentAccess = attachments.access;

    useEffect(() => {
      Transforms.insertFragment(editor, msgDraft);
    }, [editor, msgDraft]);

    useEffect(
      () => () => {
        if (!isEmptyEditor(editor)) {
          const parsedDraft = JSON.parse(JSON.stringify(editor.children));
          setMsgDraft(parsedDraft);
        } else {
          setMsgDraft([]);
        }
        resetEditor(editor);
        resetEditorHistory(editor);
      },
      [roomId, editor, setMsgDraft]
    );

    const clearReplyDraftForSendContext = useCallback(
      (context: RoomInputReplyDraftContext) => {
        const replyDraftAtom = roomIdToReplyDraftAtomFamily(context.roomId);
        const currentReplyDraft = store.get(replyDraftAtom);
        if (hasMatchingReplyDraft(context.replyDraft, currentReplyDraft)) {
          store.set(replyDraftAtom, undefined);
        }
      },
      [store]
    );

    const restoreComposerFallbackForRoom = useCallback(
      (ownerRoomId: string, fragment: Descendant[]) => {
        const msgDraftAtom = roomIdToMsgDraftAtomFamily(ownerRoomId);
        store.set(msgDraftAtom, [...fragment, ...store.get(msgDraftAtom)]);
      },
      [store]
    );

    const sessions = useRoomInputSendSessionController({
      mx,
      room,
      roomId,
      threadId,
      replyDraft,
      threadingEnabled,
      clearReplyDraft: clearReplyDraftForSendContext,
      editor,
      sendTypingStatus,
      attachments: attachmentAccess,
      mountedRef,
      buildUploadMessageContent,
      restoreComposerFallbackForRoom,
      onRoomMessageSent,
    });

    const { startSendSession } = sessions;
    const composer = useMemo(
      () => ({
        getContext: () => ({
          roomId: roomIdRef.current,
          room: roomRef.current,
          threadId: threadIdRef.current,
          replyDraft: replyDraftRef.current,
          threadingEnabled,
        }),
        snapshotText: () => structuredClone(editor.children),
        resetText: () => {
          resetEditor(editor);
          resetEditorHistory(editor);
          sendTypingStatus(false);
        },
        restoreText: (ownerRoomId: string, fragment: Descendant[]) => {
          if (mountedRef.current && ownerRoomId === roomIdRef.current) {
            restoreEditorContent(editor, fragment);
          } else {
            restoreComposerFallbackForRoom(ownerRoomId, fragment);
          }
        },
        clearConsumedReply: clearReplyDraftForSendContext,
      }),
      [
        editor,
        threadingEnabled,
        sendTypingStatus,
        restoreComposerFallbackForRoom,
        clearReplyDraftForSendContext,
      ]
    );
    const voice = useRoomInputVoice({
      mx,
      roomId,
      composer,
      attachments: attachmentAccess,
      transport,
      sessions,
      onRoomMessageSent,
    });
    const { blocksSubmit, submitIfActive } = voice;

    const submit = useCallback(async () => {
      if (submitInFlightRef.current) return;
      submitInFlightRef.current = true;
      let submitPendingStarted = false;

      try {
        if (blocksSubmit()) return;

        const commandName = getBeginCommand(editor);
        let plainText = toPlainText(editor.children, isMarkdown).trim();
        let customHtml = trimCustomHtml(
          toMatrixCustomHTML(editor.children, {
            allowTextFormatting: true,
            allowBlockMarkdown: isMarkdown,
            allowInlineMarkdown: isMarkdown,
          })
        );
        let msgType = MsgType.Text;

        if (commandName) {
          plainText = trimCommand(commandName, plainText);
          customHtml = trimCommand(commandName, customHtml);
        }
        if (commandName === Command.Me) {
          msgType = MsgType.Emote;
        } else if (commandName === Command.Notice) {
          msgType = MsgType.Notice;
        } else if (commandName === Command.Shrug) {
          plainText = `${SHRUG} ${plainText}`;
          customHtml = `${SHRUG} ${customHtml}`;
        } else if (commandName === Command.TableFlip) {
          plainText = `${TABLEFLIP} ${plainText}`;
          customHtml = `${TABLEFLIP} ${customHtml}`;
        } else if (commandName === Command.UnFlip) {
          plainText = `${UNFLIP} ${plainText}`;
          customHtml = `${UNFLIP} ${customHtml}`;
        } else if (commandName) {
          const commandContent = commands[commandName as Command];
          if (commandContent) {
            commandContent.exe(plainText);
          }
          resetEditor(editor);
          resetEditorHistory(editor);
          sendTypingStatus(false);
          if (attachmentAccess.snapshot().staged.length > 0) {
            await startSendSession();
          }
          return;
        }

        const hasText = plainText !== '';
        const hasUploads = attachmentAccess.snapshot().staged.length > 0;

        let content: IContent | undefined;
        if (hasText) {
          const body = plainText;
          const formattedBody = customHtml;
          const mentionData = getMentions(mx, roomId, editor);

          content = {
            msgtype: msgType,
            body,
          };

          if (replyDraft && replyDraft.userId !== mx.getUserId()) {
            mentionData.users.add(replyDraft.userId);
          }

          const mMentions = getMentionContent(Array.from(mentionData.users), mentionData.room);
          content['m.mentions'] = mMentions;

          if (replyDraft || !customHtmlEqualsPlainText(formattedBody, body)) {
            content.format = 'org.matrix.custom.html';
            content.formatted_body = formattedBody;
          }
        }

        if (await submitIfActive(content)) return;

        if (!hasText && !hasUploads) return;

        if (hasUploads) {
          await startSendSession({ textContent: content });
          return;
        }

        if (!content) return;

        submitPendingStarted = true;
        setSubmitPending(true);
        await startSendSession({ textContent: content });
        setSubmitPending(false);
        submitPendingStarted = false;
      } finally {
        if (submitPendingStarted) {
          setSubmitPending(false);
        }
        submitInFlightRef.current = false;
      }
    }, [
      mx,
      roomId,
      editor,
      replyDraft,
      sendTypingStatus,
      isMarkdown,
      commands,
      attachmentAccess,
      startSendSession,
      blocksSubmit,
      submitIfActive,
    ]);

    const recorder = voice.renderRecorder(submit);
    const composerContext = (replyDraft || (!!threadId && submitPending) || recorder) && (
      <div>
        <RoomInputReplyPreview
          room={room}
          replyDraft={replyDraft}
          threadId={threadId}
          submitPending={submitPending}
          onCancel={() => setReplyDraft(undefined)}
        />
        {recorder}
      </div>
    );

    const composerFeatureButtons = (
      <>
        {attachments.attachButton}
        {voice.microphone}
      </>
    );

    return (
      <div ref={ref}>
        {attachments.board}
        {attachments.dropOverlay}
        <RoomInputEditor
          editor={editor}
          room={room}
          fileDropContainerRef={fileDropContainerRef}
          onSubmit={submit}
          onCancelReply={() => setReplyDraft(undefined)}
          onPaste={attachments.onPaste}
          onChange={attachments.onEditorChange}
          sendTypingStatus={sendTypingStatus}
          top={composerContext}
          before={composerFeatureButtons}
        />
      </div>
    );
  }
);
