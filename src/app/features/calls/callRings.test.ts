import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EventType,
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

  /** A client that delivers events live from sync; decryption has already run on them. */
  const syncingClient = () => {
    const mx = Object.assign(new EventEmitter(), {
      getSafeUserId: () => ME,
      decryptEventIfNeeded: vi.fn(async () => undefined),
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
});
