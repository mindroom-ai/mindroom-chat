import type { createStore } from 'jotai';
import { pendingVoiceSendDraftAtom, type PendingVoiceSendContext } from '../roomInputDrafts';
import { beginLiveCapture } from '../capture/liveCapture';
import { beginVoiceRecording } from '../capture/captureJournal';
import { createVoiceCaptureSession } from './voiceCaptureSession';

/**
 * Starts the account's one recording (`capture/liveCapture.ts`). Its own module, loaded with the
 * composer, so the capture code stays out of the shell's first download.
 *
 * The recording is journaled (`capture/captureJournal.ts`): each chunk is on disk within about a
 * second, under the account `context` names. A recorder that stops on its own parks its audio as
 * a recovered recording, which is sent wherever Send is pressed; `context`, the composer the
 * microphone was pressed in, only names the account for it. With the draft slot taken, the audio
 * stays on disk for a later page load.
 */
export const startLiveVoiceRecording = (
  store: ReturnType<typeof createStore>,
  context: PendingVoiceSendContext
): Promise<boolean> =>
  beginLiveCapture(store, 'voice', () =>
    createVoiceCaptureSession(
      (startedAt, mimeType) =>
        context.ownerSessionId
          ? beginVoiceRecording(context.ownerSessionId, startedAt, mimeType)
          : undefined,
      (recording) => {
        if (store.get(pendingVoiceSendDraftAtom)) return false;
        store.set(pendingVoiceSendDraftAtom, { ...recording, context, recovered: true });
        return true;
      }
    )
  );
