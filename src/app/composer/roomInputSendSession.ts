import { IEventRelation, RelationType } from 'matrix-js-sdk';
import { IReplyDraft } from './roomInputDrafts';
import { Upload, UploadStatus } from '../matrix/state/upload';
import { TUploadContent } from '../matrix/matrix';
import { getMessageRelation } from '../matrix/send/composeMessageRelation';
import { randomUuid } from '../lib/randomUuid';

export type RoomInputSendMode = 'room' | 'existing-thread' | 'auto-thread-upload-root';

export type RoomInputSendSessionState = {
  mode: RoomInputSendMode;
  orderedFiles: TUploadContent[];
  textPending: boolean;
  rootEventId?: string;
  blockedRoot: boolean;
  sentFiles: Set<TUploadContent>;
  failedFiles: Set<TUploadContent>;
  /** Names the submission in the `io.mindroom.submission` marker of each of its events. */
  submissionId: string;
};

export type SubmissionMarker = {
  id: string;
  /** The session will send another event of this submission without the person doing anything. */
  more: boolean;
};

export type RoomInputSendStep =
  | { kind: 'send-text' }
  | { kind: 'send-upload'; file: TUploadContent; mxc: string; isRoot: boolean }
  | { kind: 'wait' }
  | { kind: 'complete' };

const hasMatchingReplyRelation = (
  expected?: IEventRelation,
  current?: IEventRelation
): boolean => {
  if (!expected && !current) return true;
  if (!expected || !current) return false;

  return (
    expected.rel_type === current.rel_type &&
    expected.event_id === current.event_id &&
    expected.is_falling_back === current.is_falling_back &&
    expected['m.in_reply_to']?.event_id === current['m.in_reply_to']?.event_id
  );
};

export const hasMatchingReplyDraft = (
  expected?: IReplyDraft,
  current?: IReplyDraft
): boolean => {
  if (!expected && !current) return true;
  if (!expected || !current) return false;

  return (
    expected.userId === current.userId &&
    expected.eventId === current.eventId &&
    hasMatchingReplyRelation(expected.relation, current.relation)
  );
};

export const hasExplicitThreadContext = (
  threadId?: string,
  replyDraft?: IReplyDraft,
  threadingEnabled = true
): boolean =>
  threadingEnabled &&
  Boolean(
    threadId ||
      (replyDraft?.relation?.rel_type === RelationType.Thread &&
        typeof replyDraft.relation.event_id === 'string' &&
        replyDraft.relation.event_id.length > 0)
  );

export const getRoomInputSendMode = ({
  attachmentCount,
  hasText,
  threadId,
  replyDraft,
  threadingEnabled = true,
}: {
  attachmentCount: number;
  hasText: boolean;
  threadId?: string;
  replyDraft?: IReplyDraft;
  threadingEnabled?: boolean;
}): RoomInputSendMode => {
  if (hasExplicitThreadContext(threadId, replyDraft, threadingEnabled)) {
    return 'existing-thread';
  }
  if (!threadingEnabled) return 'room';
  if (attachmentCount > 1 || (hasText && attachmentCount > 0)) {
    return 'auto-thread-upload-root';
  }
  return 'room';
};

export const createRoomInputSendSessionState = ({
  files,
  hasText,
  threadId,
  replyDraft,
  threadingEnabled = true,
}: {
  files: TUploadContent[];
  hasText: boolean;
  threadId?: string;
  replyDraft?: IReplyDraft;
  threadingEnabled?: boolean;
}): RoomInputSendSessionState => ({
  mode: getRoomInputSendMode({
    attachmentCount: files.length,
    hasText,
    threadId,
    replyDraft,
    threadingEnabled,
  }),
  orderedFiles: files,
  textPending: hasText,
  blockedRoot: false,
  sentFiles: new Set(),
  failedFiles: new Set(),
  submissionId: randomUuid(),
});

const getPendingFiles = (
  session: RoomInputSendSessionState,
  activeFiles: TUploadContent[]
): TUploadContent[] => {
  const activeFileSet = new Set(activeFiles);

  return session.orderedFiles.filter(
    (file) => activeFileSet.has(file) && !session.sentFiles.has(file)
  );
};

/**
 * Whether a file of the session still to go is uploading: MindRoom holds a submission for only a
 * few seconds after its last event, so a photo sent at once would be answered alone while a long
 * video uploads. An upload not started (its card is on a closed board) does not count.
 */
export const isRoomInputSendSessionUploading = (
  session: RoomInputSendSessionState,
  uploads: Upload[],
  activeFiles: TUploadContent[]
): boolean => {
  const uploadMap = new Map(uploads.map((upload) => [upload.file, upload]));
  return getPendingFiles(session, activeFiles).some(
    (file) => uploadMap.get(file)?.status === UploadStatus.Loading
  );
};

const isUploadSuccess = (
  upload: Upload | undefined
): upload is Extract<Upload, { status: UploadStatus.Success }> =>
  upload?.status === UploadStatus.Success;

export const resolveRoomInputSendStep = (
  session: RoomInputSendSessionState,
  uploads: Upload[],
  activeFiles: TUploadContent[]
): RoomInputSendStep => {
  if (session.blockedRoot) {
    // The caption does not wait with a root that has to be sent again: it goes out on its own.
    return session.textPending ? { kind: 'send-text' } : { kind: 'wait' };
  }

  const pendingFiles = getPendingFiles(session, activeFiles);
  const uploadMap = new Map(uploads.map((upload) => [upload.file, upload]));

  // No file goes out, the root included, while another one still uploads.
  if (isRoomInputSendSessionUploading(session, uploads, activeFiles)) {
    return { kind: 'wait' };
  }

  if (
    session.mode === 'auto-thread-upload-root' &&
    !session.rootEventId &&
    pendingFiles.length > 0
  ) {
    const rootFile = pendingFiles[0]!;
    const upload = uploadMap.get(rootFile);

    if (isUploadSuccess(upload)) {
      return { kind: 'send-upload', file: rootFile, mxc: upload.mxc, isRoot: true };
    }
    // Nor with a root whose upload failed and waits for its Retry; the caption then has no thread
    // to join and goes to the room.
    if (upload?.status === UploadStatus.Error && session.textPending) {
      return { kind: 'send-text' };
    }

    return { kind: 'wait' };
  }

  for (const file of pendingFiles) {
    if (session.failedFiles.has(file)) {
      continue;
    }

    const upload = uploadMap.get(file);
    if (upload?.status === UploadStatus.Error) {
      // Intentional relaxed ordering: a non-root upload retry should not block already-ready
      // later attachments forever. Retried files still reuse the same resolved thread root.
      continue;
    }
    if (!isUploadSuccess(upload)) {
      return { kind: 'wait' };
    }

    return { kind: 'send-upload', file, mxc: upload.mxc, isRoot: false };
  }

  // Attachments go out first, once none of them is still uploading, and the caption goes
  // last: each event says whether more of the submission follows (getSubmissionMarker), and
  // MindRoom holds the files for the caption that closes it. Files awaiting a manual retry do not
  // hold the caption back, and one retried after the caption closes the submission again.
  if (session.textPending) {
    return { kind: 'send-text' };
  }

  if (pendingFiles.length === 0) {
    return { kind: 'complete' };
  }

  return { kind: 'wait' };
};

/**
 * The marker for the event the session sends now: `sending` is the file going out, or undefined
 * for the text. It says `more` while the text is still to go or another file can still go without
 * a retry. The text always ends the submission, and so does a file sent again after it. A session
 * without files sends a text alone, with no marker.
 */
export const getSubmissionMarker = (
  session: RoomInputSendSessionState,
  uploads: Upload[],
  activeFiles: TUploadContent[],
  sending: TUploadContent | undefined
): SubmissionMarker | undefined => {
  if (session.orderedFiles.length === 0) return undefined;
  if (sending === undefined) return { id: session.submissionId, more: false };
  if (session.textPending) return { id: session.submissionId, more: true };

  const uploadMap = new Map(uploads.map((upload) => [upload.file, upload]));
  const more = getPendingFiles(session, activeFiles).some(
    (file) =>
      file !== sending &&
      !session.failedFiles.has(file) &&
      uploadMap.get(file)?.status !== UploadStatus.Error
  );
  return { id: session.submissionId, more };
};

export const hasRoomInputSendFailures = (session: RoomInputSendSessionState): boolean =>
  session.blockedRoot || session.failedFiles.size > 0;

/**
 * True when the session can only go on once the person retries or removes an attachment: it
 * waits, and every file it waits for has a failed upload or a failed send. Texts sent meanwhile
 * do not wait for it.
 */
export const isRoomInputSendSessionStalled = (
  session: RoomInputSendSessionState,
  uploads: Upload[],
  activeFiles: TUploadContent[]
): boolean => {
  if (resolveRoomInputSendStep(session, uploads, activeFiles).kind !== 'wait') return false;
  if (session.blockedRoot) return true;
  const uploadMap = new Map(uploads.map((upload) => [upload.file, upload]));
  return getPendingFiles(session, activeFiles).every(
    (file) =>
      session.failedFiles.has(file) || uploadMap.get(file)?.status === UploadStatus.Error
  );
};

type RelationSession = Pick<RoomInputSendSessionState, 'mode' | 'rootEventId'> & {
  replyDraft?: IReplyDraft;
  threadId?: string;
  threadingEnabled?: boolean;
};

const allowThreadRelation = (session: RelationSession): boolean =>
  session.threadingEnabled ?? true;

export const getTextRelationForSendSession = (session: RelationSession) => {
  if (session.mode === 'existing-thread') {
    return getMessageRelation(
      session.replyDraft?.eventId,
      session.replyDraft?.relation,
      session.threadId,
      { allowThreadRelation: allowThreadRelation(session) }
    );
  }
  if (session.mode === 'auto-thread-upload-root' && session.rootEventId) {
    // The root upload already carried the reply metadata; the trailing caption just joins the
    // thread it opened.
    return getMessageRelation(undefined, undefined, session.rootEventId);
  }

  return getMessageRelation(session.replyDraft?.eventId, session.replyDraft?.relation, undefined, {
    allowThreadRelation: allowThreadRelation(session),
  });
};

export const getUploadRelationForSendSession = (
  session: RelationSession,
  isRoot: boolean
) => {
  if (session.mode === 'existing-thread') {
    return getMessageRelation(
      session.replyDraft?.eventId,
      session.replyDraft?.relation,
      session.threadId,
      { allowThreadRelation: allowThreadRelation(session) }
    );
  }
  if (session.mode === 'room') {
    return getMessageRelation(
      session.replyDraft?.eventId,
      session.replyDraft?.relation,
      undefined,
      { allowThreadRelation: allowThreadRelation(session) }
    );
  }
  if (session.mode === 'auto-thread-upload-root' && isRoot && !session.rootEventId) {
    return getMessageRelation(
      session.replyDraft?.eventId,
      session.replyDraft?.relation,
      undefined,
      { allowThreadRelation: allowThreadRelation(session) }
    );
  }
  if (!session.rootEventId) {
    return undefined;
  }

  return getMessageRelation(undefined, undefined, session.rootEventId);
};
