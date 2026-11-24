import { MatrixError } from 'matrix-js-sdk';
import { getMatrixUploadErrorMessage, getMatrixUploadErrorStage } from '../../matrix/matrix';
import type {
  PendingVoiceSendContext,
  PendingVoiceSendDraft,
  PendingVoiceSendInFlight,
} from '../roomInputDrafts';
import type { CapturedVoiceRecording } from './voiceCaptureSession';
import { deleteVoiceRecording, releaseVoiceRecording } from '../capture/captureJournal';
import { clearSavedVoiceDraft } from './savedVoiceDraft';

const RETRY_BUSY_MESSAGE = 'Another voice message is still sending. Please wait.';

export type SendRecordingCallback = (
  file: File,
  duration: number,
  waveform: number[] | undefined,
  context: PendingVoiceSendContext
) => Promise<void> | void;

export type VoiceDraftStore = {
  read: () => PendingVoiceSendDraft | undefined;
  write: (draft: PendingVoiceSendDraft | undefined) => void;
};

export type VoiceSendAttempt = {
  sendRecording: SendRecordingCallback;
  onFailure: () => void;
  /** False once the account the Send or Retry was pressed under was left. */
  sameAccount: () => boolean;
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
      /** Where a recovered recording goes: the composer its Send is pressed in. */
      context?: () => PendingVoiceSendContext;
    }
  ) => Promise<boolean>;
  discardPending: () => Promise<void>;
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

/** The draft was sent or discarded: its disk copies go. */
const forgetDraft = async ({ context, file, recordingId }: PendingVoiceSendDraft) => {
  await clearSavedVoiceDraft(context.ownerSessionId, recordingId ?? file.name);
  await deleteVoiceRecording(recordingId);
};

export const createVoiceSendDraftController = (
  drafts: VoiceDraftStore
): VoiceSendDraftController => {
  let retryBusy = false;

  const sendInitial: VoiceSendDraftController['sendInitial'] = async (
    recording,
    context,
    attempt
  ) => {
    try {
      await attempt.sendRecording(recording.file, recording.duration, recording.waveform, context);
      await deleteVoiceRecording(recording.recordingId);
      // This was a live recording, not a retry. A draft restored meanwhile is not consumed.
      return true;
    } catch (error) {
      if (attempt.sameAccount()) {
        drafts.write({ ...recording, context, errorMessage: getVoiceSendErrorMessage(error) });
      } else if (recording.recordingId) {
        // The account was left: its disk copy waits, unlocked, for that account to recover.
        releaseVoiceRecording(recording.recordingId);
      }
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
      const context = (draft.recovered && attempt.context?.()) || draft.context;
      drafts.write({ ...draft, errorMessage: undefined, inFlight });
      if (drafts.read()?.inFlight?.token !== inFlight.token) {
        attempt.onFailure();
        return false;
      }
      try {
        await attempt.sendRecording(draft.file, draft.duration, draft.waveform, context);
        await forgetDraft(draft);
        const current = drafts.read();
        if (current?.inFlight?.token === inFlight.token) {
          drafts.write(undefined);
        }
        return true;
      } catch (error) {
        const current = drafts.read();
        const ours = current?.inFlight?.token === inFlight.token;
        if (!attempt.sameAccount()) {
          // The account was left: nothing is parked under the next one. The disk copy waits,
          // unlocked, for that account to recover.
          if (ours) drafts.write(undefined);
          if (draft.recordingId) releaseVoiceRecording(draft.recordingId);
          attempt.onFailure();
          return false;
        }
        if (!current || !ours) return false;
        drafts.write({
          ...current,
          // A recovered recording whose send failed waits where that Send was pressed.
          ...(draft.recovered && { recovered: false, context }),
          inFlight: undefined,
          errorMessage: getVoiceSendErrorMessage(error),
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
    discardPending: async () => {
      const draft = drafts.read();
      drafts.write(undefined);
      if (draft) await forgetDraft(draft);
    },
  };
};
