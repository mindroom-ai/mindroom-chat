const noop = async () => undefined;
const empty = {
  triggers: [],
  loading: false,
  loadFailed: false,
  refetch: noop,
  toggleTrigger: noop,
  deleteTrigger: noop,
};

export const useRoomTriggers = () => empty;

export const triggerRowJson = (overrides: Record<string, unknown> = {}) => ({
  trigger_id: 'tr_123',
  kind: 'room_message',
  relation: 'target',
  description: 'Design triage',
  prompt: 'Summarize new issues in the Design channel',
  target_room_id: '!ops:example.org',
  target_thread_id: '$thread1',
  thread_mode: 'thread',
  enabled: true,
  disabled_reason: null,
  last_fired_at: 1764000000000,
  owner_user_id: '@alice:example.org',
  can_manage: true,
  ...overrides,
});
