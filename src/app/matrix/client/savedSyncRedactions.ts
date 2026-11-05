import { ClientEvent, SyncState, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';

// The SDK saves its sync store after the first sync of a session and then at most every five
// minutes. A reload or an offline start in between replays the saved sync, so a message deleted
// since the last save came back with its text, and its thread counted it again, until the next
// sync brought the redaction (offline: until the client is online again). A reply that the
// session's first sync happened to bring was saved, and its redaction a moment later was not.
// This module saves the store after a sync batch that brought a redaction.
//
// Each save writes the whole sync accumulator, every room of the account. A lone redaction (an
// agent withdrawing its draft) is saved at once; redactions that come in a burst (a moderator
// removing several messages) then share one more save, REDACTION_SAVE_GAP_MS after the last one
// ended. A batch the SDK saves itself holds everything before it, so a save still waiting is
// dropped then.

/** The least time between the end of one save and the start of the next. */
export const REDACTION_SAVE_GAP_MS = 2_000;

type SyncBatchState = SyncState | null;

/**
 * Saves the client's sync store after sync batches that brought a redaction, unless the SDK
 * saves such a batch itself; call it before the client starts. Returns a function that stops it.
 */
export const keepRedactionsInSavedSync = (mx: MatrixClient): (() => void) => {
  let redactionSinceSave = false;
  let saving = false;
  let saveAfterThisOne = false;
  let lastSaveEndedAt = Number.NEGATIVE_INFINITY;
  let waiting: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const dropWaitingSave = () => {
    if (waiting === undefined) return;
    clearTimeout(waiting);
    waiting = undefined;
  };

  const requestSave = () => {
    if (stopped || waiting !== undefined) return;
    if (saving) {
      // The store changed while this save read it; save once more afterwards.
      saveAfterThisOne = true;
      return;
    }
    const wait = lastSaveEndedAt + REDACTION_SAVE_GAP_MS - Date.now();
    if (wait > 0) {
      waiting = setTimeout(() => {
        waiting = undefined;
        requestSave();
      }, wait);
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
        lastSaveEndedAt = Date.now();
        if (!saveAfterThisOne) return;
        saveAfterThisOne = false;
        requestSave();
      });
  };

  const onEvent = (event: MatrixEvent) => {
    // Synced events only: a local redaction still being sent has a status.
    if (event.isRedaction() && event.status === null) redactionSinceSave = true;
  };

  // The SDK reports SYNCING once it has processed a batch, just before it decides to save.
  const onSync = (state: SyncBatchState) => {
    if (state !== SyncState.Syncing) return;
    // The session's first batch and the first after five minutes are saved by the SDK, with
    // every batch before them.
    if (mx.store.wantsSave()) {
      redactionSinceSave = false;
      dropWaitingSave();
      // The SDK skips its save while one of these still writes, and then waits five minutes more,
      // so that batch is saved once this save is done.
      if (saving) saveAfterThisOne = true;
      return;
    }
    if (!redactionSinceSave) return;
    redactionSinceSave = false;
    requestSave();
  };

  mx.on(ClientEvent.Event, onEvent);
  mx.on(ClientEvent.Sync, onSync);
  return () => {
    stopped = true;
    dropWaitingSave();
    mx.removeListener(ClientEvent.Event, onEvent);
    mx.removeListener(ClientEvent.Sync, onSync);
  };
};
