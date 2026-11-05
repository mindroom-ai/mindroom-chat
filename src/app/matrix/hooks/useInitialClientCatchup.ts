import { useCallback, useRef, useSyncExternalStore } from 'react';
import { ClientEvent, MatrixClient, SyncState, SyncStateData } from 'matrix-js-sdk';

/** A sync state, and whether sync said it was still catching up when it reached it. */
type SyncReading = { state: SyncState | null | undefined; catchingUp: boolean };

/**
 * Whether newer server data may still be on its way: sync has not started, has processed only its
 * first (possibly stored) response, is catching up after a lost connection, or is draining queued
 * messages with immediate follow-up requests. A client that is offline or failing counts as done,
 * so views that wait on this give up rather than wait forever.
 */
const mayStillCatchUp = ({ state, catchingUp }: SyncReading): boolean => {
  switch (state) {
    case null:
    case undefined:
    case SyncState.Prepared:
    case SyncState.Catchup:
      return true;
    case SyncState.Syncing:
      return catchingUp;
    case SyncState.Reconnecting:
    case SyncState.Error:
    case SyncState.Stopped:
      return false;
  }
};

const readClient = (mx: MatrixClient | undefined): SyncReading => {
  if (!mx) return { state: undefined, catchingUp: false };
  // Test stand-ins of the client may have no getSyncStateData.
  const data = typeof mx.getSyncStateData === 'function' ? mx.getSyncStateData() : null;
  return { state: mx.getSyncState(), catchingUp: data?.catchingUp === true };
};

/**
 * True while the client is still catching up with the server (see `mayStillCatchUp`), and without
 * a client; false once sync runs with nothing pending. Follows the client's sync events and turns
 * true again when a later sync catches up. The caller re-renders only when the answer changes.
 */
export function useInitialClientCatchup(mx: MatrixClient | undefined): boolean {
  // The newest sync event of the subscribed client, which outranks the client's getters. It ends
  // with its subscription, so a client subscribed again is read afresh.
  const lastEventRef = useRef<{ client: MatrixClient; reading: SyncReading }>();

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!mx) return () => undefined;
      const onSync = (state: SyncState, _previous: SyncState | null, data?: SyncStateData) => {
        lastEventRef.current = {
          client: mx,
          reading: { state, catchingUp: data?.catchingUp === true },
        };
        onChange();
      };
      mx.on(ClientEvent.Sync, onSync);
      return () => {
        mx.removeListener(ClientEvent.Sync, onSync);
        lastEventRef.current = undefined;
      };
    },
    [mx]
  );

  // React reads this again right after subscribing, so a sync state reached between the render
  // and the subscription still counts.
  const getSnapshot = useCallback(() => {
    const lastEvent = lastEventRef.current;
    return mayStillCatchUp(
      lastEvent && lastEvent.client === mx ? lastEvent.reading : readClient(mx)
    );
  }, [mx]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
