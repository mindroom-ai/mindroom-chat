import { useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  type SpaceSettingsPage,
  type SpaceSettingsState,
  spaceSettingsAtom,
} from '../spaceSettings';

export const useSpaceSettingsState = (): SpaceSettingsState | undefined =>
  useAtomValue(spaceSettingsAtom);

/** Opens the settings dialog of a Space, optionally on a given page. */
export const useOpenSpaceSettings = () => {
  const setState = useSetAtom(spaceSettingsAtom);
  return useCallback(
    (roomId: string, page?: SpaceSettingsPage) => setState({ roomId, page }),
    [setState]
  );
};

export const useCloseSpaceSettings = () => {
  const setState = useSetAtom(spaceSettingsAtom);
  return useCallback(() => setState(undefined), [setState]);
};
