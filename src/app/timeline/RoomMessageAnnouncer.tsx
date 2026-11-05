import { CSSProperties, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  EventType,
  MatrixEvent,
  RelationType,
  RoomEvent,
  type IRoomTimelineData,
  type Room,
} from 'matrix-js-sdk';
import { createDecryptionWaits, isAwaitingDecryption } from '../matrix/decryptionWaits';
import { isMindroomAiRunStreaming } from '../matrix/protocol/aiRun';
import { isThreadListTimeline } from '../event-store/timeline/roomLiveEventArrive';
import { readCanvasNoticeTitle } from '../matrix/protocol/chatUiProtocol';
import { matchesEnum } from '../lib/matchesEnum';

/** Announcements kept in the log; screen readers read each one as it is added. */
const KEPT = 5;
/** Long messages are cut here; the reader can open the message for the rest. */
const MAX_BODY = 200;
/** Events this much older than the room view are history arriving late, not new messages. */
const STALE_MS = 10_000;
/** A message whose room key comes this long after it was sent is no longer read out. */
const KEY_WAIT_MS = 2 * 60_000;

const THREAD_SUMMARY_KEY = 'io.mindroom.thread_summary';

const VISUALLY_HIDDEN: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  border: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
};

type Content = Record<string, unknown>;

const replacedId = (event: MatrixEvent): string | undefined => {
  const relation = event.getWireContent()['m.relates_to'] as Content | undefined;
  return relation?.rel_type === RelationType.Replace && typeof relation.event_id === 'string'
    ? relation.event_id
    : undefined;
};

/** The text a message shows: its edit's new content, or its own. */
const shownContent = (event: MatrixEvent): Content => {
  const content = event.getContent<Content>();
  const replacement = content['m.new_content'];
  return replacement && typeof replacement === 'object' ? (replacement as Content) : content;
};

/**
 * One line of plain text, cut to a length a screen reader can read out. A canvas notice reads
 * as its title, which the timeline shows; its body only tells other clients to open this one.
 */
export const announcementBody = (content: Content): string | undefined => {
  const shown = readCanvasNoticeTitle(content) ?? content.body;
  if (typeof shown !== 'string') return undefined;
  const text = shown.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > MAX_BODY ? `${text.slice(0, MAX_BODY - 1).trimEnd()}…` : text;
};

type Scope = { myUserId: string; threadId: string | undefined; since: number };

/**
 * Whether `event` is a new message from someone else in the open room, or in the open thread
 * when one is open. Thread titles, edits and redactions are not new messages.
 */
const isAnnounceable = (event: MatrixEvent, { myUserId, threadId, since }: Scope) => {
  if (!matchesEnum(event.getType(), EventType.RoomMessage) || event.isRedacted()) return false;
  if (event.getSender() === myUserId || event.getTs() < since - STALE_MS) return false;
  if (event.getContent<Content>()[THREAD_SUMMARY_KEY] !== undefined) return false;
  if (!threadId) return true;
  return event.getId() === threadId || event.threadRootId === threadId;
};

type Announcement = { key: string; text: string };

/**
 * A hidden log that reads out each new message in the open room or thread, politely, after
 * whatever the screen reader is saying. An agent's reply that streams is read once, when its
 * final edit arrives, instead of at every edit.
 */
export function RoomMessageAnnouncer({
  room,
  threadId,
  myUserId,
}: {
  room: Room;
  threadId: string | undefined;
  myUserId: string;
}) {
  const { t } = useTranslation();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const translate = useRef(t);
  translate.current = t;

  useEffect(() => {
    setAnnouncements([]);
    const scope: Scope = { myUserId, threadId, since: Date.now() };
    const announced = new Set<string>();
    /** Streaming replies, by event ID, waiting for their final edit. */
    const streaming = new Map<string, MatrixEvent>();

    const announce = (event: MatrixEvent, content: Content) => {
      const id = event.getId();
      const body = announcementBody(content);
      if (!id || !body || announced.has(id)) return;
      announced.add(id);
      const sender = room.getMember(event.getSender() ?? '')?.name ?? event.getSender() ?? '';
      const text = translate.current('sharedUi.a11y.newMessage', { sender, body });
      setAnnouncements((previous) => [...previous, { key: id, text }].slice(-KEPT));
    };

    const consider = (event: MatrixEvent) => {
      const target = replacedId(event);
      if (target) {
        const original = streaming.get(target);
        if (!original || isMindroomAiRunStreaming(event.getContent<Content>())) return;
        streaming.delete(target);
        announce(original, shownContent(event));
        return;
      }
      if (!isAnnounceable(event, scope)) return;
      const id = event.getId();
      if (id && isMindroomAiRunStreaming(event.getContent<Content>())) {
        streaming.set(id, event);
        return;
      }
      announce(event, shownContent(event));
    };

    // A message still encrypted is read once a decryption works: the first attempt can fail and
    // the SDK tries again when the key comes, and an event can arrive already failed.
    const decryptions = createDecryptionWaits();

    const onTimeline = (
      event: MatrixEvent,
      _room: Room | undefined,
      toStartOfTimeline: boolean | undefined,
      _removed: boolean,
      data: IRoomTimelineData
    ) => {
      // A root that a thread list adds again is no new message.
      if (toStartOfTimeline || !data?.liveEvent || isThreadListTimeline(room, data.timeline))
        return;
      if (isAwaitingDecryption(event)) {
        decryptions.wait(event, KEY_WAIT_MS - (Date.now() - event.getTs()), () => consider(event));
        return;
      }
      consider(event);
    };

    room.on(RoomEvent.Timeline, onTimeline);
    return () => {
      room.removeListener(RoomEvent.Timeline, onTimeline);
      // A message that decrypts after the reader moved on belongs to the view they left.
      decryptions.stop();
    };
  }, [room, threadId, myUserId]);

  return (
    <div role="log" aria-live="polite" aria-relevant="additions" style={VISUALLY_HIDDEN}>
      {announcements.map(({ key, text }) => (
        <p key={key}>{text}</p>
      ))}
    </div>
  );
}
