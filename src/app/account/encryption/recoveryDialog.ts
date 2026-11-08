import { atom } from 'jotai';

/**
 * The recovery dialog to show, if any: `setup` a recovery password, `unlock` with one, `reset`
 * the account's encryption, or `change` the password. `RecoveryDialogRenderer` shows it.
 */
export type RecoveryDialog = 'setup' | 'unlock' | 'reset' | 'change';

export const recoveryDialogAtom = atom<RecoveryDialog | undefined>(undefined);
