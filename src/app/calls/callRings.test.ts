import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EventType,
  KnownMembership,
  MatrixEvent,
  MatrixEventEvent,
  RoomEvent,
  type MatrixClient,
} from 'matrix-js-sdk';
import { declineRing, declinedRingId, readRing, watchRings } from './callRings';

const ME = '@me:example.org';
const NOW = 1_000_000;

const notification = (content: Record<string, unknown>, sender = '@caller:example.org', ts = NOW) =>
  new MatrixEvent({
    type: EventType.RTCNotification,
    room_id: '!direct:example.org',
    event_id: '$ring',
    sender,
    origin_server_ts: ts,
    content: {
      notification_type: 'ring',
      'm.mentions': { user_ids: [], room: true },
      sender_ts: ts,
      lifetime: 30_000,
      ...content,
    },
  });

describe('readRing', () => {
  it('rings for a live ring that mentions the room or this account', () => {
    expect(readRing(notification({}), ME, NOW + 1000)).toEqual({
      roomId: '!direct:example.org',
      eventId: '$ring',
      sender: '@caller:example.org',
      video: false,
      expiresAt: NOW + 30_000,
    });
    const mentioned = notification({ 'm.mentions': { user_ids: [ME] }, 'm.call.intent': 'video' });
    expect(readRing(mentioned, ME, NOW)?.video).toBe(true);
  });

  it('stays quiet for notifications, own rings, rings for others and expired rings', () => {
    expect(readRing(notification({ notification_type: 'notification' }), ME, NOW)).toBeUndefined();
    expect(readRing(notification({}, ME), ME, NOW)).toBeUndefined();
    expect(
      readRing(notification({ 'm.mentions': { user_ids: ['@other:example.org'] } }), ME, NOW)
    ).toBeUndefined();
    expect(readRing(notification({}), ME, NOW + 30_000)).toBeUndefined();
  });

  it('counts the lifetime from the earlier of the two clocks and caps it', () => {
    const late = notification({ sender_ts: NOW + 600_000 });
    expect(readRing(late, ME, NOW)?.expiresAt).toBe(NOW + 30_000);
    const endless = notification({ lifetime: 86_400_000 });
    expect(readRing(endless, ME, NOW)?.expiresAt).toBe(NOW + 120_000);
  });
});

describe('declineRing', () => {
  it('sends an MSC4310 decline that references the ring', async () => {
    const sendEvent = vi.fn(async () => ({ event_id: '$decline' }));
    const mx = { sendEvent } as unknown as MatrixClient;
    await declineRing(mx, {
      roomId: '!direct:example.org',
      eventId: '$ring',
      sender: '@caller:example.org',
      video: false,
      expiresAt: NOW,
    });
    expect(sendEvent).toHaveBeenCalledWith(
      '!direct:example.org',
      'org.matrix.msc4310.rtc.decline',
      {
        'm.relates_to': { rel_type: 'm.reference', event_id: '$ring' },
      }
    );
  });
});

describe('declinedRingId', () => {
  const decline = (sender: string, relation: Record<string, unknown>) =>
    new MatrixEvent({
      type: EventType.RTCDecline,
      room_id: '!direct:example.org',
      event_id: '$decline',
      sender,
      content: { 'm.relates_to': relation },
    });

  it('names the ring this account declined on another device', () => {
    expect(declinedRingId(decline(ME, { rel_type: 'm.reference', event_id: '$ring' }), ME)).toBe(
      '$ring'
    );
  });

  it("ignores other people's declines and other events", () => {
    const relation = { rel_type: 'm.reference', event_id: '$ring' };
    expect(declinedRingId(decline('@caller:example.org', relation), ME)).toBeUndefined();
    expect(declinedRingId(decline(ME, { event_id: '$ring' }), ME)).toBeUndefined();
    expect(declinedRingId(notification({}, ME), ME)).toBeUndefined();
  });
});

describe('watchRings', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A room as the client holds it: what its live timeline has, and whether the user is in it. */
  type HeldRoom = { events: MatrixEvent[]; membership?: KnownMembership };

  /**
   * A client that delivers events live from sync, and holds `rooms` with what sync delivered
   * before; decryption has already run on them.
   */
  const syncingClient = (rooms: HeldRoom[] = []) => {
    const mx = Object.assign(new EventEmitter(), {
      getSafeUserId: () => ME,
      decryptEventIfNeeded: vi.fn(async () => undefined),
      getRooms: () =>
        rooms.map(({ events, membership = KnownMembership.Join }) => ({
          getMyMembership: () => membership,
          getLiveTimeline: () => ({ getEvents: () => events }),
        })),
    });
    const deliver = async (event: MatrixEvent) => {
      mx.emit(RoomEvent.Timeline, event, undefined, false, false, { liveEvent: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    return { mx: mx as unknown as MatrixClient & EventEmitter, deliver };
  };

  /** An encrypted event the SDK could not decrypt yet, until its room key arrives. */
  const undecrypted = (clearEvent: MatrixEvent) => {
    let clear = false;
    const event = Object.assign(new EventEmitter(), {
      getType: () => (clear ? clearEvent.getType() : EventType.RoomMessageEncrypted),
      getContent: () => (clear ? clearEvent.getContent() : {}),
      getSender: () => clearEvent.getSender(),
      getRoomId: () => clearEvent.getRoomId(),
      getId: () => clearEvent.getId(),
      getTs: () => clearEvent.getTs(),
      isDecryptionFailure: () => !clear,
      // Each attempt has ended when the test asks.
      isBeingDecrypted: () => false,
    });
    return {
      event: event as unknown as MatrixEvent & EventEmitter,
      failAgain: () => event.emit(MatrixEventEvent.Decrypted, event),
      keyArrives: () => {
        clear = true;
        event.emit(MatrixEventEvent.Decrypted, event);
      },
    };
  };

  it('rings for an encrypted ring once its late room key arrives', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW + 1000);
    const { mx, deliver } = syncingClient();
    const onRing = vi.fn();
    const stop = watchRings(mx, { onRing, onDeclined: vi.fn() });
    const ring = undecrypted(notification({}));

    await deliver(ring.event);
    expect(onRing).not.toHaveBeenCalled();
    // A key request that fails once more keeps the wait going.
    ring.failAgain();
    expect(onRing).not.toHaveBeenCalled();
    ring.keyArrives();

    expect(onRing).toHaveBeenCalledWith(expect.objectContaining({ eventId: '$ring' }));
    expect(ring.event.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
    stop();
  });

  it('stops ringing for a decline from another device whose key came late', async () => {
    const { mx, deliver } = syncingClient();
    const onDeclined = vi.fn();
    const stop = watchRings(mx, { onRing: vi.fn(), onDeclined });
    const decline = undecrypted(
      new MatrixEvent({
        type: EventType.RTCDecline,
        room_id: '!direct:example.org',
        event_id: '$decline',
        sender: ME,
        origin_server_ts: Date.now(),
        content: { 'm.relates_to': { rel_type: 'm.reference', event_id: '$ring' } },
      })
    );

    await deliver(decline.event);
    decline.keyArrives();

    expect(onDeclined).toHaveBeenCalledWith('$ring');
    stop();
  });

  it('gives up waiting once no ring sent then could still ring, and when stopped', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
    const { mx } = syncingClient();
    const stop = watchRings(mx, { onRing: vi.fn(), onDeclined: vi.fn() });
    const late = undecrypted(notification({}));
    const pendingAtStop = undecrypted(notification({}));

    mx.emit(RoomEvent.Timeline, late.event, undefined, false, false, { liveEvent: true });
    mx.emit(RoomEvent.Timeline, pendingAtStop.event, undefined, false, false, { liveEvent: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(late.event.listenerCount(MatrixEventEvent.Decrypted)).toBe(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(late.event.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);

    const fresh = undecrypted(notification({}, '@caller:example.org', NOW + 120_000));
    mx.emit(RoomEvent.Timeline, fresh.event, undefined, false, false, { liveEvent: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(fresh.event.listenerCount(MatrixEventEvent.Decrypted)).toBe(1);
    stop();
    expect(fresh.event.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
    expect(mx.listenerCount(RoomEvent.Timeline)).toBe(0);
  });

  it('rings at once for a ring that arrives readable, and ignores history', async () => {
    const { mx, deliver } = syncingClient();
    const onRing = vi.fn();
    const stop = watchRings(mx, { onRing, onDeclined: vi.fn() });
    const ring = notification({}, '@caller:example.org', Date.now());

    mx.emit(RoomEvent.Timeline, ring, undefined, true, false, { liveEvent: false });
    await deliver(
      notification({ notification_type: 'notification' }, '@caller:example.org', Date.now())
    );
    expect(onRing).not.toHaveBeenCalled();
    await deliver(ring);

    expect(onRing).toHaveBeenCalledTimes(1);
    stop();
  });

  /** A ring from the caller in `roomId`, sent at `ts`. */
  const ringIn = (roomId: string, eventId: string, ts: number) =>
    new MatrixEvent({
      ...notification({}, '@caller:example.org', ts).event,
      room_id: roomId,
      event_id: eventId,
    });

  it('rings for what sync delivered before it started: oldest first, in rooms the user is in, over its last two minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW + 10_000);
    const decline = new MatrixEvent({
      type: EventType.RTCDecline,
      room_id: '!a:example.org',
      event_id: '$decline',
      sender: ME,
      origin_server_ts: NOW + 1000,
      content: { 'm.relates_to': { rel_type: 'm.reference', event_id: '$declined' } },
    });
    // Older than any ring could last: not even decrypted.
    const history = ringIn('!a:example.org', '$history', NOW - 110_001);
    const { mx } = syncingClient([
      {
        events: [
          history,
          ringIn('!a:example.org', '$declined', NOW),
          decline,
          ringIn('!a:example.org', '$newest', NOW + 5000),
        ],
      },
      {
        events: [
          ringIn('!b:example.org', '$over', NOW - 30_000),
          ringIn('!b:example.org', '$older', NOW + 2000),
        ],
      },
      {
        events: [ringIn('!c:example.org', '$left', NOW + 6000)],
        membership: KnownMembership.Leave,
      },
    ]);
    const heard: string[] = [];
    const stop = watchRings(mx, {
      onRing: (ring) => heard.push(`ring ${ring.eventId}`),
      onDeclined: (ringEventId) => heard.push(`declined ${ringEventId}`),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The decline follows the ring it says no to, and the newest ring comes last, so it shows.
    expect(heard).toEqual(['ring $declined', 'declined $declined', 'ring $older', 'ring $newest']);
    expect(mx.decryptEventIfNeeded).not.toHaveBeenCalledWith(history);
    expect(mx.decryptEventIfNeeded).toHaveBeenCalledTimes(5);
    stop();
  });

  it('reads an event once: what sync delivers after it started is not read again', async () => {
    const events: MatrixEvent[] = [];
    const { mx, deliver } = syncingClient([{ events }]);
    const onRing = vi.fn();
    const stop = watchRings(mx, { onRing, onDeclined: vi.fn() });
    const ring = ringIn('!a:example.org', '$ring', Date.now());

    // The SDK adds an event to the timeline and announces it in one step.
    events.push(ring);
    await deliver(ring);

    expect(onRing).toHaveBeenCalledTimes(1);
    stop();
  });
});
