import { useCallback, useEffect } from 'react';
import { useAtomValue, useStore } from 'jotai';
import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { useClientConfig } from '../../config/useClientConfig';
import { useForceUpdate } from '../../lib/hooks/useForceUpdate';
import { matchesEnum } from '../../lib/matchesEnum';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useStateEventCallback } from '../../matrix/hooks/useStateEventCallback';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { StateEvent } from '../../matrix/types/room';
import { hasServerEncryptionSetup } from '../devices/serverEncryptionSetup';
import { recoveryDialogAtom } from './recoveryDialog';
import { useRecoveryState } from './recoveryState';

// Accounts already prompted since the app started; a page load starts it over.
const promptedAccounts = new Set<string>();

export const resetPromptedAccountsForTests = () => promptedAccounts.clear();

/**
 * Whether the user has joined a room with encryption on; follows joins, leaves and a joined room
 * turning encryption on.
 */
const useHasEncryptedRoom = (mx: MatrixClient): boolean => {
  const roomIds = useAtomValue(allRoomsAtom);
  const [, refresh] = useForceUpdate();
  const refreshOnEncryption = useCallback(
    (event: MatrixEvent) => {
      if (matchesEnum(event.getType(), StateEvent.RoomEncryption)) refresh();
    },
    [refresh]
  );
  useStateEventCallback(mx, refreshOnEncryption);
  return roomIds.some((roomId) => mx.getRoom(roomId)?.hasEncryptionStateEvent() ?? false);
};

/**
 * Opens the recovery password Set up dialog (an account with no encryption setup) or Unlock
 * dialog (a new session on an account with a recovery password) by itself, once per account per
 * app start, as soon as the user has joined an encrypted room: before that there is nothing to
 * protect or unlock. `encryptionRecovery.promptAtStart: false` turns it off, as does encryption
 * being off by policy. It never replaces a dialog that is already open, and a session that has
 * been verified is never prompted. Renders nothing.
 */
export function EncryptionRecoveryPrompt() {
  const mx = useMatrixClient();
  const store = useStore();
  const { createRoom, encryptionRecovery } = useClientConfig();
  const { kind } = useRecoveryState();
  const userId = mx.getSafeUserId();
  const hasCrypto = Boolean(mx.getCrypto());
  const hasEncryptedRoom = useHasEncryptedRoom(mx);
  const enabled =
    hasCrypto &&
    hasEncryptedRoom &&
    encryptionRecovery?.promptAtStart !== false &&
    !(createRoom?.showEncryptionOption === false && createRoom?.defaultEncryption === false);

  useEffect(() => {
    // A verified session is past the start. It can look locked for a moment later on: a reset
    // signs it with the new identity only once that is published, and opening Unlock then would
    // put a second dialog over the account confirmation the reset is waiting for.
    if (kind === 'ready') promptedAccounts.add(userId);
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
