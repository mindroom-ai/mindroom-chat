import { useCallback, useMemo } from 'react';
import { useAccountData } from '../../hooks/useAccountData';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE,
  type MindroomAccountSettings,
  mergeMindroomAccountSettings,
  sanitizeMindroomAccountSettings,
} from './mindroomAccountSettings';

/**
 * Reactive view of the `io.mindroom.settings` account-data dictionary.
 * Re-renders when the account data changes (locally or from another device).
 */
export const useMindroomAccountSettings = (): MindroomAccountSettings => {
  const event = useAccountData(MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE);
  return useMemo(() => sanitizeMindroomAccountSettings(event?.getContent()), [event]);
};

/**
 * Patch-writer for `io.mindroom.settings`. Merges over the currently stored
 * content so unknown keys written by other/newer clients survive.
 */
export const useSetMindroomAccountSettings = (): ((
  patch: Partial<MindroomAccountSettings>
) => Promise<void>) => {
  const mx = useMatrixClient();
  return useCallback(
    async (patch: Partial<MindroomAccountSettings>) => {
      const current = mx
        .getAccountData(MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE as any)
        ?.getContent();
      await mx.setAccountData(
        MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE as any,
        mergeMindroomAccountSettings(current, patch) as any
      );
    },
    [mx]
  );
};

export const useSimpleMode = (): boolean => useMindroomAccountSettings().simpleMode;
