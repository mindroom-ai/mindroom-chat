import { useEffect, useMemo } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import { ClientEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE,
  type MindroomAccountSettings,
  mergeMindroomAccountSettings,
  sanitizeMindroomAccountSettings,
} from './mindroomAccountSettings';

/**
 * The raw `io.mindroom.settings` account data content of the signed-in account, as the
 * homeserver last sent it. Readers sanitize it; undefined until the account data is known.
 */
export const mindroomAccountSettingsAtom = atom<Record<string, unknown> | undefined>(undefined);

const settingsContent = (mx: MatrixClient): Record<string, unknown> | undefined =>
  mx.getAccountData(MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE as never)?.getContent();

/**
 * Keeps {@link mindroomAccountSettingsAtom} in step with the account data of `mx`: the stored
 * content now, and each change sync delivers (including the echo of this client's own writes).
 */
export const useBindMindroomAccountSettings = (mx: MatrixClient): void => {
  const setContent = useSetAtom(mindroomAccountSettingsAtom);

  useEffect(() => {
    setContent(settingsContent(mx));
    const handleAccountData = (event: MatrixEvent) => {
      if (event.getType() !== MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE) return;






    };
  }, [mx, setContent]);
};

const writes = new WeakMap<MatrixClient, Promise<void>>();

/**
 * Writes a settings patch over the stored content, keeping keys this client does not know.
 * Patches for one client run one after another, each over the content the previous write left
 * (re-read, so whatever the server echoed back counts); a failed write rejects its own caller
 * only.
 */
export const enqueueMindroomAccountSettingsPatch = (
  mx: MatrixClient,
  patch: Partial<MindroomAccountSettings>
): Promise<void> => {
  const task = (writes.get(mx) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const next = mergeMindroomAccountSettings(settingsContent(mx), patch);
      await mx.setAccountData(MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE as never, next as never);
    });
  writes.set(mx, task);
  return task;
};

/** The account's MindRoom settings, with defaults for anything unset or malformed. */
export const useMindroomAccountSettings = (): MindroomAccountSettings => {
  const content = useAtomValue(mindroomAccountSettingsAtom);
  return useMemo(() => sanitizeMindroomAccountSettings(content), [content]);
};

type AccountSettingsWriter = (patch: Partial<MindroomAccountSettings>) => Promise<void>;

/**
 * A writer for this client's settings patches; each call resolves once the homeserver accepted
 * its write. Stable while the client stays the same.
 */
export function useSetMindroomAccountSettings(): AccountSettingsWriter {
  const mx = useMatrixClient();
  return useMemo<AccountSettingsWriter>(
    () => enqueueMindroomAccountSettingsPatch.bind(undefined, mx),
    [mx]
  );
}

/** Whether the account lets the sidebar list canvases; on unless the user turned it off. */
export function useShowCanvasesInSidebar(): boolean {
  const { showCanvasesInSidebar } = useMindroomAccountSettings();
  return showCanvasesInSidebar;
}
