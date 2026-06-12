import { MutableRefObject, useCallback, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { IContent, MatrixClient, Room } from 'matrix-js-sdk';
import { Editor } from 'slate';
import { resetEditor, resetEditorHistory } from '../../components/editor/utils';
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

type SendSession = RoomInputSendSessionState & {
  roomId: string;
  threadId: string | undefined;
  replyDraft: IReplyDraft | undefined;
  threadingEnabled: boolean;
  textContent?: IContent;
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

  const sendSessionText = useCallback(
    async (session: SendSession) => {
      if (!session.textContent) return;

      const relation = getTextRelationForSendSession(session);
      const content: IContent = relation
        ? {
            ...session.textContent,
            'm.relates_to': relation,
          }
        : session.textContent;
      await mx.sendMessage(session.roomId, content as any);

      session.textPending = false;
      clearReplyDraftForSession(session);
    },
    [mx, clearReplyDraftForSession]
  );

  const sendSessionUpload = useCallback(
    async (session: SendSession, file: TUploadContent, mxc: string, isRoot: boolean) => {
      const fileItem =
        selectedFilesRef.current.find((item) => item.file === file) ??
        sendSessionUploadItemsRef?.current.find((item) => item.file === file);
      if (!fileItem) {
        throw new Error('Missing upload item for send session.');
      }

      const content = await buildUploadMessageContent(fileItem, mxc, session.signalBridgedRoom);
      const relation = getUploadRelationForSendSession(session, isRoot);
      const contentWithRelation: IContent = relation
        ? {
            ...content,
            'm.relates_to': relation,
          }
        : content;
      const response = await mx.sendMessage(session.roomId, contentWithRelation as any);

      session.sentFiles.add(file);
      session.failedFiles.delete(file);
      if (session.mode === 'auto-thread-upload-root' && isRoot) {
        session.rootEventId = response.event_id;
      }
      clearReplyDraftForSession(session);
      removeUploadsFromBoard(file);
    },
    [
      mx,
      selectedFilesRef,
      sendSessionUploadItemsRef,
      buildUploadMessageContent,
      clearReplyDraftForSession,
      removeUploadsFromBoard,
    ]
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
            session.blockedRoot = true;
            return;
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

      const sessionRoomId = context ? context.roomId : roomId;
      const sessionThreadId = context ? context.threadId : threadId;
      const sessionReplyDraft = context ? context.replyDraft : replyDraft;
      const sessionThreadingEnabled = context ? context.threadingEnabled : threadingEnabled;
      const signalBridgedRoom = context ? context.signalBridgedRoom : isSignalBridgeRoom(room);

      sendSessionRef.current = {
        roomId: sessionRoomId,
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
        // session has snapshotted the text instead of when the text event goes out.
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
