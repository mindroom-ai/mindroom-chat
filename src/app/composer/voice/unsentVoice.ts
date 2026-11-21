import type { createStore } from 'jotai';
import { liveVoiceRecordingAtom, pendingVoiceSendDraftAtom } from '../roomInputDrafts';
import { clearSavedVoiceDraft, hasSavedVoiceDraft } from './savedVoiceDraft';
import { clearVoiceRecordings, hasVoiceRecordings } from './voiceRecordingJournal';

type Store = ReturnType<typeof createStore>;

export const liveVoiceRecordingFor = (store: Store, userId: string) => {
  const live = store.get(liveVoiceRecordingAtom);
  return live?.context.ownerSessionId === userId ? live : undefined;
};

export const pendingVoiceDraftFor = (store: Store, userId: string) => {
  const draft = store.get(pendingVoiceSendDraftAtom);
  return draft?.context.ownerSessionId === userId ? draft : undefined;
};

export const hasUnsentVoice = async (store: Store, userId: string): Promise<boolean> =>
  !!(liveVoiceRecordingFor(store, userId) || pendingVoiceDraftFor(store, userId)) ||
  (await Promise.all([hasVoiceRecordings(userId), hasSavedVoiceDraft(userId)])).some(Boolean);

export const discardUnsentVoice = async (store: Store, userId: string): Promise<void> => {
  await liveVoiceRecordingFor(store, userId)?.discard();
  if (pendingVoiceDraftFor(store, userId)) store.set(pendingVoiceSendDraftAtom, undefined);
  await Promise.all([clearVoiceRecordings(userId), clearSavedVoiceDraft(userId)]);
};
