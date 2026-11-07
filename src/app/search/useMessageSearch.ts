import { useInfiniteQuery } from '@tanstack/react-query';
import {
  EventType,
  type IEventWithRoomId,
  type IResultContext,
  type ISearchRequestBody,
  type ISearchResult,
  RelationType,
  SearchOrderBy,
} from 'matrix-js-sdk';
import { getSameSenderBundledEdit } from '../matrix/editEvent';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';

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
  /** The server's total of hits for the search, when it gives one. */
  count?: number;
  /** Hits of this page left out: older versions of a message, and texts edited away. */
  hidden: number;
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
 * How well a hit shows its message's latest text: the original with its latest edit bundled
 * knows it for sure, an edit is at least newer than the original, and a bare original may be
 * outdated.
 */
const freshness = (result: ISearchResult): number => {
  if (editTarget(result) !== undefined) return 1;
  return getSameSenderBundledEdit(result.result) ? 2 : 0;
};

/**
 * One result per message: a message and the edits its sender made to it collapse into the hit
 * that shows its latest text, kept where the server ranked it. An edit by someone else is not
 * that message's text, so it stays a result of its own.
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
    if (
      !current ||
      freshness(result) > freshness(current) ||
      (freshness(result) === freshness(current) &&
        result.result.origin_server_ts > current.result.origin_server_ts)
    ) {
      winners.set(key, result);
    }
  });
  const kept = new Set(winners.values());
  return results.filter((result) => kept.has(result));
};

const bodyOf = (content: unknown): string => {
  const body = (content as { body?: unknown } | undefined)?.body;
  return typeof body === 'string' ? body.toLocaleLowerCase() : '';
};

/** The words of a search term, as the server splits them, in lower case. */
const searchTermWords = (term: string): string[] =>
  term
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * Drops hits the server found in a message's first text that its latest edit no longer has.
 * Servers index each event as it was sent, so an agent's reply that began as "Thinking..." stays a
 * hit for "Thinking" after it was edited to its answer. A hit whose own text does not show the
 * term (the server may stem words) is kept, since there is nothing to compare.
 */
export const dropEditedAwayResults = (results: ISearchResult[], term: string): ISearchResult[] => {
  const words = searchTermWords(term);
  if (words.length === 0) return results;
  const has = (text: string) => words.some((word) => text.includes(word));
  return results.filter((result) => {
    const edit = getSameSenderBundledEdit(result.result);
    if (!edit || editTarget(result) !== undefined) return true;
    const editContent = edit.content;
    const latest = bodyOf(editContent?.['m.new_content'] ?? editContent);
    return !has(bodyOf(result.result.content)) || has(latest);
  });
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
            // Servers also match room names and topics; Tuwunel ignores `keys`, so the filter
            // keeps the hits to messages.
            keys: ['content.body'],
            order_by: order,
            event_context: { before_limit: 0, after_limit: 0, include_profile: false },
            filter: { limit: PAGE_LIMIT, rooms, senders, types: [EventType.RoomMessage] },
          },
        },
      };
      const response = await mx.search({ body, next_batch: pageParam }, signal);
      const roomEvents = response.search_categories.room_events;
      const results = roomEvents.results ?? [];
      const shown = dropEditedAwayResults(deduplicateResults(results), searchTerm);
      return {
        highlights: roomEvents.highlights ?? [],
        groups: groupByRoom(shown),
        count: roomEvents.count,
        hidden: results.length - shown.length,
        nextToken: roomEvents.next_batch,
      };
    },
  });
};
