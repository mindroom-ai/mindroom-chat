import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, EventType, MatrixEvent, RoomEvent, type MatrixClient } from 'matrix-js-sdk';
import { startClient } from './clientSyncPolicy';
import {
  RECENT_LIVE_EVENTS_MS,
  recordRecentLiveEvents,
  takeRecentLiveEvents,
} from './recentLiveEvents';

const NOW = 1_000_000;

const event = (type: string, eventId: string, ts = NOW, content: object = {}) =>
  new MatrixEvent({
    type,
    room_id: '!room:example.org',
    event_id: eventId,
    sender: '@caller:example.org',
    origin_server_ts: ts,
    content,
  });

/** A client whose sync announces `delivered` events: live, as history, removed, or from cache. */
const syncingClient = () => {
  const mx = new EventEmitter() as unknown as MatrixClient & EventEmitter;
  const announce = (delivered: MatrixEvent, older = false, gone = false, liveEvent = true) => {
    mx.emit(RoomEvent.Timeline, delivered, undefined, older, gone, { liveEvent });
  };
  return { mx, announce };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('recordRecentLiveEvents', () => {
  it('keeps the rings, declines and still unreadable events sync announces live, for two minutes, in order', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const { mx, announce } = syncingClient();
    recordRecentLiveEvents(mx);
    const old = event(EventType.RTCNotification, '$old', NOW - 1000);
    const ring = event(EventType.RTCNotification, '$ring');
    const decline = event(EventType.RTCDecline, '$decline');
    const unreadable = event(EventType.RoomMessageEncrypted, '$unreadable', NOW, {
      algorithm: 'm.megolm.v1.aes-sha2',
      ciphertext: 'secret',
    });

    announce(old);
    announce(ring);
    announce(event(EventType.RoomMessage, '$message', NOW, { body: 'hi' }));
    announce(event(EventType.RTCNotification, '$history'), true);
    announce(event(EventType.RTCNotification, '$removed'), false, true);
    announce(event(EventType.RTCNotification, '$saved'), false, false, false);
    announce(decline);
    announce(unreadable);
    vi.setSystemTime(NOW - 1000 + RECENT_LIVE_EVENTS_MS);

    expect(takeRecentLiveEvents(mx)).toEqual([ring, decline, unreadable]);
  });

  it('hands its events over once, then stops, and keeps each client apart', () => {
    const first = syncingClient();
    const second = syncingClient();
    recordRecentLiveEvents(first.mx);
    recordRecentLiveEvents(second.mx);
    const ring = event(EventType.RTCNotification, '$ring', Date.now());
    first.announce(ring);

    expect(takeRecentLiveEvents(second.mx)).toEqual([]);
    expect(takeRecentLiveEvents(first.mx)).toEqual([ring]);
    first.announce(event(EventType.RTCNotification, '$later', Date.now()));
    expect(takeRecentLiveEvents(first.mx)).toEqual([]);
    expect(first.mx.listenerCount(RoomEvent.Timeline)).toBe(0);
    expect(takeRecentLiveEvents(syncingClient().mx)).toEqual([]);
  });

  it('starts with the client, before its first sync', async () => {
    const mx = createClient({ baseUrl: 'https://matrix.example', userId: '@me:example.org' });
    const ring = event(EventType.RTCNotification, '$ring', Date.now());
    // The SDK's first sync delivers the ring.
    vi.spyOn(mx, 'startClient').mockImplementation(async () => {
      (mx as unknown as EventEmitter).emit(RoomEvent.Timeline, ring, undefined, false, false, {
        liveEvent: true,
      });
    });
    await startClient(mx);

    expect(takeRecentLiveEvents(mx)).toEqual([ring]);
    mx.stopClient();
  });
});
