import { useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { type CreateRoomModalState, createRoomModalAtom } from './createRoomModal';

export const useCreateRoomModalState = (): CreateRoomModalState | undefined =>
  useAtomValue(createRoomModalAtom);

export const useOpenCreateRoomModal = () => {
  const setState = useSetAtom(createRoomModalAtom);
  return useCallback((spaceId?: string) => setState({ spaceId }), [setState]);
};

export const useCloseCreateRoomModal = () => {
  const setState = useSetAtom(createRoomModalAtom);
  return useCallback(() => setState(undefined), [setState]);
};
