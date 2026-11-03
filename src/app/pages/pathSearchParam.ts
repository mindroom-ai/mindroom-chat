// Typed readers for the search parameters that app routes understand.

export type RoomSearchParams = {
  /** Comma-separated server names to join an unknown room through. */
  viaServers?: string;
  /** Root event of the thread to open in the room view. */
  threadId?: string;
};

export type DirectCreateSearchParams = {
  userId?: string;
};

/**
 * The search page's parameters, all plain text: `global` is `true` to search every room the user
 * is in, `term` holds the words to search for, and `rooms` is a comma-separated list of room IDs
 * that narrow the search.
 */
export type SearchPathSearchParams = Partial<
  Record<'global' | 'term' | 'order' | 'rooms' | 'senders', string>
>;

const readParam = (searchParams: URLSearchParams, name: string): string | undefined =>
  searchParams.get(name) ?? undefined;

export const getRoomSearchParams = (searchParams: URLSearchParams): RoomSearchParams => ({
  viaServers: readParam(searchParams, 'viaServers'),
  threadId: readParam(searchParams, 'threadId'),
});

export const getDirectCreateSearchParams = (
  searchParams: URLSearchParams
): DirectCreateSearchParams => ({
  userId: readParam(searchParams, 'userId'),
});

export const getSearchPathSearchParams = (
  searchParams: URLSearchParams
): SearchPathSearchParams => ({
  global: readParam(searchParams, 'global'),
  term: readParam(searchParams, 'term'),
  order: readParam(searchParams, 'order'),
  rooms: readParam(searchParams, 'rooms'),
  senders: readParam(searchParams, 'senders'),
});
