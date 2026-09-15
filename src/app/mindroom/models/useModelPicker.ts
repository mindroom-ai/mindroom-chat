import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { disposeModelController, getModelController, ModelPickerSnapshot } from './modelController';

export type ModelPickerState = ModelPickerSnapshot & {
  refresh: () => void;
  chooseRuntime: (runtimeId: string) => void;
  selectModel: (modelKey: string) => void;
  resetToRoomDefault: () => void;
};

/** Mount once with the client; picker dismissal must never dispose this owner. */
export const useModelControllerLifetime = (): void => {
  const mx = useMatrixClient();
  useEffect(() => () => disposeModelController(mx), [mx]);
};

/** Subscription and actions only: protocol and pending state live in the client owner. */
export const useModelPicker = (room: Room, threadId: string | undefined): ModelPickerState => {
  const mx = useMatrixClient();
  const subscribe = useCallback(
    (listener: () => void) => getModelController(mx).subscribe(room, threadId, listener),
    [mx, room, threadId]
  );
  const getSnapshot = useCallback(
    () => getModelController(mx).getSnapshot(room, threadId),
    [mx, room, threadId]
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const actions = useMemo(
    () => ({
      refresh: () => getModelController(mx).refresh(room, threadId),
      chooseRuntime: (runtimeId: string) =>
        getModelController(mx).chooseRuntime(room, threadId, runtimeId),
      selectModel: (key: string) => getModelController(mx).selectModel(room, threadId, key),
      resetToRoomDefault: () => getModelController(mx).resetToRoomDefault(room, threadId),
    }),
    [mx, room, threadId]
  );
  return useMemo(() => ({ ...snapshot, ...actions }), [snapshot, actions]);
};
