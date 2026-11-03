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

export type SearchPathSearchParams = {
  /** `true` to search every room the user is in. */







};

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
