import type { createStore } from 'jotai';
import { beginLiveVoiceRecording } from './liveVoiceRecording';
import { createVoiceCaptureSession } from './voiceCaptureSession';

/**
 * Starts the account's one recording (`liveVoiceRecording.ts`). Its own module, loaded with the
 * composer, so the capture code stays out of the shell's first download.
 */
export const startLiveVoiceRecording = (store: ReturnType<typeof createStore>): Promise<boolean> =>
  beginLiveVoiceRecording(store, createVoiceCaptureSession);
