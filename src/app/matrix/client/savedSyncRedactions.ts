import {
  ClientEvent,
  RoomEvent,
  SyncState,
  type MatrixClient,
  type MatrixEvent,
} from 'matrix-js-sdk';

// The SDK saves its sync store after the first sync of a session and then at most every five
// minutes. A reload or an offline start in between replays the saved sync, so what changed since
// the last save was undone until the next sync brought it again (offline: until the client was
// online again): a message deleted since then came back with its text, and a new display name,
// avatar, room state or account setting (such as hiding membership changes) went back to its
// older value. This module saves the store after a sync batch that brought such a change.
//
// Each save writes the whole sync accumulator, every room of the account. A lone redaction (an
// agent withdrawing its draft) is saved at once, and redactions that come in a burst (a moderator
// removing several messages) then share one more save, REDACTION_SAVE_GAP_MS after the last one
// ended. Other changes wait CHANGE_SAVE_GAP_MS after the last save, so busy rooms do not save
// with every batch; a page about to be hidden saves what is waiting at once. A batch the SDK
// saves itself holds everything before it, so a save still waiting is dropped then.

/** The least time between the end of one save and the start of the next, for a redaction. */
export const REDACTION_SAVE_GAP_MS = 2_000;
/** The same for other changes: state events and account data. */
export const CHANGE_SAVE_GAP_MS = 10_000;

// The read marker moves with every room read and is kept by the server; it alone saves nothing.
const UNSAVED_ROOM_ACCOUNT_DATA = new Set(['m.fully_read']);

type SyncBatchState = SyncState | null;

/**
 * Saves the client's sync store after sync batches that brought a redaction, a state event or
 * account data, unless the SDK saves such a batch itself; call it before the client starts.
 * Returns a function that stops it.
 */
export const keepRedactionsInSavedSync = (mx: MatrixClient): (() => void) => {
  let redactionSinceSave = false;
  let changeSinceSave = false;
  let saving = false;
  // The gap of a save requested while another one was still writing.
  let gapAfterThisOne: number | undefined;
  let lastSaveEndedAt = Number.NEGATIVE_INFINITY;
  let waiting: ReturnType<typeof setTimeout> | undefined;
  let waitingUntil = Number.POSITIVE_INFINITY;
  let stopped = false;

  const dropWaitingSave = () => {
    if (waiting === undefined) return;
    clearTimeout(waiting);
    waiting = undefined;
    waitingUntil = Number.POSITIVE_INFINITY;
  };

  const requestSave = (gap: number) => {
    if (stopped) return;
    if (saving) {
      // The store changed while this save read it; save once more afterwards.
      gapAfterThisOne = Math.min(gapAfterThisOne ?? gap, gap);
      return;
    }
    const due = lastSaveEndedAt + gap;
    const wait = due - Date.now();
    if (wait > 0) {
      if (due >= waitingUntil) return;
      dropWaitingSave();
      waitingUntil = due;
      waiting = setTimeout(() => {
        waiting = undefined;
        waitingUntil = Number.POSITIVE_INFINITY;
        requestSave(0);
      }, wait);
      return;
    }
    dropWaitingSave();
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
        if (gapAfterThisOne === undefined) return;
        const gap = gapAfterThisOne;
        gapAfterThisOne = undefined;
        requestSave(gap);
      });
  };

  const onEvent = (event: MatrixEvent) => {
    // Synced events only: a local event still being sent has a status.
    if (event.status !== null) return;
    if (event.isRedaction()) redactionSinceSave = true;
    else if (event.isState()) changeSinceSave = true;
  };

  const onAccountData = () => {
    changeSinceSave = true;
  };

  const onRoomAccountData = (event: MatrixEvent) => {
    if (!UNSAVED_ROOM_ACCOUNT_DATA.has(event.getType())) changeSinceSave = true;
  };

  // The SDK reports SYNCING once it has processed a batch, just before it decides to save.
  const onSync = (state: SyncBatchState) => {
    if (state !== SyncState.Syncing) return;
    // The session's first batch and the first after five minutes are saved by the SDK, with
    // every batch before them.
    if (mx.store.wantsSave()) {
      redactionSinceSave = false;
      changeSinceSave = false;
      dropWaitingSave();
      // The SDK skips its save while one of these still writes, and then waits five minutes more,
      // so that batch is saved once this save is done.
      if (saving) gapAfterThisOne = REDACTION_SAVE_GAP_MS;
      return;
    }
    if (redactionSinceSave) requestSave(REDACTION_SAVE_GAP_MS);
    else if (changeSinceSave) requestSave(CHANGE_SAVE_GAP_MS);
    redactionSinceSave = false;
    changeSinceSave = false;
  };

  // A hidden page may be closed or frozen before its gap ends.
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden' && waiting !== undefined) requestSave(0);
  };

  mx.on(ClientEvent.Event, onEvent);
  mx.on(ClientEvent.AccountData, onAccountData);
  mx.on(RoomEvent.AccountData, onRoomAccountData);
  mx.on(ClientEvent.Sync, onSync);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  return () => {
    stopped = true;
    dropWaitingSave();
    mx.removeListener(ClientEvent.Event, onEvent);
    mx.removeListener(ClientEvent.AccountData, onAccountData);
    mx.removeListener(RoomEvent.AccountData, onRoomAccountData);
    mx.removeListener(ClientEvent.Sync, onSync);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };
};
