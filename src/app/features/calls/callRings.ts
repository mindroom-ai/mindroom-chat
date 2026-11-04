import { EventType, RelationType, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';

/** A ring this device has not answered yet. */
export type IncomingRing = {
  roomId: string;
  eventId: string;
  sender: string;
  video: boolean;
  expiresAt: number;
};

/** A notification ring lasts this long when it names no lifetime (MSC4075's default). */
const DEFAULT_RING_LIFETIME_MS = 30_000;
/** A ring that claims to last longer is cut to this, so a stuck ring cannot stay forever. */
const MAX_RING_LIFETIME_MS = 120_000;

/**
 * The ring an `org.matrix.msc4075.rtc.notification` event asks for, if it rings this account
 * now: sent by someone else, of type `ring`, mentioning the room or this account, and not
 * expired. The expiry counts from the sender's clock, capped by when the event was received.
 */
export const readRing = (
  event: MatrixEvent,
  myUserId: string,
  now = Date.now()
): IncomingRing | undefined => {
  if (event.getType() !== EventType.RTCNotification) return undefined;
  const sender = event.getSender();
  const roomId = event.getRoomId();
  const eventId = event.getId();
  if (!sender || sender === myUserId || !roomId || !eventId) return undefined;
  const content = event.getContent();
  if (content.notification_type !== 'ring') return undefined;
  const mentions = content['m.mentions'] as { room?: unknown; user_ids?: unknown } | undefined;
  const mentioned =
    mentions?.room === true ||
    (Array.isArray(mentions?.user_ids) && mentions.user_ids.includes(myUserId));
  if (!mentioned) return undefined;
  const lifetime =
    typeof content.lifetime === 'number' && content.lifetime > 0
      ? Math.min(content.lifetime, MAX_RING_LIFETIME_MS)
      : DEFAULT_RING_LIFETIME_MS;
  const sentAt = typeof content.sender_ts === 'number' ? content.sender_ts : event.getTs();
  const expiresAt = Math.min(sentAt, event.getTs()) + lifetime;
  if (expiresAt <= now) return undefined;
  return { roomId, eventId, sender, video: content['m.call.intent'] === 'video', expiresAt };
};

/** Says no to a ring (MSC4310), so the caller's other devices and clients stop ringing too. */
export const declineRing = (mx: MatrixClient, ring: IncomingRing) =>
  mx.sendEvent(
    ring.roomId,
    EventType.RTCDecline as never,
    {
      'm.relates_to': { rel_type: RelationType.Reference, event_id: ring.eventId },
    } as never
  );
