import { useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { type CreateSpaceModalState, createSpaceModalAtom } from './createSpaceModal';

export const useCreateSpaceModalState = (): CreateSpaceModalState | undefined =>
  useAtomValue(createSpaceModalAtom);

export const useOpenCreateSpaceModal = () => {
  const setState = useSetAtom(createSpaceModalAtom);
  return useCallback((spaceId?: string) => setState({ spaceId }), [setState]);
};

export const useCloseCreateSpaceModal = () => {
  const setState = useSetAtom(createSpaceModalAtom);
  return useCallback(() => setState(undefined), [setState]);
};
