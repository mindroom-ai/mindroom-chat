import { useEffect } from 'react';
import { useStore } from 'jotai';
import { useClientConfig } from '../../config/useClientConfig';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { hasServerEncryptionSetup } from '../devices/serverEncryptionSetup';
import { recoveryDialogAtom } from './recoveryDialog';
import { useRecoveryState } from './recoveryState';

// Accounts already prompted since the app started; a page load starts it over.
const promptedAccounts = new Set<string>();

export const resetPromptedAccountsForTests = () => promptedAccounts.clear();

/**
 * Opens the recovery password Set up dialog (an account with no encryption setup) or Unlock
 * dialog (a new session on an account with a recovery password) by itself, once per account per
 * app start. `encryptionRecovery.promptAtStart: false` turns it off, as does encryption being
 * off by policy. It never replaces a dialog that is already open. Renders nothing.
 */
export function EncryptionRecoveryPrompt() {
  const mx = useMatrixClient();
  const store = useStore();
  const { createRoom, encryptionRecovery } = useClientConfig();
  const { kind } = useRecoveryState();
  const userId = mx.getSafeUserId();
  const hasCrypto = Boolean(mx.getCrypto());
  const enabled =
    hasCrypto &&
    encryptionRecovery?.promptAtStart !== false &&
    !(createRoom?.showEncryptionOption === false && createRoom?.defaultEncryption === false);

  useEffect(() => {
    if (!enabled || (kind !== 'locked' && kind !== 'none') || promptedAccounts.has(userId)) return;
    const open = (dialog: 'setup' | 'unlock') => {
      if (store.get(recoveryDialogAtom) === undefined) store.set(recoveryDialogAtom, dialog);
    };
    if (kind === 'locked') {
      promptedAccounts.add(userId);
      open('unlock');
      return;
    }
    let cancelled = false;
    // The account counts as prompted once the check settles; a state change that cancels a
    // pending check leaves it unprompted, so a later `locked` still opens Unlock.
    hasServerEncryptionSetup(mx).then(
      (hasSetup) => {
        if (cancelled) return;
        promptedAccounts.add(userId);
        if (!hasSetup) open('setup');
      },
      () => {
        if (!cancelled) promptedAccounts.add(userId);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, kind, userId, mx, store]);

  return null;
}
