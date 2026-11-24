import { useCallback, useMemo } from 'react';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { useAccountData } from '../matrix/hooks/useAccountData';
import { useSetAccountSettings } from '../matrix/hooks/useAccountSettings';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useServerSyncApplied } from '../matrix/hooks/useServerSyncApplied';
import { createSessionId } from '../matrix/session/sessions';
import { archivedRoomsAtom } from '../matrix/state/archivedRooms';
import { dismissedTipsSessionAtom, tourAtom } from '../navigation/tourState';
import { useSelectedRoom } from '../navigation/useSelectedRoom';
import {
  MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE,
  sanitizeAccountSettings,
} from '../preferences/accountSettings';
import { crossRoomThreadIndexAtom } from '../threads/cross-room/crossRoomThreadIndex';
import { evaluateContextualTip, type ContextualTip, type ContextualTipId } from './contextualTips';

export type ContextualTipState = {
  tip: ContextualTip | undefined;
  dismissTip: (tipId: ContextualTipId) => void;
  openTipTour: (tip: ContextualTip) => void;
};

/**
 * Evaluates the active contextual UI tip for the signed-in account and provides handlers to
 * dismiss it or jump straight into the corresponding interface tour step.
 */
export function useContextualTip(): ContextualTipState {
  const mx = useMatrixClient();
  const store = useStore();
  const sessionId = createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId());
  const synced = useServerSyncApplied(mx);
  const index = useAtomValue(crossRoomThreadIndexAtom);
  const selectedRoomId = useSelectedRoom();
  const archivedRooms = useAtomValue(archivedRoomsAtom);
  const accountSettingsEvent = useAccountData(MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE);
  const setAccountSettings = useSetAccountSettings();
  const setTour = useSetAtom(tourAtom);
  const sessionDismissed = useAtomValue(dismissedTipsSessionAtom).get(sessionId);

  const storedDismissed = useMemo(
    () => sanitizeAccountSettings(accountSettingsEvent?.getContent()).dismissedTips,
    [accountSettingsEvent]
  );

  const dismissedTips = useMemo(() => {
    if (!sessionDismissed || sessionDismissed.size === 0) return new Set(storedDismissed);
    return new Set([...storedDismissed, ...sessionDismissed]);
  }, [storedDismissed, sessionDismissed]);

  const tip = useMemo(() => {
    if (!synced || !index.bootstrapped) return undefined;
    return evaluateContextualTip({
      entries: index.entries.values(),
      selectedRoomId,
      archivedRooms,
      dismissedTips,
      now: Date.now(),
    });
  }, [synced, index, selectedRoomId, archivedRooms, dismissedTips]);

  const dismissTip = useCallback(
    (tipId: ContextualTipId) => {
      const current = store.get(dismissedTipsSessionAtom);
      const existing = current.get(sessionId);
      if (existing?.has(tipId)) return;

      const next = new Map(current);
      const nextSet = new Set(existing);
      nextSet.add(tipId);
      next.set(sessionId, nextSet);
      store.set(dismissedTipsSessionAtom, next);

      if (!synced || storedDismissed.includes(tipId)) return;
      const persisted = Array.from(new Set([...storedDismissed, ...nextSet]));
      setAccountSettings({ dismissedTips: persisted }).catch(() => undefined);
    },
    [store, sessionId, synced, storedDismissed, setAccountSettings]
  );

  const openTipTour = useCallback(
    (activeTip: ContextualTip) => {
      dismissTip(activeTip.id);
      setTour({ level: 'full', initialStep: activeTip.tourStep });
    },
    [dismissTip, setTour]
  );

  return { tip, dismissTip, openTipTour };
}
