import { Direction, type MatrixEvent } from 'matrix-js-sdk';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
import { getEditedEvent, getLatestMessageContent, reactionOrEditEvent } from '../../matrix/room';
import { getAiRunInfo } from '../../matrix/protocol/aiRun';
import { isMindroomAgentUserIdForViewer } from '../../matrix/protocol/agentIdentity';
import { hasLoadedFirstThreadPage } from '../sdk/threadBootstrapSdk';
import { getLinkedTimelines, getThreadTimelineEvents } from '../timeline/linkedTimelines';
import type { ThreadSummaryHistory } from './threadSummaryTimeline';

type ConversationCostTotal = {
  usd: number;
  /** Replies that carried a cost. */
  replyCount: number;
};

export type ThreadConversationCost = {
  /**
   * Whether the sums are exact: the thread's first event is loaded, so no older reply is missing,
   * and no agent's run ended without a cost (stopped or failed), so none is left out.
   */
  complete: boolean;
  /** The conversation's cost through each priced reply. */
  byEventId: ReadonlyMap<string, ConversationCostTotal>;
  /** Each priced reply's own cost, in thread order. */
  replies: readonly { eventId: string; usd: number }[];
};

type SummarizeOptions = {
  history: ThreadSummaryHistory;
  /** Senders whose cost metadata counts; anyone else can write the same keys. */
  isTrustedSender: (userId: string) => boolean;
  /** The content an event's row shows, after its latest edit. */
  getContent?: (event: MatrixEvent) => Record<string, unknown>;
  ignoredUserIds?: ReadonlySet<string>;
};

// The backend rounds each cost to micro-dollars, so integer sums are exact.
const MICROS_PER_USD = 1_000_000;
// Runs that ended so: their usage can be unknown, and then the backend leaves the cost out. A
// completed run leaves it out only when it used no priced model, so it cost nothing.
const UNKNOWN_COST_ENDINGS = new Set(['cancelled', 'error']);

export const summarizeThreadConversationCost = (
  events: readonly MatrixEvent[],
  {
    history,
    isTrustedSender,
    getContent = (event) => event.getContent(),
    ignoredUserIds,
  }: SummarizeOptions
): ThreadConversationCost | undefined => {
  const byEventId = new Map<string, ConversationCostTotal>();
  const replies: { eventId: string; usd: number }[] = [];
  let micros = 0;
  let replyCount = 0;
  let unknownCost = false;
  events.forEach((event) => {
    const eventId = event.getId();
    const sender = event.getSender() ?? '';
    // Edits and reactions carry no cost of their own; a reply's latest edit is read through it.
    if (!eventId || reactionOrEditEvent(event) || event.isRedacted()) return;
    if (!isTrustedSender(sender) || ignoredUserIds?.has(sender)) return;
    const run = getAiRunInfo(getContent(event));
    const costUsd = run?.costUsd;
    if (costUsd === undefined) {
      if (run?.status && UNKNOWN_COST_ENDINGS.has(run.status)) unknownCost = true;
      return;
    }
    const replyMicros = Math.round(costUsd * MICROS_PER_USD);
    micros += replyMicros;
    replyCount += 1;
    replies.push({ eventId, usd: replyMicros / MICROS_PER_USD });
    byEventId.set(eventId, { usd: micros / MICROS_PER_USD, replyCount });
  });
  if (replyCount === 0) return undefined;
  return {
    complete:
      !unknownCost && history.sdkLoaded && !history.canPaginateBack && !history.hasMoreCachedBack,
    byEventId,
    replies,
  };
};

/**
 * What the replies a thread holds cost, for a surface that shows the thread without opening it.
 * It sums every linked segment the SDK holds. Without the open thread's session, the sum is
 * complete only when the oldest segment shows the SDK paged back to the start: it begins at the
 * root, which the SDK puts there only then, and holds no older page. Only agents' cost counts.
 */
export const summarizeLoadedThreadCost = (
  thread: Thread,
  viewerId: string | undefined
): ThreadConversationCost | undefined => {
  const oldest = getLinkedTimelines(thread.getUnfilteredTimelineSet().getLiveTimeline())[0];
  return summarizeThreadConversationCost(getThreadTimelineEvents(thread), {
    history: {
      sdkLoaded: hasLoadedFirstThreadPage(thread) && oldest?.getEvents()[0]?.getId() === thread.id,
      canPaginateBack: typeof oldest?.getPaginationToken(Direction.Backward) === 'string',
      hasMoreCachedBack: false,
    },
    isTrustedSender: (userId) => isMindroomAgentUserIdForViewer(userId, viewerId),
    getContent: (event) =>
      getLatestMessageContent(
        event,
        getEditedEvent(event.getId() ?? '', event, thread.timelineSet)
      ) as Record<string, unknown>,
  });
};
