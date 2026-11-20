import { MatrixError } from 'matrix-js-sdk';
import { getMatrixUploadErrorMessage, getMatrixUploadErrorStage } from '../../matrix/matrix';
import { randomUuid } from '../../lib/randomUuid';
import {
  hasVoiceDestination,
  replyDraftAtRest,
  type PendingVoiceSendContext,
  type PendingVoiceSendDraft,
  type PendingVoiceSendInFlight,
} from '../roomInputDrafts';
import type { CapturedVoiceRecording } from './voiceCaptureSession';
import type { deleteVoiceRecording, updateVoiceRecording } from './voiceRecordingJournal';

const RETRY_BUSY_MESSAGE = 'Another voice message is still sending. Please wait.';
/** What a recording says whose send a crash, a reload or an app update cut short. */
export const VOICE_SEND_INTERRUPTED_MESSAGE = 'Sending this voice message was interrupted.';

/** Resolves once the voice event has an ID: the server accepted it. */
export type SendRecordingCallback = (
  file: File,
  duration: number,
  waveform: number[] | undefined,
  context: PendingVoiceSendContext,
  /** The Matrix transaction ID of the voice event, the same on every attempt. */
  txnId: string
) => Promise<void> | void;

/** The journal's part in a send (voiceRecordingJournal.ts). */
export type VoiceDraftJournal = {
  update: typeof updateVoiceRecording;
  remove: typeof deleteVoiceRecording;
};

export type VoiceDraftStore = {
  read: () => PendingVoiceSendDraft | undefined;
  write: (draft: PendingVoiceSendDraft | undefined) => void;
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
  return 'Failed to send voice message.';
};

const createRetryToken = (): PendingVoiceSendInFlight => ({
  token: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  startedAt: Date.now(),
});

type PlacedVoiceDraft = PendingVoiceSendDraft & { context: PendingVoiceSendContext; txnId: string };

export const createVoiceSendDraftController = (
  drafts: VoiceDraftStore,
  journal: VoiceDraftJournal
): VoiceSendDraftController => {
  let retryBusy = false;

  /**
   * One attempt. The journal knows where the recording goes and its transaction ID before the
   * upload starts, so a crash from here on is retried there and posts once; it forgets the
   * recording only once the voice event has an ID, not when the upload completes.
   */
  const send = async (
    { recordingId, file, duration, waveform, context, txnId }: PlacedVoiceDraft,
    sendRecording: SendRecordingCallback
  ): Promise<void> => {
    const { ownerSessionId, roomId, threadId, replyDraft, threadView } = context;
    await journal.update(recordingId, {
      destination: {
        roomId,
        threadId,
        replyDraft: replyDraftAtRest(ownerSessionId, roomId, replyDraft),
        threadingEnabled: context.threadingEnabled,
        signalBridgedRoom: context.signalBridgedRoom,
        threadView,
      },
      txnId,
      errorMessage: undefined,
    });
    await sendRecording(file, duration, waveform, context, txnId);
    void journal.remove(recordingId);
  };
  /** The message of a failed attempt, which the journal keeps with the recording. */
  const failed = (recordingId: string, error: unknown): string => {
    const errorMessage = getVoiceSendErrorMessage(error);
    void journal.update(recordingId, { errorMessage });
    return errorMessage;
  };

  const sendInitial: VoiceSendDraftController['sendInitial'] = async (
    recording,
    context,
    attempt
  ) => {
    const draft = { ...recording, context, txnId: `mindroom-voice-${randomUuid()}` };
    try {
      await send(draft, attempt.sendRecording);
      drafts.write(undefined);
      return true;
    } catch (error) {
      drafts.write({ ...draft, errorMessage: failed(draft.recordingId, error) });
      attempt.onFailure();
      return false;
    }
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
      try {
        await send(placed, attempt.sendRecording);
        const current = drafts.read();
        if (current?.inFlight?.token === inFlight.token) {
          drafts.write(undefined);
        }
        return true;
      } catch (error) {
        const current = drafts.read();
        if (!current || current.inFlight?.token !== inFlight.token) return false;
        drafts.write({
          ...current,
          inFlight: undefined,
          errorMessage: failed(draft.recordingId, error),
        });
        attempt.onFailure();
        return false;
      }
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
