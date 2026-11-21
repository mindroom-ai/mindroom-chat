export const loadVoiceRecordingJournal = () =>
  import('./voiceRecordingJournal').catch(() => undefined);

export const deleteVoiceRecording = async (id?: string): Promise<void> => {
  if (id) await (await loadVoiceRecordingJournal())?.deleteVoiceRecording(id);
};

export const releaseVoiceRecording = (id?: string): void => {
  if (id) void loadVoiceRecordingJournal().then((journal) => journal?.releaseVoiceRecording(id));
};
