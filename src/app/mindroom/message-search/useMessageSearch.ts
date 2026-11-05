import { useInfiniteQuery } from '@tanstack/react-query';
import {
  type IEventWithRoomId,
  type IResultContext,
  type ISearchRequestBody,
  type ISearchResult,
  RelationType,
  SearchOrderBy,
} from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';

/** One server search hit with the messages around it. */
export type ResultItem = {
  event: IEventWithRoomId;
  context: IResultContext;
  /** The server's relevance score for this hit. */
  rank: number;
};

/** Consecutive hits from one room, in the order the server returned them. */
export type ResultGroup = { roomId: string; items: ResultItem[] };

type MessageSearchParams = {
  /** Undefined or blank keeps the search idle. */
  term?: string;
  order?: SearchOrderBy;
  /** Rooms to search; undefined searches every room the user is in. */
  rooms?: string[];
  senders?: string[];
};

export type MessageSearchPage = {
  highlights: string[];
  groups: ResultGroup[];
  count?: number;
  nextToken?: string;
};

const PAGE_LIMIT = 20;

const editTarget = (result: ISearchResult): string | undefined => {
  const relation = result.result.content?.['m.relates_to'];
  return relation?.rel_type === RelationType.Replace && typeof relation.event_id === 'string'
    ? relation.event_id
    : undefined;
};

/**
 * One result per message: a message and the edits its sender made to it collapse into the
 * latest of them, kept where the server ranked it. An edit by someone else is not that
 * message's text, so it stays a result of its own.
 */
export const deduplicateResults = (results: ISearchResult[]): ISearchResult[] => {
  const keyOf = (result: ISearchResult) =>
    [
      result.result.room_id,
      editTarget(result) ?? result.result.event_id,
      result.result.sender,
    ].join('\u0000');
  const winners = new Map<string, ISearchResult>();
  results.forEach((result) => {
    const key = keyOf(result);
    const current = winners.get(key);
    if (!current) {
      winners.set(key, result);
      return;
    }
    const resultIsEdit = editTarget(result) !== undefined;
    const currentIsEdit = editTarget(current) !== undefined;
    if (resultIsEdit !== currentIsEdit) {
      if (resultIsEdit) winners.set(key, result);
      return;
    }
    if (result.result.origin_server_ts > current.result.origin_server_ts) {
      winners.set(key, result);
    }
  });
  const kept = new Set(winners.values());
  return results.filter((result) => kept.has(result));
};

/** Starts a new group whenever the room changes, so the order of the results is kept. */
const groupByRoom = (results: readonly ISearchResult[]): ResultGroup[] => {
  const groups: ResultGroup[] = [];
  results.forEach((hit) => {
    const roomId = hit.result.room_id;
    const item = { rank: hit.rank, event: hit.result, context: hit.context };
    const group = groups.at(-1);
    if (group?.roomId === roomId) group.items.push(item);
    else groups.push({ roomId, items: [item] });
  });
  return groups;
};

/** Server-side message search (`POST /search`), one page at a time. */
export const useMessageSearch = ({
  term,
  order = SearchOrderBy.Recent,
  rooms,
  senders,
}: MessageSearchParams) => {
  const mx = useMatrixClient();
  const searchTerm = term?.trim() ?? '';

  return useInfiniteQuery({
    queryKey: ['mindroom-message-search', mx.getUserId(), searchTerm, order, rooms, senders],
    enabled: searchTerm.length > 0,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: MessageSearchPage) => lastPage.nextToken,
    // A newer term replaces this query, which then has no observer and aborts its request.
    queryFn: async ({ pageParam, signal }): Promise<MessageSearchPage> => {
      const body: ISearchRequestBody = {
        search_categories: {
          room_events: {
            search_term: searchTerm,
            order_by: order,
            event_context: { before_limit: 0, after_limit: 0, include_profile: false },
            filter: { limit: PAGE_LIMIT, rooms, senders },
          },
        },
      };
      const response = await mx.search({ body, next_batch: pageParam }, signal);
      const roomEvents = response.search_categories.room_events;
      return {
        highlights: roomEvents.highlights ?? [],
        groups: groupByRoom(deduplicateResults(roomEvents.results ?? [])),
        count: roomEvents.count,
        nextToken: roomEvents.next_batch,
      };
    },
  });
};
