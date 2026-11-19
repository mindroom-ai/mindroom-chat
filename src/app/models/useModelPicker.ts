import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { getModelController, ModelPickerSnapshot } from './modelController';
import type { ModelCatalogEntry, ReasoningLevel } from './modelProtocol';

export type ModelPickerState = ModelPickerSnapshot & {
  refresh: () => void;
  chooseRuntime: (runtimeId: string) => void;
  /** The model at `level`, or at its default level without one. */
  selectModel: (modelKey: string, level?: ReasoningLevel) => void;
  resetToRoomDefault: () => void;
};

/** Mount once with the client; picker dismissal must never dispose this owner. */
export const useModelControllerLifetime = (): void => {
  const mx = useMatrixClient();
  const controller = useMemo(() => getModelController(mx), [mx]);
  useEffect(() => controller.retain(), [controller]);
};

/**
 * The models the thread's picker lists, as its discovery last answered. Read only: it watches the
 * scope without asking for it (`ModelController.watch`), so it is empty until a composer's picker
 * has discovered the thread's catalog, and for a viewer the router answers nothing.
 */
export const useThreadModelCatalog = (room: Room, threadId: string): ModelCatalogEntry[] => {
  const mx = useMatrixClient();
  const controller = useMemo(() => getModelController(mx), [mx]);
  const watch = useCallback(
    (listener: () => void) => controller.watch(room, threadId, listener),
    [controller, room, threadId]
  );
  const getModels = useCallback(
    () => controller.getSnapshot(room, threadId).models,
    [controller, room, threadId]
  );
  return useSyncExternalStore(watch, getModels, getModels);
};

/** Subscription and actions only: protocol and pending state live in the client owner. */
export const useModelPicker = (room: Room, threadId: string | undefined): ModelPickerState => {
  const mx = useMatrixClient();
  const controller = useMemo(() => getModelController(mx), [mx]);
  const subscribe = useCallback(
    (listener: () => void) => controller.subscribe(room, threadId, listener),
    [controller, room, threadId]
  );
  const getSnapshot = useCallback(
    () => controller.getSnapshot(room, threadId),
    [controller, room, threadId]
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const actions = useMemo(
    () => ({
      refresh: () => controller.refresh(room, threadId),
      chooseRuntime: (runtimeId: string) => controller.chooseRuntime(room, threadId, runtimeId),
      selectModel: (key: string, level?: ReasoningLevel) =>
        controller.selectModel(room, threadId, key, level),
      resetToRoomDefault: () => controller.resetToRoomDefault(room, threadId),
    }),
    [controller, room, threadId]
  );
  return useMemo(() => ({ ...snapshot, ...actions }), [snapshot, actions]);
};
