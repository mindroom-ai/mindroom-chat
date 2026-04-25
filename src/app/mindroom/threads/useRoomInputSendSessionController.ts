import { MutableRefObject, useCallback, useRef } from 'react';
import { IContent, MatrixClient, Room } from 'matrix-js-sdk';
import { Editor } from 'slate';
import { resetEditor, resetEditorHistory } from '../../components/editor/utils';
import { IReplyDraft, TUploadItem } from '../../state/room/roomInputDrafts';
import { Upload } from '../../state/upload';
import { TUploadContent } from '../../utils/matrix';
import { isSignalBridgeRoom } from '../bridges/bridgeDetection';
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
  textContent?: IContent;
  replyCleared: boolean;
  signalBridgedRoom: boolean;
};

export type StartRoomInputSendSessionOptions = {
  textContent?: IContent;
  files?: TUploadContent[];
};

type UseRoomInputSendSessionControllerOptions = {
  mx: MatrixClient;
  room: Room;
  roomId: string;
  threadId?: string;
  replyDraft?: IReplyDraft;
  setReplyDraft: (replyDraft: IReplyDraft | undefined) => void;
  editor: Editor;
  sendTypingStatus: (typing: boolean) => void;
  selectedFilesRef: MutableRefObject<TUploadItem[]>;
  uploadsRef: MutableRefObject<Upload[]>;
  buildUploadMessageContent: (
    fileItem: TUploadItem,
    mxc: string,
    signalBridgedRoom: boolean
  ) => Promise<IContent>;
  removeUploadsFromBoard: (upload: TUploadContent | TUploadContent[]) => void;
};

export const useRoomInputSendSessionController = ({
  mx,
  room,
  roomId,
  threadId,
  replyDraft,
  setReplyDraft,
  editor,
  sendTypingStatus,
  selectedFilesRef,
  uploadsRef,
  buildUploadMessageContent,
  removeUploadsFromBoard,
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
      const response = await mx.sendMessage(session.roomId, content as any);

      session.textPending = false;
      if (session.mode === 'auto-thread-text-root') {
        session.rootEventId = response.event_id;
      }
      clearReplyDraftForSession(session);
      resetEditor(editor);
      resetEditorHistory(editor);
      sendTypingStatus(false);
    },
    [mx, clearReplyDraftForSession, editor, sendTypingStatus]
  );

  const sendSessionUpload = useCallback(
    async (session: SendSession, file: TUploadContent, mxc: string, isRoot: boolean) => {
      const fileItem = selectedFilesRef.current.find((item) => item.file === file);
      if (!fileItem) return;

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
          selectedFilesRef.current.map((fileItem) => fileItem.file)
        );

        if (step.kind === 'wait') {
          return;
        }
        if (step.kind === 'complete') {
          sendSessionRef.current = undefined;
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
  }, [uploadsRef, selectedFilesRef, sendSessionText, sendSessionUpload]);

  const startSendSession = useCallback(
    async ({ textContent, files }: StartRoomInputSendSessionOptions = {}) => {
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

      const sendFiles = files ?? selectedFilesRef.current.map((fileItem) => fileItem.file);
      if (sendFiles.length === 0) return;

      sendSessionRef.current = {
        roomId,
        threadId,
        replyDraft,
        textContent,
        replyCleared: false,
        signalBridgedRoom: isSignalBridgeRoom(room),
        ...createRoomInputSendSessionState({
          files: sendFiles,
          hasText: Boolean(textContent),
          threadId,
          replyDraft,
        }),
      };
      await processSendSession();
    },
    [roomId, threadId, replyDraft, room, selectedFilesRef, processSendSession]
  );

  return {
    processSendSession,
    startSendSession,
  };
};
