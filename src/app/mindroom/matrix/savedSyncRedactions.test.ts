import { EventEmitter } from 'events';
import { ClientEvent, EventStatus, MatrixEvent, SyncState, type MatrixClient } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { keepRedactionsInSavedSync } from './savedSyncRedactions';

type Deferred = { resolve: () => void };

/** A client whose store saves only when asked to and reports whether it would save itself. */
const makeClient = ({ sdkWantsSave = false } = {}) => {
  const pending: Deferred[] = [];
  const store = {
    wantsSave: vi.fn(() => sdkWantsSave),
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
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
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

describe('keepRedactionsInSavedSync', () => {
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
    expect(store.save).toHaveBeenCalledTimes(2);
    await finishSaves();
    expect(store.save).toHaveBeenCalledTimes(2);
  });

  it('stops listening when stopped', () => {
    const { mx, emitter, store } = makeClient();
    const stop = keepRedactionsInSavedSync(mx);
    stop();

    batch(emitter, [synced('m.room.redaction', '$redaction')]);

    expect(store.save).not.toHaveBeenCalled();
    expect(emitter.listenerCount(ClientEvent.Event)).toBe(0);
    expect(emitter.listenerCount(ClientEvent.Sync)).toBe(0);
  });
});
