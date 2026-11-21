import type { createStore } from 'jotai';
import { pendingVoiceSendDraftAtom, type PendingVoiceSendContext } from '../roomInputDrafts';
import { beginLiveVoiceRecording } from './liveVoiceRecording';
import { createVoiceCaptureSession } from './voiceCaptureSession';
import { beginVoiceRecording } from './voiceRecordingJournal';

/**
 * Starts the account's one recording (`liveVoiceRecording.ts`). Its own module, loaded with the
 * composer, so the capture code stays out of the shell's first download.
 *
 * The recording is journaled (`voiceRecordingJournal.ts`): each chunk is on disk within about a
 * second, under the account `context` names. A recorder that stops on its own parks its audio as
 * a recovered recording, which is sent wherever Send is pressed; `context`, the composer the
 * microphone was pressed in, only names the account for it. With the draft slot taken, the audio
 * stays on disk for a later page load.
 */
export const startLiveVoiceRecording = (
  store: ReturnType<typeof createStore>,
  context: PendingVoiceSendContext
): Promise<boolean> =>
  beginLiveVoiceRecording(store, () => {
    const session = createVoiceCaptureSession(
      (startedAt, mimeType) =>
        context.ownerSessionId
          ? beginVoiceRecording(context.ownerSessionId, startedAt, mimeType)
          : undefined,
      (recording) => {
        if (store.get(pendingVoiceSendDraftAtom)) return false;
        store.set(pendingVoiceSendDraftAtom, { ...recording, context, recovered: true });
        return true;
      }
    );
    // The Mac app's recorder keeps a recording through a reload, named by its account.
    return { ...session, start: () => session.start(context.ownerSessionId) };
  });
