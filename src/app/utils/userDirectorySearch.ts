import Fuse, { type FuseOptionKey } from 'fuse.js';
import type { Room } from 'matrix-js-sdk';

import { Membership } from '../../types/matrix/room';
import {
  INVITE_AUTOCOMPLETE_LIMIT,
  type ServerUserDirectoryUser,
} from '../state/userDirectoryCache';
import { getMxIdLocalPart } from './matrix';

type SearchableUserDirectoryUser = ServerUserDirectoryUser & {
  localpart: string;
};

type UserDirectoryFuseResult = {
  user: ServerUserDirectoryUser;
  score: number;
};

type RankBucket = 0 | 1 | 2 | 3;

const userFuseCache = new WeakMap<
  readonly ServerUserDirectoryUser[],
  Fuse<SearchableUserDirectoryUser>
>();

const userDirectoryFuseKeys: FuseOptionKey<SearchableUserDirectoryUser>[] = [
  { name: 'displayName', weight: 0.55 },
  { name: 'localpart', weight: 0.35 },
  { name: 'userId', weight: 0.1 },
];

const blockedMemberships = new Set<string>([Membership.Join, Membership.Invite, Membership.Ban]);

export const sanitizeInviteAutocompleteOptionId = (userId: string): string =>
  encodeURIComponent(userId).replace(/%/g, '_');

const getUserLocalpart = (userId: string): string => getMxIdLocalPart(userId) ?? userId;

const getSearchFields = (user: ServerUserDirectoryUser): string[] => [
  user.displayName ?? '',
  getUserLocalpart(user.userId),
  user.userId,
];

const includesQuery = (value: string, query: string): boolean =>
  value.toLocaleLowerCase().includes(query);

const startsWithQuery = (value: string, query: string): boolean =>
  value.toLocaleLowerCase().startsWith(query);

const exactQuery = (value: string, query: string): boolean => value.toLocaleLowerCase() === query;

const getRankBucket = (user: ServerUserDirectoryUser, normalizedQuery: string): RankBucket => {
  const fields = getSearchFields(user);

  if (fields.some((field) => exactQuery(field, normalizedQuery))) return 0;
  if (fields.some((field) => startsWithQuery(field, normalizedQuery))) return 1;
  if (fields.some((field) => includesQuery(field, normalizedQuery))) return 2;
  return 3;
};

const toSearchableUsers = (
  users: readonly ServerUserDirectoryUser[]
): SearchableUserDirectoryUser[] =>
  users.map((user) => ({
    ...user,
    localpart: getUserLocalpart(user.userId),
  }));

const getFuse = (users: readonly ServerUserDirectoryUser[]): Fuse<SearchableUserDirectoryUser> => {
  const cachedFuse = userFuseCache.get(users);
  if (cachedFuse) return cachedFuse;

  const fuse = new Fuse(toSearchableUsers(users), {
    keys: userDirectoryFuseKeys,
    minMatchCharLength: 2,
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
  });
  userFuseCache.set(users, fuse);

  return fuse;
};

const compareUserDirectoryResults = (
  normalizedQuery: string,
  left: UserDirectoryFuseResult,
  right: UserDirectoryFuseResult
): number =>
  getRankBucket(left.user, normalizedQuery) - getRankBucket(right.user, normalizedQuery) ||
  left.score - right.score ||
  left.user.userId.localeCompare(right.user.userId);

const searchSingleCharacter = (
  users: readonly ServerUserDirectoryUser[],
  normalizedQuery: string,
  limit: number
): ServerUserDirectoryUser[] =>
  users
    .filter((user) => getSearchFields(user).some((field) => includesQuery(field, normalizedQuery)))
    .map((user) => ({
      user,
      score: 0,
    }))
    .sort((left, right) => compareUserDirectoryResults(normalizedQuery, left, right))
    .slice(0, limit)
    .map((result) => result.user);

export const filterInviteUserCandidates = (
  users: readonly ServerUserDirectoryUser[],
  room: Pick<Room, 'getMember'>,
  selfUserId?: string
): ServerUserDirectoryUser[] =>
  users.filter((user) => {
    if (user.userId === selfUserId) return false;

    const membership = room.getMember(user.userId)?.membership;
    return !membership || !blockedMemberships.has(membership);
  });

export const rankUsers = (
  users: readonly ServerUserDirectoryUser[],
  query: string,
  limit = INVITE_AUTOCOMPLETE_LIMIT
): ServerUserDirectoryUser[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) return [];

  if (normalizedQuery.length === 1) {
    return searchSingleCharacter(users, normalizedQuery, limit);
  }

  return getFuse(users)
    .search(normalizedQuery)
    .map((result) => ({
      user: result.item,
      score: result.score ?? 1,
    }))
    .sort((left, right) => compareUserDirectoryResults(normalizedQuery, left, right))
    .slice(0, limit)
    .map((result) => result.user);
};
