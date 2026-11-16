import { Direction, type MatrixEvent } from 'matrix-js-sdk';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
import { getEditedEvent, getLatestMessageContent, reactionOrEditEvent } from '../../matrix/room';
import { getAiRunInfo } from '../../matrix/protocol/aiRun';
import { isMindroomAgentUserIdForViewer } from '../../matrix/protocol/agentIdentity';
import { hasLoadedFirstThreadPage } from '../sdk/threadBootstrapSdk';
import type { ThreadSummaryHistory } from './threadSummaryTimeline';

type ConversationCostTotal = {
  usd: number;
  /** Replies that carried a cost. */
  replyCount: number;
};

export type ThreadConversationCost = {
  /** Whether the thread's first event is loaded, so no older reply is missing from the sums. */
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
  events.forEach((event) => {
    const eventId = event.getId();
    const sender = event.getSender() ?? '';
    // Edits and reactions carry no cost of their own; a reply's latest edit is read through it.
    if (!eventId || reactionOrEditEvent(event) || event.isRedacted()) return;
    if (!isTrustedSender(sender) || ignoredUserIds?.has(sender)) return;
    const costUsd = getAiRunInfo(getContent(event))?.costUsd;
    if (costUsd === undefined) return;
    const replyMicros = Math.round(costUsd * MICROS_PER_USD);
    micros += replyMicros;
    replyCount += 1;
    replies.push({ eventId, usd: replyMicros / MICROS_PER_USD });
    byEventId.set(eventId, { usd: micros / MICROS_PER_USD, replyCount });
  });
  if (replyCount === 0) return undefined;
  return {
    complete: history.sdkLoaded && !history.canPaginateBack && !history.hasMoreCachedBack,
    byEventId,
    replies,
  };
};

/**
 * What the replies a thread holds cost, for a surface that shows the thread without opening it:
 * no page is loaded for it, so the sum is complete only when the SDK fetched the thread and holds
 * no older page. Only agents' cost counts.
 */
export const summarizeLoadedThreadCost = (
  thread: Thread,
  viewerId: string | undefined
): ThreadConversationCost | undefined => {
  const timeline = thread.liveTimeline;
  return summarizeThreadConversationCost(timeline.getEvents(), {
    history: {
      sdkLoaded: hasLoadedFirstThreadPage(thread),
      canPaginateBack: typeof timeline.getPaginationToken(Direction.Backward) === 'string',
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
