import { atom, type createStore } from 'jotai';
import { getImperativeJotaiStore } from '../lib/state/jotaiStore';

type Store = ReturnType<typeof createStore>;

/** Context that opens the Mac Computer Access sheet, optionally pre-selecting a room or agent. */
export type DesktopAccessModalRequest = {
  roomId?: string;
  agentUserId?: string;
  agentName?: string;
};

/** The open Mac Computer Access modal request, or `null` when closed. */
export const desktopAccessModalAtom = atom<DesktopAccessModalRequest | null>(null);

export const openDesktopAccessModal = (
  request: DesktopAccessModalRequest = {},
  store: Store = getImperativeJotaiStore()
): void => {
  store.set(desktopAccessModalAtom, request);
};

export const closeDesktopAccessModal = (store: Store = getImperativeJotaiStore()): void => {
  store.set(desktopAccessModalAtom, null);
};
