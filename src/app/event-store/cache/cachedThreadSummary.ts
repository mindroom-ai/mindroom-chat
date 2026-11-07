import type { IEvent } from 'matrix-js-sdk';
import { describeRawEventRevision, mergeRawEventRevisions } from '../../matrix/eventRevision';

// A root's thread summary (`unsigned['m.relations']['m.thread']`) is the server's word at the
// moment the page read the root. A thread list read while an agent streams keeps the reply's
// placeholder in it, and the page saves the root that way. The reply's later edits and the thread's
// title notice come through /sync and are saved with the thread's events, but nothing rewrites the
// saved root, so a reload restored the old summary: the card streamed again, and every such
// thread was checked with the server, until a whole thread list read replaced the roots. The
// restored root takes the newest events the cache holds for its thread instead.
//
// The server's MindRoom previews beside the summary (`io.mindroom.title` and
// `io.mindroom.latest_reply`) describe the summary it sent. Once the cache names a newer latest
// event they are out of date, possibly a reply's placeholder, and the rewritten summary drops them:
// the cache holds the newer events they would stand in for.
const SERVER_PREVIEWS = ['io.mindroom.title', 'io.mindroom.latest_reply'];

type RawEvent = Partial<IEvent>;
type ThreadSummary = { latest_event?: RawEvent; count?: number };

const summaryOf = (root: RawEvent): ThreadSummary | undefined => {
  const summary: unknown = root.unsigned?.['m.relations']?.['m.thread'];
  return summary && typeof summary === 'object' ? (summary as ThreadSummary) : undefined;
};

/** The event a root's thread summary names as the thread's newest. */
export const getSummaryLatestEvent = (root: RawEvent): RawEvent | undefined => {
  const latest = summaryOf(root)?.latest_event;
  return typeof latest?.event_id === 'string' ? latest : undefined;
};

/** Whether a cached event is older than the summary's newest event, so the walk can stop. */
export const isOlderThanSummary = (event: RawEvent, latest: RawEvent): boolean =>
  (event.origin_server_ts ?? 0) < (latest.origin_server_ts ?? 0);

/**
 * The root with a summary that names the newest of `replies`: the thread's cached replies, newest
 * first, down to the summary's newest event. A later reply becomes the newest event and adds to the
 * count; the summary's own newest event takes the newest edit any copy of it carries.
 */
export const withNewestCachedReplies = (root: RawEvent, replies: RawEvent[]): RawEvent => {
  const summary = summaryOf(root);
  const latest = getSummaryLatestEvent(root);
  if (!summary || !latest) return root;
  const latestTs = latest.origin_server_ts ?? 0;
  const later = replies.filter(
    (reply) => reply.event_id !== latest.event_id && (reply.origin_server_ts ?? 0) > latestTs
  );
  const sameReply = replies.find((reply) => reply.event_id === latest.event_id);
  const next = later[0] ?? (sameReply && mergeRawEventRevisions(latest, sameReply));
  if (!next) return root;
  const revision = (event: RawEvent) => {
    const { redacted, replacement } = describeRawEventRevision(event);
    return `${String(redacted)} ${replacement?.eventId ?? ''}`;
  };
  const newer = later.length > 0 || revision(next) !== revision(latest);
  const standard = newer
    ? Object.fromEntries(Object.entries(summary).filter(([key]) => !SERVER_PREVIEWS.includes(key)))
    : summary;
  return {
    ...root,
    unsigned: {
      ...root.unsigned,
      'm.relations': {
        ...root.unsigned?.['m.relations'],
        'm.thread': { ...standard, latest_event: next, count: (summary.count ?? 0) + later.length },
      },
    },
  };
};
