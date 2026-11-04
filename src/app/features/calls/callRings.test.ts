import { describe, expect, it, vi } from 'vitest';
import { EventType, MatrixEvent, type MatrixClient } from 'matrix-js-sdk';
import { declineRing, readRing } from './callRings';

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
