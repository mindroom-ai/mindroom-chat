import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientEvent, createClient, MatrixEvent, SyncState } from 'matrix-js-sdk';
import { startClient, stopSavedSync } from './clientSyncPolicy';

const stateEvent = (eventId: string) =>
  new MatrixEvent({
    type: 'm.room.topic',
    event_id: eventId,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    state_key: '',
    origin_server_ts: 1,
    content: { topic: eventId },
  });

afterEach(() => vi.unstubAllGlobals());

describe('stopSavedSync', () => {
  // The page's listener reaches the client: while it stays, the page keeps a client it is done
  // with in memory, and saves that client's store once more.
  it("ends a started client's saves of its sync store, also the one a hidden page asks for", async () => {
    const page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('document', page);
    const listening = new Set<unknown>();
    vi.spyOn(page, 'addEventListener').mockImplementation((_type, listener) => {
      listening.add(listener);
    });
    vi.spyOn(page, 'removeEventListener').mockImplementation((_type, listener) => {
      listening.delete(listener);
    });
    const hide = () => {
      page.visibilityState = 'hidden';
      listening.forEach((listener) => (listener as () => void)());
    };
    const mx = createClient({ baseUrl: 'https://matrix.example', userId: '@me:example.org' });
    vi.spyOn(mx, 'startClient').mockResolvedValue();
    const save = vi.spyOn(mx.store, 'save').mockResolvedValue();
    /** One processed sync batch that changed a room's state. */
    const batch = (eventId: string) => {
      mx.emit(ClientEvent.Event, stateEvent(eventId));
      mx.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing);
    };
    await startClient(mx);
    expect(listening.size).toBe(1);

    batch('$first');
    expect(save).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      // A change after the first save has ended waits out a gap, which a hidden page cuts short.
      batch('$waiting');
      hide();
      expect(save).toHaveBeenCalledTimes(2);
    });
    await Promise.resolve();
    page.visibilityState = 'visible';
    batch('$still-waiting');

    stopSavedSync(mx);

    expect(listening.size).toBe(0);
    batch('$after');
    hide();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('does nothing for a client that never started', () => {
    const mx = createClient({ baseUrl: 'https://matrix.example', userId: '@me:example.org' });
    expect(() => stopSavedSync(mx)).not.toThrow();
  });
});
