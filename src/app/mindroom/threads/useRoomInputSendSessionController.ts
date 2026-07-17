import { MutableRefObject, useCallback, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { IContent, MatrixClient, Room } from 'matrix-js-sdk';
import { Descendant, Editor } from 'slate';
import {
  resetEditor,
  resetEditorHistory,
  restoreEditorContent,
} from '../../components/editor/utils';
import { IReplyDraft, TUploadItem } from '../../state/room/roomInputDrafts';
import { Upload } from '../../state/upload';
import { TUploadContent } from '../../utils/matrix';
import { isSignalBridgeRoom } from '../bridges/bridgeDetection';
import { createMindroomPasteMarker } from '../messages/pasteAttachmentMarker';
import {
  createRoomInputSendSessionState,
  getTextRelationForSendSession,
  getUploadRelationForSendSession,
  hasMatchingReplyDraftContext,
  hasRoomInputSendFailures,
  resolveRoomInputSendStep,
  RoomInputSendSessionState,
} from './roomInputSendSession';
import { getRoomMessageSentNotificationEventId } from './roomMessageSent';
import { getMessageRelation, hasLocalEchoMessageRelationTarget } from './composeMessageRelation';
import { resolveCanonicalMatrixEventId } from './threadRouteUtils';
import { resolveMindroomReplyDraftEventIds } from './roomTimelineReplyDraft';

type SendSession = RoomInputSendSessionState & {
  roomId: string;
  room: Room;
  threadId: string | undefined;
  replyDraft: IReplyDraft | undefined;
  threadingEnabled: boolean;
  textContent?: IContent;
  composerFallback?: Descendant[];
  replyCleared: boolean;
  signalBridgedRoom: boolean;
};

export type RoomInputSendContext = {
  roomId: string;
  room: Room;
  threadId: string | undefined;
  replyDraft: IReplyDraft | undefined;
  threadingEnabled: boolean;
  signalBridgedRoom: boolean;
};

export type StartRoomInputSendSessionOptions = {
  textContent?: IContent;
  files?: TUploadContent[];
  context?: RoomInputSendContext;
};

type UseRoomInputSendSessionControllerOptions = {
  mx: MatrixClient;
  room: Room;
  roomId: string;
  threadId?: string;
  replyDraft?: IReplyDraft;
  threadingEnabled?: boolean;
  setReplyDraft: (replyDraft: IReplyDraft | undefined) => void;
  editor: Editor;
  sendTypingStatus: (typing: boolean) => void;
  selectedFilesRef: MutableRefObject<TUploadItem[]>;
  sendSessionFilesRef?: MutableRefObject<TUploadContent[]>;
  sendSessionUploadItemsRef?: MutableRefObject<TUploadItem[]>;
  setSendSessionFiles?: Dispatch<SetStateAction<TUploadContent[]>>;
  mountedRef?: MutableRefObject<boolean>;
  uploadsRef: MutableRefObject<Upload[]>;
  buildUploadMessageContent: (
    fileItem: TUploadItem,
    mxc: string,
    signalBridgedRoom: boolean
  ) => Promise<IContent>;
  removeUploadsFromBoard: (upload: TUploadContent | TUploadContent[]) => void;
  onRoomMessageSent?: (eventId: string) => boolean;
  shouldBlockStartSendSession?: () => boolean;
};

const getTextContentStrings = (content: IContent | undefined): string[] => {
  if (!content) return [];

  return [content.body, content.formatted_body].filter(
    (value): value is string => typeof value === 'string'
  );
};

const hasFailedPasteMarkerInText = (
  textContent: IContent | undefined,
  fileItems: TUploadItem[]
): boolean => {
  const textValues = getTextContentStrings(textContent);
  if (textValues.length === 0) return false;

  return fileItems.some((fileItem) => {
    const pasteMetadata = fileItem.prepError
      ? fileItem.metadata.mindroomPasteAttachment
      : undefined;
    if (!pasteMetadata) return false;

    let marker: string;
    try {
      marker = createMindroomPasteMarker({
        id: pasteMetadata.id,
        chars: pasteMetadata.chars,
        fileName: pasteMetadata.fileName,
      });
    } catch {
      return false;
    }
    return textValues.some((text) => text.includes(marker));
  });
};

export const useRoomInputSendSessionController = ({
  mx,
  room,
  roomId,
  threadId,
  replyDraft,
  threadingEnabled = true,
  setReplyDraft,
  editor,
  sendTypingStatus,
  selectedFilesRef,
  sendSessionFilesRef,
  sendSessionUploadItemsRef,
  setSendSessionFiles,
  mountedRef,
  uploadsRef,
  buildUploadMessageContent,
  removeUploadsFromBoard,
  onRoomMessageSent,
  shouldBlockStartSendSession,
}: UseRoomInputSendSessionControllerOptions): {
  processSendSession: () => Promise<void>;
  startSendSession: (options?: StartRoomInputSendSessionOptions) => Promise<void>;
} => {
  const sendSessionRef = useRef<SendSession | undefined>();
  const processingSendSessionRef = useRef(false);
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;
  const replyDraftRef = useRef(replyDraft);
  replyDraftRef.current = replyDraft;

  const clearReplyDraftForSession = useCallback(
    (session: SendSession) => {
      if (session.replyCleared) return;

      session.replyCleared = true;
      if (
        !hasMatchingReplyDraftContext(
          {
            roomId: session.roomId,
            threadId: session.threadId,
            replyDraft: session.replyDraft,
          },
          {
            roomId: roomIdRef.current,
            threadId: threadIdRef.current,
            replyDraft: replyDraftRef.current,
          }
        )
      ) {
        return;
      }
      setReplyDraft(undefined);
    },
    [setReplyDraft]
  );

  const refreshSessionContext = useCallback(
    (session: SendSession): Room => {
      const liveRoom = mx.getRoom(session.roomId) ?? session.room;
      session.room = liveRoom;
      session.signalBridgedRoom = isSignalBridgeRoom(liveRoom);
      session.threadId = resolveCanonicalMatrixEventId(liveRoom, session.threadId);
      if (session.replyDraft) {
        session.replyDraft = resolveMindroomReplyDraftEventIds(liveRoom, session.replyDraft);
      }
      return liveRoom;
    },
    [mx]
  );

  const sendSessionText = useCallback(
    async (session: SendSession) => {
      if (!session.textContent) return;

      const liveRoom = refreshSessionContext(session);
      const relation = getTextRelationForSendSession(session);
      if (liveRoom.hasEncryptionStateEvent() && hasLocalEchoMessageRelationTarget(relation)) {
        throw new Error('Encrypted send target is still pending.');
      }
      const content: IContent = relation
        ? {
            ...session.textContent,
            'm.relates_to': relation,
          }
        : session.textContent;
      const response = await mx.sendMessage(session.roomId, content as any);
      const sentEventIdToNotify = getRoomMessageSentNotificationEventId({
        eventId: response.event_id,
        relation,
        replyDraft: session.replyDraft,
        threadId: session.threadId,
      });

      session.textPending = false;
      clearReplyDraftForSession(session);
      if (sentEventIdToNotify) {
        onRoomMessageSent?.(sentEventIdToNotify);
      }
    },
    [mx, clearReplyDraftForSession, onRoomMessageSent, refreshSessionContext]
  );

  const sendSessionUpload = useCallback(
    async (session: SendSession, file: TUploadContent, mxc: string, isRoot: boolean) => {
      const fileItem =
        selectedFilesRef.current.find((item) => item.file === file) ??
        sendSessionUploadItemsRef?.current.find((item) => item.file === file);
      if (!fileItem) {
        throw new Error('Missing upload item for send session.');
      }

      refreshSessionContext(session);
      const content = await buildUploadMessageContent(fileItem, mxc, session.signalBridgedRoom);
      const liveRoom = refreshSessionContext(session);
      const relation = getUploadRelationForSendSession(session, isRoot);
      if (liveRoom.hasEncryptionStateEvent() && hasLocalEchoMessageRelationTarget(relation)) {
        throw new Error('Encrypted send target is still pending.');
      }
      const contentWithRelation: IContent = relation
        ? {
            ...content,
            'm.relates_to': relation,
          }
        : content;
      const response = await mx.sendMessage(session.roomId, contentWithRelation as any);
      const sentEventIdToNotify = getRoomMessageSentNotificationEventId({
        eventId: response.event_id,
        relation,
        replyDraft: session.replyDraft,
        threadId: session.threadId,
      });

      session.sentFiles.add(file);
      session.failedFiles.delete(file);
      if (session.mode === 'auto-thread-upload-root' && isRoot) {
        session.rootEventId = response.event_id;
      }
      clearReplyDraftForSession(session);
      removeUploadsFromBoard(file);
      if (sentEventIdToNotify) {
        onRoomMessageSent?.(sentEventIdToNotify);
      }
    },
    [
      mx,
      selectedFilesRef,
      sendSessionUploadItemsRef,
      buildUploadMessageContent,
      clearReplyDraftForSession,
      onRoomMessageSent,
      removeUploadsFromBoard,
      refreshSessionContext,
    ]
  );

  const restoreComposerFallback = useCallback(
    (session: SendSession) => {
      // A failed caption goes back into the composer instead of parking in the session: by the
      // time the caption sends, the uploads have left the board, so the board's Send-again
      // affordance that resumes a blocked session no longer exists.
      session.textPending = false;
      const fragment = session.composerFallback;
      session.composerFallback = undefined;
      if (fragment && (mountedRef?.current ?? true)) {
        restoreEditorContent(editor, fragment);
      }
    },
    [editor, mountedRef]
  );

  const processSendSession = useCallback(async () => {
    if (processingSendSessionRef.current) return;

    processingSendSessionRef.current = true;
    try {
      while (sendSessionRef.current) {
        const session = sendSessionRef.current;

        const step = resolveRoomInputSendStep(
          session,
          uploadsRef.current,
          Array.from(
            new Set([
              ...selectedFilesRef.current.map((fileItem) => fileItem.file),
              ...(sendSessionFilesRef?.current ?? []),
            ])
          )
        );

        if (step.kind === 'wait') {
          return;
        }
        if (step.kind === 'complete') {
          sendSessionRef.current = undefined;
          if (sendSessionFilesRef) {
            sendSessionFilesRef.current = [];
          }
          if (sendSessionUploadItemsRef) {
            sendSessionUploadItemsRef.current = [];
          }
          if (mountedRef?.current ?? true) {
            setSendSessionFiles?.([]);
          }
          return;
        }

        if (step.kind === 'send-text') {
          try {
            await sendSessionText(session);
          } catch (error) {
            restoreComposerFallback(session);
          }
          continue;
        }

        try {
          await sendSessionUpload(session, step.file, step.mxc, step.isRoot);
        } catch (error) {
          if (step.isRoot) {
            session.blockedRoot = true;
            return;
          }

          session.failedFiles.add(step.file);
        }
      }
    } finally {
      processingSendSessionRef.current = false;
    }
  }, [
    uploadsRef,
    selectedFilesRef,
    sendSessionFilesRef,
    sendSessionUploadItemsRef,
    setSendSessionFiles,
    mountedRef,
    sendSessionText,
    sendSessionUpload,
    restoreComposerFallback,
  ]);

  const startSendSession = useCallback(
    async ({ textContent, files, context }: StartRoomInputSendSessionOptions = {}) => {
      if (shouldBlockStartSendSession?.()) return;

      const existingSession = sendSessionRef.current;
      if (existingSession) {
        if (!hasRoomInputSendFailures(existingSession)) {
          // Repeated sends while uploads are still resolving should not create duplicate events.
          return;
        }

        existingSession.blockedRoot = false;
        existingSession.failedFiles.clear();
        await processSendSession();
        return;
      }

      const selectedSendItems = selectedFilesRef.current.filter((fileItem) => !fileItem.prepError);
      const prepErrorFiles = new Set(
        selectedFilesRef.current
          .filter((fileItem) => fileItem.prepError)
          .map((fileItem) => fileItem.file)
      );
      const sendFiles = files
        ? files.filter((file) => !prepErrorFiles.has(file))
        : selectedSendItems.map((fileItem) => fileItem.file);
      if (sendFiles.length === 0 && !textContent) return;
      if (hasFailedPasteMarkerInText(textContent, selectedFilesRef.current)) return;
      const sessionRoomId = context ? context.roomId : roomId;
      const contextRoom = context ? context.room : room;
      const sessionRoom = mx.getRoom(sessionRoomId) ?? contextRoom;
      const sessionThreadId = resolveCanonicalMatrixEventId(
        sessionRoom,
        context ? context.threadId : threadId
      );
      const contextReplyDraft = context ? context.replyDraft : replyDraft;
      const sessionReplyDraft = contextReplyDraft
        ? resolveMindroomReplyDraftEventIds(sessionRoom, contextReplyDraft)
        : undefined;
      const sessionThreadingEnabled = context ? context.threadingEnabled : threadingEnabled;
      const signalBridgedRoom = isSignalBridgeRoom(sessionRoom);
      const contextRelation = getMessageRelation(
        sessionReplyDraft?.eventId,
        sessionReplyDraft?.relation,
        sessionThreadId,
        { allowThreadRelation: sessionThreadingEnabled }
      );
      if (
        sessionRoom.hasEncryptionStateEvent() &&
        hasLocalEchoMessageRelationTarget(contextRelation)
      ) {
        return;
      }

      if (sendSessionUploadItemsRef) {
        sendSessionUploadItemsRef.current = selectedSendItems.filter((item) =>
          sendFiles.includes(item.file)
        );
      }
      if (sendSessionFilesRef) {
        sendSessionFilesRef.current = sendFiles;
      }
      if (mountedRef?.current ?? true) {
        setSendSessionFiles?.(sendFiles);
      }

      sendSessionRef.current = {
        roomId: sessionRoomId,
        room: sessionRoom,
        threadId: sessionThreadId,
        replyDraft: sessionReplyDraft,
        threadingEnabled: sessionThreadingEnabled,
        textContent,
        replyCleared: false,
        signalBridgedRoom,
        ...createRoomInputSendSessionState({
          files: sendFiles,
          hasText: Boolean(textContent),
          threadId: sessionThreadId,
          replyDraft: sessionReplyDraft,
          threadingEnabled: sessionThreadingEnabled,
        }),
      };
      if (textContent) {
        // The caption sends last (after the uploads), so free the composer as soon as the
        // session has snapshotted the text instead of when the text event goes out. Keep a
        // clone of the composer content so a failed caption can be restored (slate mutates
        // editor.children in place).
        sendSessionRef.current.composerFallback = structuredClone(editor.children);
        resetEditor(editor);
        resetEditorHistory(editor);
        sendTypingStatus(false);
      }
      await processSendSession();
    },
    [
      roomId,
      threadId,
      replyDraft,
      threadingEnabled,
      room,
      mx,
      editor,
      sendTypingStatus,
      selectedFilesRef,
      sendSessionFilesRef,
      sendSessionUploadItemsRef,
      setSendSessionFiles,
      mountedRef,
      processSendSession,
      shouldBlockStartSendSession,
    ]
  );

  return {
    processSendSession,
    startSendSession,
  };
};
