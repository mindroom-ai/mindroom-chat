import { useMemo } from 'react';
import type { SecretStorageKeyTuple } from 'matrix-js-sdk/lib/secret-storage';
import { useOwnDeviceTrust, type OwnDeviceTrust } from '../verification/useOwnDeviceTrust';
import { useKeyBackupPresence, type KeyBackupPresence } from '../onboarding/useKeyBackupPresence';
import type { SecretStorageKeyContent } from './recoveryInput';
import { useDefaultSecretStorageKey } from './useDefaultSecretStorageKey';

export type DefaultSecretStorageKey = {
  keyId: string;
  keyContent: SecretStorageKeyContent;
  hasPassphrase: boolean;
};

/**
 * Where the account stands on recovery: `locked` has cross-signing and a key but this session is
 * unverified, `ready` is verified, `none` has nothing set up, `other` is anything else, and
 * `unknown` means a fact is still being read.
 */
export type RecoveryState =
  | { kind: 'unknown' }
  | { kind: 'none' }
  | { kind: 'other' }
  | { kind: 'locked'; key: DefaultSecretStorageKey }
  | { kind: 'ready'; key: DefaultSecretStorageKey | null };

export const describeKey = ([keyId, description]: SecretStorageKeyTuple): DefaultSecretStorageKey => {
  const keyContent: SecretStorageKeyContent = description;
  return { keyId, keyContent, hasPassphrase: Boolean(keyContent.passphrase) };
};

export function classifyRecovery(facts: {
  trust: OwnDeviceTrust | undefined;
  defaultKey: SecretStorageKeyTuple | null | undefined;
  backup: KeyBackupPresence;
}): RecoveryState {
  const { trust, defaultKey, backup } = facts;
  if (!trust || defaultKey === undefined) return { kind: 'unknown' };
  const key = defaultKey ? describeKey(defaultKey) : null;
  if (trust.thisDeviceVerified) return { kind: 'ready', key };
  if (trust.crossSigning && key) return { kind: 'locked', key };
  if (backup === 'unknown') return { kind: 'unknown' };
  if (!trust.crossSigning && !key && backup === 'absent') return { kind: 'none' };
  return { kind: 'other' };
}

/** The account's recovery state, with a stable identity while its inputs do not change. */
export function useRecoveryState(): RecoveryState {
  const trust = useOwnDeviceTrust();
  const defaultKey = useDefaultSecretStorageKey();
  const backup = useKeyBackupPresence();
  return useMemo(
    () => classifyRecovery({ trust, defaultKey, backup }),
    [trust, defaultKey, backup]
  );
}
