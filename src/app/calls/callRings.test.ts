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
import { recordRecentLiveEvents } from '../matrix/client/recentLiveEvents';
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

  /**
   * A started client that delivers events live from sync, before the watcher starts too (its
   * recorder keeps them), in rooms the user is in except `left`; decryption has already run on them.
   */
  const syncingClient = (left: string[] = []) => {
    const mx = Object.assign(new EventEmitter(), {
      getSafeUserId: () => ME,
      decryptEventIfNeeded: vi.fn(async () => undefined),
      getRoom: (roomId: string) => ({
        getMyMembership: () =>
          left.includes(roomId) ? KnownMembership.Leave : KnownMembership.Join,
      }),
    }) as unknown as MatrixClient & EventEmitter;
    recordRecentLiveEvents(mx);
    const deliver = async (event: MatrixEvent) => {
      mx.emit(RoomEvent.Timeline, event, undefined, false, false, { liveEvent: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    return { mx, deliver };
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
      isEncrypted: () => true,
      isDecryptionFailure: () => !clear,
      // Each attempt has ended when the test asks.
      isBeingDecrypted: () => false,
      shouldAttemptDecryption: () => false,
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

  it('rings for what sync delivered before it started: in order, in rooms the user is still in, over its last two minutes', async () => {
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
    const { mx, deliver } = syncingClient(['!c:example.org']);
    for (const event of [
      history,
      ringIn('!b:example.org', '$over', NOW - 30_000),
      ringIn('!a:example.org', '$declined', NOW),
      decline,
      ringIn('!b:example.org', '$older', NOW + 2000),
      ringIn('!a:example.org', '$newest', NOW + 5000),
      ringIn('!c:example.org', '$left', NOW + 6000),
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await deliver(event);
    }
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

  /** What `decryptEventIfNeeded` resolves only once the test calls the function it returns. */
  const decryptingUntil = (mx: MatrixClient, slow: MatrixEvent[]) => {
    const done = new Map<MatrixEvent, () => void>();
    vi.mocked(mx.decryptEventIfNeeded).mockImplementation((event) =>
      slow.includes(event)
        ? new Promise<void>((resolve) => {
            done.set(event, resolve);
          })
        : Promise.resolve()
    );
    return async (event: MatrixEvent) => {
      done.get(event)?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
  };

  it('rings for a ring sync delivered before it started once its late room key arrives', async () => {
    const late = undecrypted(ringIn('!a:example.org', '$late', Date.now()));
    const { mx, deliver } = syncingClient();
    await deliver(late.event);
    const onRing = vi.fn();
    const stop = watchRings(mx, { onRing, onDeclined: vi.fn() });
    await new Promise((resolve) => setTimeout(resolve, 0));
    late.keyArrives();

    expect(onRing).toHaveBeenCalledWith(expect.objectContaining({ eventId: '$late' }));
    stop();
  });

  it('drops a ring the catch-up reads after a newer ring has rung, and never rings a declined one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW + 10_000);
    // The SDK is still decrypting the oldest ring; two others wait for their room keys.
    const older = ringIn('!a:example.org', '$older', NOW);
    const newer = ringIn('!b:example.org', '$newer', NOW + 2000);
    const newestKeyLate = undecrypted(ringIn('!c:example.org', '$newestKeyLate', NOW + 2500));
    const declinedKeyLate = undecrypted(ringIn('!d:example.org', '$declinedKeyLate', NOW + 3000));
    const decline = new MatrixEvent({
      type: EventType.RTCDecline,
      room_id: '!d:example.org',
      event_id: '$decline',
      sender: ME,
      origin_server_ts: NOW + 4000,
      content: { 'm.relates_to': { rel_type: 'm.reference', event_id: '$declinedKeyLate' } },
    });
    const { mx, deliver } = syncingClient();
    const decrypted = decryptingUntil(mx, [older]);
    for (const event of [older, newer, newestKeyLate.event, declinedKeyLate.event, decline]) {
      // eslint-disable-next-line no-await-in-loop
      await deliver(event);
    }
    const heard: string[] = [];
    const stop = watchRings(mx, {
      onRing: (ring) => heard.push(`ring ${ring.eventId}`),
      onDeclined: (ringEventId) => heard.push(`declined ${ringEventId}`),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    declinedKeyLate.keyArrives();
    // Delivered before the caught-up ring that rang: it would replace that newer ring.
    await decrypted(older);
    await deliver(ringIn('!e:example.org', '$live', NOW + 10_000));
    // Newer than every caught-up ring, but read after a ring sync delivered live.
    newestKeyLate.keyArrives();

    expect(heard).toEqual(['ring $newer', 'declined $declinedKeyLate', 'ring $live']);
    stop();
  });

  it('rings for a ring sync delivers whose decryption ends after a newer ring, as before, unless declined meanwhile', async () => {
    const older = ringIn('!a:example.org', '$older', Date.now());
    const declined = ringIn('!b:example.org', '$declined', Date.now());
    const { mx, deliver } = syncingClient();
    const decrypted = decryptingUntil(mx, [older, declined]);
    const heard: string[] = [];
    const stop = watchRings(mx, {
      onRing: (ring) => heard.push(`ring ${ring.eventId}`),
      onDeclined: (ringEventId) => heard.push(`declined ${ringEventId}`),
    });

    await deliver(older);
    await deliver(declined);
    await deliver(ringIn('!c:example.org', '$newer', Date.now()));
    await deliver(
      new MatrixEvent({
        type: EventType.RTCDecline,
        room_id: '!b:example.org',
        event_id: '$decline',
        sender: ME,
        origin_server_ts: Date.now(),
        content: { 'm.relates_to': { rel_type: 'm.reference', event_id: '$declined' } },
      })
    );
    await decrypted(older);
    await decrypted(declined);

    expect(heard).toEqual(['ring $newer', 'declined $declined', 'ring $older']);
    stop();
  });

  it('reads each event once, whether sync delivered it before or after it started', async () => {
    const { mx, deliver } = syncingClient();
    await deliver(ringIn('!a:example.org', '$before', Date.now()));
    const heard: string[] = [];
    const stop = watchRings(mx, {
      onRing: (ring) => heard.push(ring.eventId),
      onDeclined: vi.fn(),
    });
    await deliver(ringIn('!b:example.org', '$after', Date.now()));

    expect(heard).toEqual(['$before', '$after']);
    stop();
  });
});
