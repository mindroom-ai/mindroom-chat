// Typed readers for the search parameters that app routes understand.

type RoomSearchParams = {
  /** Comma-separated server names to join an unknown room through. */
  viaServers?: string;
  /** Root event of the thread to open in the room view. */
  threadId?: string;
};

type DirectCreateSearchParams = {
  userId?: string;
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
