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
