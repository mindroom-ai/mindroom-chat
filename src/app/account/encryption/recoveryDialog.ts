import { atom } from 'jotai';
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  removeStorageItemSafe,
  setStorageItemSafe,
} from '../../lib/safeLocalStorage';
import { recoveryPromptSnoozeStorageKey } from '../../preferences/accountStorageKeys';

/**
 * The recovery dialog to show, if any: `setup` a recovery password, `unlock` with one, `reset`
 * the account's encryption, or `change` the password. `RecoveryDialogRenderer` shows it.
 */
export type RecoveryDialog = 'setup' | 'unlock' | 'reset' | 'change';

export const recoveryDialogAtom = atom<RecoveryDialog | undefined>(undefined);

/** How long a recovery dialog closed unfinished keeps the start prompt from opening it again. */
export const RECOVERY_PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/** Keeps the start prompt (`EncryptionRecoveryPrompt`) closed for the account on this browser. */
export const snoozeRecoveryPrompt = (userId: string): void => {
  setStorageItemSafe(
    getSafeLocalStorage(),
    recoveryPromptSnoozeStorageKey(userId),
    String(Date.now() + RECOVERY_PROMPT_SNOOZE_MS)
  );
};

export const isRecoveryPromptSnoozed = (userId: string): boolean =>
  Number(getStorageItemSafe(getSafeLocalStorage(), recoveryPromptSnoozeStorageKey(userId))) >
  Date.now();

export const endRecoveryPromptSnooze = (userId: string): void => {
  removeStorageItemSafe(getSafeLocalStorage(), recoveryPromptSnoozeStorageKey(userId));
};
