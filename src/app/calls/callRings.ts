import {
  EventType,
  KnownMembership,
  RelationType,
  RoomEvent,
  type MatrixClient,
  type MatrixEvent,
  type RoomEventHandlerMap,
} from 'matrix-js-sdk';
import { createDecryptionWaits } from '../matrix/decryptionWaits';
import { matchesEnum } from '../lib/matchesEnum';

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
 * Whether `event` is a call's ring (`org.matrix.msc4075.rtc.notification` of type `ring`), and
 * for a voice or a video call; undefined for any other event. It says nothing of whom it rings.
 */
export const readRingKind = (event: MatrixEvent): 'voice' | 'video' | undefined => {
  if (!matchesEnum(event.getType(), EventType.RTCNotification)) return undefined;
  const content = event.getContent();
  if (content.notification_type !== 'ring') return undefined;
  return content['m.call.intent'] === 'video' ? 'video' : 'voice';
};

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
  const kind = readRingKind(event);
  if (!kind) return undefined;
  const sender = event.getSender();
  const roomId = event.getRoomId();
  const eventId = event.getId();
  if (!sender || sender === myUserId || !roomId || !eventId) return undefined;
  const content = event.getContent();
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
  return { roomId, eventId, sender, video: kind === 'video', expiresAt };
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

/**
 * The ring an `org.matrix.msc4310.rtc.decline` event says no to, when this account sent it (from
 * any of its devices), so every device stops ringing.
 */
export const declinedRingId = (event: MatrixEvent, myUserId: string): string | undefined => {
  if (!matchesEnum(event.getType(), EventType.RTCDecline) || event.getSender() !== myUserId)
    return undefined;
  const relation = event.getContent()['m.relates_to'] as
    | { rel_type?: unknown; event_id?: unknown }
    | undefined;
  if (relation?.rel_type !== RelationType.Reference) return undefined;
  return typeof relation.event_id === 'string' ? relation.event_id : undefined;
};

/** What a {@link watchRings} caller hears about. */
export type RingWatcher = {
  onRing: (ring: IncomingRing) => void;
  /** This account said no to the ring with this event ID, on this device or another. */
  onDeclined: (ringEventId: string) => void;
};

/**
 * Follows the rings and declines that sync delivers to this account, starting with those it
 * delivered in the last {@link MAX_RING_LIFETIME_MS} before this started. An encrypted one whose
 * room key comes late (to-device lag, a forwarded or backed-up key) is read when the SDK decrypts it
 * again: a failed attempt announces itself as decrypted too, so the wait lasts until an attempt
 * works or no ring sent then could still be ringing. Returns what stops following.
 */
export const watchRings = (mx: MatrixClient, watcher: RingWatcher): (() => void) => {
  const myUserId = mx.getSafeUserId();
  let stopped = false;
  const decryptions = createDecryptionWaits();
  // Events are read in the order they reach this, but one whose room key comes late is read later:
  // such a ring never replaces a ring that reached this after it, nor rings after its decline.
  let reached = 0;
  let newestRing = 0;
  const declinedRings = new Set<string>();

  const read = (event: MatrixEvent, order: number) => {
    const declined = declinedRingId(event, myUserId);
    if (declined) {
      declinedRings.add(declined);
      watcher.onDeclined(declined);
      return;
    }
    const ring = readRing(event, myUserId);
    if (!ring || order < newestRing || declinedRings.has(ring.eventId)) return;
    newestRing = order;
    watcher.onRing(ring);
  };

  const consider = async (event: MatrixEvent) => {
    reached += 1;
    const order = reached;
    await mx.decryptEventIfNeeded(event).catch(() => undefined);
    if (stopped) return;
    if (!event.isDecryptionFailure()) {
      read(event, order);
      return;
    }
    const left = MAX_RING_LIFETIME_MS - (Date.now() - event.getTs());
    decryptions.wait(event, left, () => read(event, order));
  };

  const onTimeline: RoomEventHandlerMap[RoomEvent.Timeline] = (event, _room, older, gone, at) => {
    // Back-pagination and removals are history; only what the sync just delivered rings.
    if (older || gone || at?.liveEvent !== true) return;
    consider(event).catch(() => undefined);
  };
  mx.on(RoomEvent.Timeline, onTimeline);
  // Sync may have delivered rings before this started, while the app's pages still loaded: the
  // recent events of the rooms the user is in are read too, oldest first, so a decline follows
  // the ring it says no to and the newest ring shows. The SDK announces each event as it adds it,
  // so none of these reaches the listener again.
  const recent = Date.now() - MAX_RING_LIFETIME_MS;
  mx.getRooms()
    .filter((room) => matchesEnum(room.getMyMembership(), KnownMembership.Join))
    .flatMap((room) => room.getLiveTimeline().getEvents())
    .filter((event) => event.getTs() > recent)
    .sort((a, b) => a.getTs() - b.getTs())
    .forEach((event) => {
      consider(event).catch(() => undefined);
    });
  return () => {
    stopped = true;
    decryptions.stop();
    mx.off(RoomEvent.Timeline, onTimeline);
  };
};
