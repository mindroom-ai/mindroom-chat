import { ClientEvent, SyncState, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';

// The SDK saves its sync store after the first sync of a session and then at most every five
// minutes. A reload or an offline start in between replays the saved sync, so a message deleted
// since the last save came back with its text, and its thread counted it again, until the next
// sync brought the redaction (offline: until the client is online again). A reply that the
// session's first sync happened to bring was saved, and its redaction a moment later was not.
// This module saves the store after each sync batch that brought a redaction. Redactions are
// rare (a deleted message, an agent's withdrawn draft), so the extra writes are few.

type SyncBatchState = SyncState | null;

/**
 * Saves the client's sync store after every sync batch that brought a redaction, unless the SDK
 * saves that batch itself; call it before the client starts. Returns a function that stops it.
 */
export const keepRedactionsInSavedSync = (mx: MatrixClient): (() => void) => {
  let redactionSinceSave = false;
  let saving = false;
  let saveAgain = false;

  const save = () => {
    if (saving) {
      // The batch came in while the last save read the store; save once more afterwards.
      saveAgain = true;
      return;
    }
    saving = true;
    mx.store
      .save(true)
      .catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[savedSyncRedactions] could not save the sync store', error);
      })
      .finally(() => {
        saving = false;
        if (!saveAgain) return;
        saveAgain = false;
        save();
      });
  };

  const onEvent = (event: MatrixEvent) => {
    // Synced events only: a local redaction still being sent has a status.
    if (event.isRedaction() && event.status === null) redactionSinceSave = true;
  };

  // The SDK reports SYNCING once it has processed a batch, just before it decides to save.
  const onSync = (state: SyncBatchState) => {
    if (state !== SyncState.Syncing || !redactionSinceSave) return;
    redactionSinceSave = false;
    // The session's first batch and the first after five minutes are saved by the SDK.
    if (mx.store.wantsSave()) return;
    save();
  };

  mx.on(ClientEvent.Event, onEvent);
  mx.on(ClientEvent.Sync, onSync);
  return () => {
    mx.removeListener(ClientEvent.Event, onEvent);
    mx.removeListener(ClientEvent.Sync, onSync);
  };
};
