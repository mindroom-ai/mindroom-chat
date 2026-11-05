import { useCrossRoomThreadIndex } from './useCrossRoomThreadIndex';

/**
 * Keeps the cross-room thread index (Threads page, recent threads, command palette) current for
 * the whole session. Mount it once, at client scope.
 */
export function CrossRoomThreadIndexFeature() {
  useCrossRoomThreadIndex();
  return null;
}
