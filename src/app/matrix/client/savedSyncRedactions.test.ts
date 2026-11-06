import { EventEmitter } from 'events';
import {
  ClientEvent,
  EventStatus,
  MatrixEvent,
  RoomEvent,
  SyncState,
  type MatrixClient,
} from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHANGE_SAVE_GAP_MS,
  keepRedactionsInSavedSync,
  REDACTION_SAVE_GAP_MS,
} from './savedSyncRedactions';

type Deferred = { resolve: () => void };

/** A client whose store saves only when asked to and reports whether it would save itself. */
const makeClient = ({ sdkWantsSave = false } = {}) => {
  const pending: Deferred[] = [];
  const store = {
    wantsSave: vi.fn<() => boolean>(() => sdkWantsSave),
    save: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          pending.push({ resolve });
        })
    ),
  };
  const emitter = new EventEmitter();
  const mx = Object.assign(emitter, { store }) as unknown as MatrixClient;
  const finishSaves = async () => {
    pending.splice(0).forEach(({ resolve }) => resolve());
    // Let the save's settle handlers run.
    await vi.advanceTimersByTimeAsync(0);
  };
  return { mx, emitter, store, finishSaves };
};

const synced = (type: string, eventId: string): MatrixEvent =>
  new MatrixEvent({
    type,
    event_id: eventId,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    origin_server_ts: 1,
    content: type === 'm.room.redaction' ? { redacts: '$reply' } : { body: 'hi' },
    ...(type === 'm.room.redaction' ? { redacts: '$reply' } : {}),
  });

/** One processed sync batch: its events, then the SDK's PREPARED or SYNCING report. */
const batch = (emitter: EventEmitter, events: MatrixEvent[], state = SyncState.Syncing) => {
  events.forEach((event) => emitter.emit(ClientEvent.Event, event));
  emitter.emit(ClientEvent.Sync, state, SyncState.Syncing);
};

/** Lets the gap after the last save pass. */
const waitForGap = () => vi.advanceTimersByTimeAsync(REDACTION_SAVE_GAP_MS);

describe('keepRedactionsInSavedSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves the sync store after a batch that brought a redaction', () => {
    const { mx, emitter, store } = makeClient();
    keepRedactionsInSavedSync(mx);

    batch(emitter, [synced('m.room.message', '$reply')]);
    expect(store.save).not.toHaveBeenCalled();

    batch(emitter, [synced('m.room.redaction', '$redaction')]);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledWith(true);

    batch(emitter, [synced('m.room.message', '$later')]);
    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it('leaves the save to the SDK when it saves the batch itself', () => {
    const { mx, emitter, store } = makeClient({ sdkWantsSave: true });
    keepRedactionsInSavedSync(mx);

    batch(emitter, [synced('m.room.redaction', '$redaction')]);

    expect(store.save).not.toHaveBeenCalled();
  });

  it('waits for SYNCING: the saved sync replayed at startup only reports PREPARED', () => {
    const { mx, emitter, store } = makeClient();
    keepRedactionsInSavedSync(mx);

    batch(emitter, [synced('m.room.redaction', '$old-redaction')], SyncState.Prepared);
    expect(store.save).not.toHaveBeenCalled();

    // The first live batch: the SDK would save it, so nothing more happens.
    store.wantsSave.mockReturnValueOnce(true);
    batch(emitter, []);
    expect(store.save).not.toHaveBeenCalled();
    batch(emitter, []);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('ignores a local redaction that is still being sent', () => {
    const { mx, emitter, store } = makeClient();
    keepRedactionsInSavedSync(mx);
    const local = synced('m.room.redaction', '~local');
    local.setStatus(EventStatus.SENDING);

    batch(emitter, [local]);

    expect(store.save).not.toHaveBeenCalled();
  });

  it('saves once more after a save that was still running when the next redaction came', async () => {
    const { mx, emitter, store, finishSaves } = makeClient();
    keepRedactionsInSavedSync(mx);

    batch(emitter, [synced('m.room.redaction', '$first')]);
    batch(emitter, [synced('m.room.redaction', '$second')]);
    batch(emitter, [synced('m.room.redaction', '$third')]);
    expect(store.save).toHaveBeenCalledTimes(1);

    await finishSaves();
    await waitForGap();
    expect(store.save).toHaveBeenCalledTimes(2);
    await finishSaves();
    await waitForGap();
    expect(store.save).toHaveBeenCalledTimes(2);
  });

  it('gives a burst of redactions one more save after a gap, not one save each', async () => {
    const { mx, emitter, store, finishSaves } = makeClient();
    keepRedactionsInSavedSync(mx);

    batch(emitter, [synced('m.room.redaction', '$first')]);
    expect(store.save).toHaveBeenCalledTimes(1);
    await finishSaves();

    batch(emitter, [synced('m.room.redaction', '$second')]);
    await vi.advanceTimersByTimeAsync(REDACTION_SAVE_GAP_MS / 2);
    batch(emitter, [synced('m.room.redaction', '$third')]);
    expect(store.save).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(REDACTION_SAVE_GAP_MS / 2);
    expect(store.save).toHaveBeenCalledTimes(2);
    await finishSaves();
    await waitForGap();
    expect(store.save).toHaveBeenCalledTimes(2);
  });

  it('drops a save still waiting for its gap when the SDK saves a later batch itself', async () => {
    const { mx, emitter, store, finishSaves } = makeClient();
    keepRedactionsInSavedSync(mx);
    batch(emitter, [synced('m.room.redaction', '$first')]);
    await finishSaves();

    batch(emitter, [synced('m.room.redaction', '$second')]);
    // The SDK's five minutes end with the next batch, which it saves with the redaction in it.
    store.wantsSave.mockReturnValueOnce(true);
    batch(emitter, []);
    await waitForGap();

    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it('saves again when the SDK wanted to save while this save was still writing', async () => {
    const { mx, emitter, store, finishSaves } = makeClient();
    keepRedactionsInSavedSync(mx);
    batch(emitter, [synced('m.room.redaction', '$redaction')]);
    expect(store.save).toHaveBeenCalledTimes(1);

    // The SDK skips its own save while this one writes, and would wait five minutes more.
    store.wantsSave.mockReturnValueOnce(true);
    batch(emitter, [synced('m.room.message', '$skipped-by-the-sdk')]);
    await finishSaves();
    await waitForGap();

    expect(store.save).toHaveBeenCalledTimes(2);
  });

  it('stops listening when stopped, and drops a save still waiting', async () => {
    const { mx, emitter, store, finishSaves } = makeClient();
    const stop = keepRedactionsInSavedSync(mx);
    batch(emitter, [synced('m.room.redaction', '$first')]);
    await finishSaves();
    batch(emitter, [synced('m.room.redaction', '$waiting')]);
    stop();

    batch(emitter, [synced('m.room.redaction', '$redaction')]);
    await waitForGap();

    expect(store.save).toHaveBeenCalledTimes(1);
    expect(emitter.listenerCount(ClientEvent.Event)).toBe(0);
    expect(emitter.listenerCount(ClientEvent.Sync)).toBe(0);
  });

  const stateEvent = (eventId: string) =>
    new MatrixEvent({
      type: 'm.room.member',
      event_id: eventId,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      state_key: '@alice:example.org',
      origin_server_ts: 1,
      content: { membership: 'join', displayname: 'Alice Renamed' },
    });
  const accountData = (type: string) => new MatrixEvent({ type, content: {} });

  it('saves a batch that changed room state, and keeps later changes for one save after a gap', async () => {
    const { mx, emitter, store, finishSaves } = makeClient();
    keepRedactionsInSavedSync(mx);

    batch(emitter, [stateEvent('$rename')]);
    expect(store.save).toHaveBeenCalledTimes(1);
    await finishSaves();

    batch(emitter, [stateEvent('$avatar')]);
    batch(emitter, [stateEvent('$topic')]);
    await vi.advanceTimersByTimeAsync(CHANGE_SAVE_GAP_MS - 1);
    expect(store.save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.save).toHaveBeenCalledTimes(2);
  });

  it('saves account settings, but not a moved read marker', async () => {
    const { mx, emitter, store, finishSaves } = makeClient();
    keepRedactionsInSavedSync(mx);

    emitter.emit(RoomEvent.AccountData, accountData('m.fully_read'));
    batch(emitter, []);
    expect(store.save).not.toHaveBeenCalled();

    emitter.emit(ClientEvent.AccountData, accountData('io.mindroom.client.settings'));
    batch(emitter, []);
    expect(store.save).toHaveBeenCalledTimes(1);
    await finishSaves();

    emitter.emit(RoomEvent.AccountData, accountData('m.tag'));
    batch(emitter, []);
    await vi.advanceTimersByTimeAsync(CHANGE_SAVE_GAP_MS);
    expect(store.save).toHaveBeenCalledTimes(2);
  });

  it('lets a redaction cut short the wait of other changes', async () => {
    const { mx, emitter, store, finishSaves } = makeClient();
    keepRedactionsInSavedSync(mx);
    batch(emitter, [stateEvent('$first')]);
    await finishSaves();

    batch(emitter, [stateEvent('$second')]);
    batch(emitter, [synced('m.room.redaction', '$redaction')]);
    await waitForGap();
    expect(store.save).toHaveBeenCalledTimes(2);
  });

  it('saves a waiting change at once when the page is hidden', async () => {
    const page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('document', page);
    try {
      const { mx, emitter, store, finishSaves } = makeClient();
      const stop = keepRedactionsInSavedSync(mx);
      batch(emitter, [stateEvent('$first')]);
      await finishSaves();
      batch(emitter, [stateEvent('$second')]);
      expect(store.save).toHaveBeenCalledTimes(1);

      page.visibilityState = 'hidden';
      page.dispatchEvent(new Event('visibilitychange'));
      expect(store.save).toHaveBeenCalledTimes(2);
      stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
