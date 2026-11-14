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

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a recovery dialog closed unfinished keeps the start prompt from opening it again. */
export const RECOVERY_PROMPT_SNOOZE_MS = 7 * DAY_MS;

/** Keeps the start prompt (`EncryptionRecoveryPrompt`) closed for the account on this browser. */
export const snoozeRecoveryPrompt = (userId: string): void => {
  setStorageItemSafe(
    getSafeLocalStorage(),
    recoveryPromptSnoozeStorageKey(userId),
    String(Date.now() + RECOVERY_PROMPT_SNOOZE_MS)
  );
};

/**
 * A snooze ending more than a day further away than one snooze lasts was written by a clock set
 * ahead, and is ignored; the day leaves room for a clock corrected back a little.
 */
export const isRecoveryPromptSnoozed = (userId: string): boolean => {
  const left =
    Number(getStorageItemSafe(getSafeLocalStorage(), recoveryPromptSnoozeStorageKey(userId))) -
    Date.now();
  return left > 0 && left <= RECOVERY_PROMPT_SNOOZE_MS + DAY_MS;
};

export const endRecoveryPromptSnooze = (userId: string): void => {
  removeStorageItemSafe(getSafeLocalStorage(), recoveryPromptSnoozeStorageKey(userId));
};
