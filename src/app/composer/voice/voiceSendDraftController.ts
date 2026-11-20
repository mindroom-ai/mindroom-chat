import { MatrixError, RelationType } from 'matrix-js-sdk';
import { getMatrixUploadErrorMessage, getMatrixUploadErrorStage } from '../../matrix/matrix';
import { randomUuid } from '../../lib/randomUuid';
import {
  hasVoiceDestination,
  type PendingVoiceSendContext,
  type PendingVoiceSendDraft,
  type PendingVoiceSendInFlight,
} from '../roomInputDrafts';
import type { CapturedVoiceRecording } from './voiceCaptureSession';
import type {
  deleteVoiceRecording,
  updateVoiceRecording,
  VoiceJournalDestination,
} from './voiceRecordingJournal';

const RETRY_BUSY_MESSAGE = 'Another voice message is still sending. Please wait.';
const SEND_FAILED_MESSAGE = 'Failed to send voice message.';
/** What a recording says whose send a crash, a reload or an app update cut short. */
export const VOICE_SEND_INTERRUPTED_MESSAGE = 'Sending this voice message was interrupted.';

/** One attempt to send a recording, as the callback that sends it sees it. */
export type VoiceSendAttemptKeys = {
  /** The Matrix transaction ID of the voice event, the same on every attempt. */
  txnId: string;
  /**
   * Keeps where the event really goes, once that is known and before anything is sent: after a
   * crash the recording is retried there, under the same ID. Rejects when that could not be kept.
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

/** The journal's part in a send (voiceRecordingJournal.ts). */
export type VoiceDraftJournal = {
  update: typeof updateVoiceRecording;
  remove: typeof deleteVoiceRecording;
};

export type VoiceDraftStore = {
  /** The slot the composers show. */
  read: () => PendingVoiceSendDraft | undefined;
  write: (draft: PendingVoiceSendDraft | undefined) => void;
  /**
   * Ends the attempt `token` of a recording wherever its draft is by now, in the slot or waiting
   * for it: gone when sent, kept as `failed` otherwise. The draft of a first attempt (no token)
   * is in neither yet. False when the draft is no longer there: discarded, or replaced.
   */
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
      /** Where Send was pressed, for a recording that has no destination yet. */
      context: () => PendingVoiceSendContext;
    }
  ) => Promise<boolean>;
  discardPending: () => void;
};

const getVoiceSendErrorMessage = (error: unknown): string => {
  if (error instanceof MatrixError) {
    return getMatrixUploadErrorMessage(error, getMatrixUploadErrorStage(error) ?? 'send');
  }
  if (error instanceof Error) return error.message;
  return SEND_FAILED_MESSAGE;
};

const createRetryToken = (): PendingVoiceSendInFlight => ({
  token: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  startedAt: Date.now(),
});

/** Where a recording goes as the journal keeps it: the IDs of what it relates to, no text. */
const destinationAtRest = ({
  roomId,
  threadId,
  replyDraft,
  threadingEnabled,
  threadView,
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
});

type PlacedVoiceDraft = PendingVoiceSendDraft & { context: PendingVoiceSendContext; txnId: string };

export const createVoiceSendDraftController = (
  drafts: VoiceDraftStore,
  journal: VoiceDraftJournal
): VoiceSendDraftController => {
  let retryBusy = false;

  /**
   * One attempt: undefined once the server acknowledged the voice event with an ID, which is the
   * only thing that takes the recording off the disk; otherwise the draft to keep, with its
   * error. Nothing is sent before the journal holds where it goes and its transaction ID, so a
   * crash from there on is retried there and posts once.
   */
  const send = async (
    draft: PlacedVoiceDraft,
    sendRecording: SendRecordingCallback
  ): Promise<PendingVoiceSendDraft | undefined> => {
    const { recordingId, file, duration, waveform, context, txnId } = draft;
    let { unprotected } = draft;
    try {
      const eventId = await sendRecording(file, duration, waveform, context, {
        txnId,
        commit: async (destination) => {
          const kept = await journal.update(recordingId, {
            destination: destinationAtRest(destination),
            txnId,
          });
          // A recording the disk does not hold goes from memory, as its label says.
          if (kept || unprotected) return;
          unprotected = true;
          throw new Error(SEND_FAILED_MESSAGE);
        },
      });
      if (!eventId) throw new Error(SEND_FAILED_MESSAGE);
      void journal.remove(recordingId);
      return undefined;
    } catch (error) {
      return {
        ...draft,
        unprotected,
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
    const draft = { ...recording, context, txnId: `mindroom-voice-${randomUuid()}` };
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

      const inFlight = createRetryToken();
      const placed = {
        ...draft,
        context: hasVoiceDestination(draft.context) ? draft.context : attempt.context(),
        txnId: draft.txnId ?? `mindroom-voice-${randomUuid()}`,
      };
      drafts.write({ ...placed, errorMessage: undefined, inFlight });
      if (drafts.read()?.inFlight?.token !== inFlight.token) {
        attempt.onFailure();
        return false;
      }
      const failed = await send(placed, attempt.sendRecording);
      if (drafts.settle(draft.recordingId, inFlight.token, failed) && failed) attempt.onFailure();
      return !failed;
    } finally {
      retryBusy = false;
    }
  };

  return {
    sendInitial,
    retry,
    discardPending: () => drafts.write(undefined),
  };
};
