import { useEffect, useMemo } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import { ClientEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';
import { useMatrixClient } from './useMatrixClient';
import {
  MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE,
  type AccountSettings,
  mergeAccountSettings,
  sanitizeAccountSettings,
} from '../../preferences/accountSettings';

/**
 * The raw `io.mindroom.settings` account data content of the signed-in account, as the
 * homeserver last sent it. Readers sanitize it; undefined until the account data is known.
 */
export const accountSettingsAtom = atom<Record<string, unknown> | undefined>(undefined);

const settingsContent = (mx: MatrixClient): Record<string, unknown> | undefined =>
  mx.getAccountData(MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE as never)?.getContent();

/**
 * Keeps {@link accountSettingsAtom} in step with the account data of `mx`: the stored
 * content now, and each change sync delivers (including the echo of this client's own writes).
 */
export const useBindAccountSettings = (mx: MatrixClient): void => {
  const setContent = useSetAtom(accountSettingsAtom);

  useEffect(() => {
    setContent(settingsContent(mx));
    const handleAccountData = (event: MatrixEvent) => {
      if (event.getType() !== MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE) return;
      setContent(event.getContent());
    };
    const stopListening = (): void => {
      mx.off(ClientEvent.AccountData, handleAccountData);
    };
    mx.on(ClientEvent.AccountData, handleAccountData);
    return stopListening;
  }, [mx, setContent]);
};

const writes = new WeakMap<MatrixClient, Promise<void>>();

/**
 * Writes a settings patch over the stored content, keeping keys this client does not know.
 * Patches for one client run one after another, each over the content the previous write left
 * (re-read, so whatever the server echoed back counts); a failed write rejects its own caller
 * only.
 */
export const enqueueAccountSettingsPatch = (
  mx: MatrixClient,
  patch: Partial<AccountSettings>
): Promise<void> => {
  const task = (writes.get(mx) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const next = mergeAccountSettings(settingsContent(mx), patch);
      await mx.setAccountData(MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE as never, next as never);
    });
  writes.set(mx, task);
  return task;
};

/** The account's MindRoom settings, with defaults for anything unset or malformed. */
export const useAccountSettings = (): AccountSettings => {
  const content = useAtomValue(accountSettingsAtom);
  return useMemo(() => sanitizeAccountSettings(content), [content]);
};

type AccountSettingsWriter = (patch: Partial<AccountSettings>) => Promise<void>;

/**
 * A writer for this client's settings patches; each call resolves once the homeserver accepted
 * its write. Stable while the client stays the same.
 */
export function useSetAccountSettings(): AccountSettingsWriter {
  const mx = useMatrixClient();
  return useMemo<AccountSettingsWriter>(
    () => enqueueAccountSettingsPatch.bind(undefined, mx),
    [mx]
  );
}
