import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Room } from 'matrix-js-sdk';

import {
  INVITE_AUTOCOMPLETE_LIMIT,
  INVITE_SERVER_FALLBACK_MIN_LOCAL_RESULTS,
  INVITE_SERVER_SEARCH_LIMIT,
  isUserDirectoryCacheFresh,
  mergeUserDirectoryUsers,
  normalizeUserDirectoryUsers,
  type ServerUserDirectoryUser,
  type UserDirectoryCacheState,
} from '../state/userDirectoryCache';
import { filterInviteUserCandidates, rankUsers } from '../utils/userDirectorySearch';
import { useAlive } from './useAlive';
import { useDebounce } from './useDebounce';
import { useDirectUsers } from './useDirectUsers';
import { useMatrixClient } from './useMatrixClient';
import { useUserDirectoryCache } from './useUserDirectoryCache';

type ServerSearchResult = {
  term: string;
  ownerKey?: string;
  users: ServerUserDirectoryUser[];
};

type InviteUserSearchResult = {
  suggestions: ServerUserDirectoryUser[];
  isFetching: boolean;
};

const EMPTY_USER_SUGGESTIONS: ServerUserDirectoryUser[] = [];

const getSelfUserId = (mx: ReturnType<typeof useMatrixClient>): string | undefined =>
  mx.getSafeUserId() ?? undefined;

const getFilteredUsers = (
  users: readonly ServerUserDirectoryUser[],
  room: Room,
  selfUserId?: string
): ServerUserDirectoryUser[] => filterInviteUserCandidates(users, room, selfUserId);

const shouldSearchServer = (
  trimmedQuery: string,
  cache: UserDirectoryCacheState,
  localSuggestions: readonly ServerUserDirectoryUser[]
): boolean =>
  trimmedQuery.length >= 2 &&
  (cache.status !== 'ready' ||
    !isUserDirectoryCacheFresh(cache) ||
    cache.limited ||
    cache.isBootstrapOnly ||
    localSuggestions.length < INVITE_SERVER_FALLBACK_MIN_LOCAL_RESULTS);

export const useInviteUserSearch = (room: Room, query: string): InviteUserSearchResult => {
  const mx = useMatrixClient();
  const alive = useAlive();
  const cache = useUserDirectoryCache();
  const directUsers = useDirectUsers();
  const requestIdRef = useRef(0);
  const [serverResult, setServerResult] = useState<ServerSearchResult>();
  const [isServerFetching, setIsServerFetching] = useState(false);

  const trimmedQuery = query.trim();
  const localSearchTerm = useMemo(
    () => (trimmedQuery.startsWith('@') ? trimmedQuery.slice(1) : trimmedQuery),
    [trimmedQuery]
  );
  const selfUserId = getSelfUserId(mx);

  const directUserCandidates = useMemo<ServerUserDirectoryUser[]>(
    () => directUsers.map((userId) => ({ userId })),
    [directUsers]
  );

  const localUsers = useMemo(
    () => mergeUserDirectoryUsers(directUserCandidates, cache.users),
    [cache.users, directUserCandidates]
  );

  const filteredLocalUsers = useMemo(
    () => getFilteredUsers(localUsers, room, selfUserId),
    [localUsers, room, selfUserId]
  );

  const localSuggestions = useMemo(() => {
    if (localSearchTerm.length === 0) return EMPTY_USER_SUGGESTIONS;
    return rankUsers(filteredLocalUsers, localSearchTerm, INVITE_AUTOCOMPLETE_LIMIT);
  }, [filteredLocalUsers, localSearchTerm]);

  const cacheState = useMemo<UserDirectoryCacheState>(
    () => ({
      users: cache.users,
      status: cache.status,
      fetchedAt: cache.fetchedAt,
      limited: cache.limited,
      isBootstrapOnly: cache.isBootstrapOnly,
      ownerKey: cache.ownerKey,
    }),
    [
      cache.fetchedAt,
      cache.isBootstrapOnly,
      cache.limited,
      cache.ownerKey,
      cache.status,
      cache.users,
    ]
  );

  const needsServerSearch =
    localSearchTerm.length > 0 && shouldSearchServer(trimmedQuery, cacheState, localSuggestions);

  const runServerSearch = useCallback(
    async (term: string, queryTerm: string, requestId: number) => {
      if (!alive() || requestId !== requestIdRef.current) return;

      setIsServerFetching(true);

      try {
        const response = await mx.searchUserDirectory({
          term,
          limit: INVITE_SERVER_SEARCH_LIMIT,
        });
        if (!alive() || requestId !== requestIdRef.current) return;

        setServerResult({
          term: queryTerm,
          ownerKey: cache.ownerKey,
          users: normalizeUserDirectoryUsers(response.results),
        });
      } catch {
        if (!alive() || requestId !== requestIdRef.current) return;

        setServerResult({
          term: queryTerm,
          ownerKey: cache.ownerKey,
          users: [],
        });
      } finally {
        if (alive() && requestId === requestIdRef.current) {
          setIsServerFetching(false);
        }
      }
    },
    [alive, cache.ownerKey, mx]
  );

  const debouncedServerSearch = useDebounce(runServerSearch, { wait: 200 });

  useEffect(() => {
    requestIdRef.current += 1;

    if (!needsServerSearch) {
      setIsServerFetching(false);
      return;
    }

    const serverQuery = trimmedQuery.startsWith('@') ? trimmedQuery.slice(1) : trimmedQuery;
    if (serverQuery.length === 0) {
      setIsServerFetching(false);
      return;
    }

    setIsServerFetching(true);
    debouncedServerSearch(serverQuery, trimmedQuery, requestIdRef.current);
  }, [debouncedServerSearch, needsServerSearch, trimmedQuery]);

  const suggestions = useMemo(() => {
    if (trimmedQuery.length === 0) return [];
    if (serverResult?.term !== trimmedQuery || serverResult.ownerKey !== cache.ownerKey) {
      return localSuggestions;
    }

    const filteredServerUsers = getFilteredUsers(serverResult.users, room, selfUserId);
    return rankUsers(
      mergeUserDirectoryUsers(filteredLocalUsers, filteredServerUsers),
      localSearchTerm,
      INVITE_AUTOCOMPLETE_LIMIT
    );
  }, [
    cache.ownerKey,
    filteredLocalUsers,
    localSuggestions,
    localSearchTerm,
    room,
    selfUserId,
    serverResult,
    trimmedQuery,
  ]);

  return {
    suggestions,
    isFetching: isServerFetching,
  };
};
