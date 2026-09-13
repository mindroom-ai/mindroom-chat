import { atomFamily } from 'jotai/utils';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../state/utils/atomWithLocalStorage';

const ROOM_VIEW_MODE = 'roomViewMode';

export type RoomViewMode = 'normal' | 'compact';

export const roomViewModeAtomFamily = atomFamily((roomId: string) =>
  atomWithLocalStorage<RoomViewMode>(
    `${ROOM_VIEW_MODE}:${roomId}`,
    (key) => getLocalStorageItem<RoomViewMode>(key, 'compact'),
    (key, value) => setLocalStorageItem(key, value)
  )
);
