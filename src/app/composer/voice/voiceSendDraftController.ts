import { MatrixError, RelationType } from 'matrix-js-sdk';
import { getMatrixUploadErrorMessage, getMatrixUploadErrorStage } from '../../matrix/matrix';
import { randomUuid } from '../../lib/randomUuid';
import {
  hasVoiceDestination,
  type PendingVoiceSendContext,
  type PendingVoiceSendDraft,
} from '../roomInputDrafts';
import type { CapturedVoiceRecording } from './voiceCaptureSession';
import type {
  transitionVoiceRecording,
  VoiceJournalDestination,
  VoiceTransitionOutcome,
} from './voiceRecordingJournal';

const RETRY_BUSY_MESSAGE = 'Another voice message is still sending. Please wait.';
const SEND_FAILED_MESSAGE = 'Failed to send voice message.';
/** What a recording says when a change to it did not reach the disk: the state before stands. */
export const VOICE_NOT_SAVED_MESSAGE = 'Could not save this change to your recording. Try again.';
/** What a recording says that a confirmed Discard could not delete: it is still there. */
export const VOICE_NOT_DELETED_MESSAGE = "Couldn't delete the recording.";
/** What a recording says whose send a crash, a reload or an app update cut short. */
export const VOICE_SEND_INTERRUPTED_MESSAGE = 'Sending this voice message was interrupted.';

/** One attempt to send a recording, as the callback that sends it sees it. */
export type VoiceSendAttemptKeys = {
  /** The Matrix transaction ID of the voice event, the same on every attempt. */
  txnId: string;
  /**
   * Keeps where the event really goes, each time that is known and before the event is sent:
   * after a crash the recording is retried there, under the same ID. Rejects when the disk holds
   * the recording and that could not be written to it: nothing is sent then.
   */
  commit: (destination: PendingVoiceSendContext) => Promise<void>;
};

/** Resolves with the ID the server gave the voice event; without one the recording is not sent. */
export type SendRecordingCallback = (
  file: File,
  duration: number,
  waveform: number[] | undefined,
  context: PendingVoiceSendContext,
  attempt: VoiceSendAttemptKeys
) => Promise<string | undefined>;

export type VoiceDraftStore = {
  /** The slot the composers show. */
  read: () => PendingVoiceSendDraft | undefined;
  write: (draft: PendingVoiceSendDraft | undefined) => void;
  /** `settleVoiceDraft` (voiceDrafts.ts). */
  settle: (
    recordingId: string,
    token: string | undefined,
    failed: PendingVoiceSendDraft | undefined
  ) => boolean;
};

export type VoiceSendAttempt = {
  sendRecording: SendRecordingCallback;
  onFailure: () => void;
};

export type VoiceSendDraftController = {
  sendInitial: (
    recording: CapturedVoiceRecording,
    context: PendingVoiceSendContext,
    attempt: VoiceSendAttempt
  ) => Promise<boolean>;
  retry: (
    attempt: VoiceSendAttempt & {
      claim: () => boolean | void;
      /** Where Send was pressed, for a recording that has no destination here. */
      context: () => PendingVoiceSendContext;
    }
  ) => Promise<boolean>;
};

const getVoiceSendErrorMessage = (error: unknown): string => {
  if (error instanceof MatrixError) {
    return getMatrixUploadErrorMessage(error, getMatrixUploadErrorStage(error) ?? 'send');
  }
  if (error instanceof Error) return error.message;
  return SEND_FAILED_MESSAGE;
};

const newTxnId = () => `mindroom-voice-${randomUuid()}`;

/** Where a recording goes as the journal keeps it: the IDs of what it relates to, no text. */
export const destinationAtRest = ({
  roomId,
  threadId,
  replyDraft,
  threadingEnabled,
  threadView,
  encrypted,
}: PendingVoiceSendContext): VoiceJournalDestination => ({
  roomId,
  threadId,
  replyEventId: replyDraft?.eventId,
  replyThreadId:
    replyDraft?.relation?.rel_type === RelationType.Thread
      ? replyDraft.relation.event_id
      : undefined,
  threadingEnabled,
  threadView,
  encrypted,
});

type PlacedVoiceDraft = PendingVoiceSendDraft & { context: PendingVoiceSendContext; txnId: string };

export const createVoiceSendDraftController = (
  drafts: VoiceDraftStore,
  /** The journal's part in a send (voiceRecordingJournal.ts). */
  transition: typeof transitionVoiceRecording
): VoiceSendDraftController => {
  let retryBusy = false;

  /**
   * One attempt: undefined once the server acknowledged the voice event with an ID and the
   * recording left the disk for it; otherwise the draft to keep, with its error. Nothing is sent
   * before the journal holds where it goes and its transaction ID, on every attempt, so a crash
   * from there on is retried there and posts once. Only a recording the disk never held goes
   * from memory.
   */
  const send = async (
    draft: PlacedVoiceDraft,
    sendRecording: SendRecordingCallback,
    /** The draft as it was, which it stays while where it goes now is not written. */
    before: PendingVoiceSendDraft = draft
  ): Promise<PendingVoiceSendDraft | undefined> => {
    const { recordingId, file, duration, waveform, context, txnId } = draft;
    let outcome: VoiceTransitionOutcome | undefined;
    let kept = before;
    try {
      const eventId = await sendRecording(file, duration, waveform, context, {
        txnId,
        commit: async (destination) => {
          // As what the event goes out, which a retry under this ID has to go out as again.
          const to = { ...destination, encrypted: destination.room.hasEncryptionStateEvent() };
          outcome = await transition(recordingId, (record) => ({
            ...record,
            destination: destinationAtRest(to),
            txnId,
          }));
          if (outcome === 'failed') throw new Error(VOICE_NOT_SAVED_MESSAGE);
          kept = { ...draft, context: to };
        },
      });
      if (!eventId) throw new Error(SEND_FAILED_MESSAGE);
      // Still on disk, it stays with its transaction ID: Retry finds the event and deletes it.
      if ((await transition(recordingId, () => undefined)) === 'failed') {
        throw new Error(VOICE_NOT_SAVED_MESSAGE);
      }
      return undefined;
    } catch (error) {
      // Stopped before its destination was known: all of its audio goes to the disk first, and
      // it says it is saved only if that took it.
      outcome ??= await transition(recordingId);
      return {
        ...kept,
        unprotected: outcome !== 'committed',
        inFlight: undefined,
        errorMessage: getVoiceSendErrorMessage(error),
      };
    }
  };

  const sendInitial: VoiceSendDraftController['sendInitial'] = async (
    recording,
    context,
    attempt
  ) => {
    const draft = { ...recording, context, txnId: newTxnId() };
    const failed = await send(draft, attempt.sendRecording);
    if (!failed) return true;
    drafts.settle(draft.recordingId, undefined, failed);
    attempt.onFailure();
    return false;
  };

  const retry: VoiceSendDraftController['retry'] = async (attempt) => {
    const draft = drafts.read();
    if (retryBusy || !draft || draft.inFlight) return false;

    retryBusy = true;
    try {
      if (attempt.claim() === false) {
        if (drafts.read() === draft) {
          drafts.write({ ...draft, errorMessage: RETRY_BUSY_MESSAGE });
        }
        return false;
      }

      const currentDraft = drafts.read();
      if (currentDraft !== draft || currentDraft.inFlight) {
        attempt.onFailure();
        return false;
      }

      const inFlight = { token: randomUuid() };
      // A recording goes on where its send was attempted, under that transaction ID. Anywhere
      // else it is another event: a first send, or a copy of one that may have arrived.
      const placed = hasVoiceDestination(draft.context)
        ? { ...draft, context: draft.context, txnId: draft.txnId ?? newTxnId() }
        : { ...draft, context: attempt.context(), txnId: newTxnId() };
      drafts.write({ ...placed, errorMessage: undefined, inFlight });
      if (drafts.read()?.inFlight?.token !== inFlight.token) {
        attempt.onFailure();
        return false;
      }
      const failed = await send(placed, attempt.sendRecording, draft);
      if (drafts.settle(draft.recordingId, inFlight.token, failed) && failed) attempt.onFailure();
      return !failed;
    } finally {
      retryBusy = false;
    }
  };

  return { sendInitial, retry };
};
