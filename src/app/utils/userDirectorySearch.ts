import Fuse, { type FuseOptionKey } from 'fuse.js';
import type { Room } from 'matrix-js-sdk';

import { Membership } from '../../types/matrix/room';
import {
  INVITE_AUTOCOMPLETE_LIMIT,
  type ServerUserDirectoryUser,
} from '../state/userDirectoryCache';
import { getMxIdLocalPart } from './matrix';

export const MINDROOM_AGENT_LOCALPART_PREFIX = 'mindroom_';

type SearchableUserDirectoryUser = ServerUserDirectoryUser & {
  localpart: string;
  postPrefixLocalpart: string;
};

type UserDirectoryFuseResult = {
  user: ServerUserDirectoryUser;
  score: number;
  tier: number;
};

type FieldMatch = 'exact' | 'prefix' | 'includes' | 'none';

const userFuseCache = new WeakMap<
  readonly ServerUserDirectoryUser[],
  Fuse<SearchableUserDirectoryUser>
>();

const userDirectoryFuseKeys: FuseOptionKey<SearchableUserDirectoryUser>[] = [
  { name: 'displayName', weight: 0.5 },
  { name: 'postPrefixLocalpart', weight: 0.25 },
  { name: 'localpart', weight: 0.15 },
  { name: 'userId', weight: 0.1 },
];

const blockedMemberships = new Set<string>([Membership.Join, Membership.Invite, Membership.Ban]);

export const sanitizeInviteAutocompleteOptionId = (userId: string): string =>
  encodeURIComponent(userId).replace(/%/g, '_');

const getUserLocalpart = (userId: string): string => getMxIdLocalPart(userId) ?? userId;

// Accept queries with or without the MXID sigil so a pasted @user:server
// ranks as the exact match it is.
const normalizeQuery = (query: string): string =>
  query.trim().toLocaleLowerCase().replace(/^@/, '');

const getPostPrefixLocalpart = (localpart: string): string =>
  localpart.startsWith(MINDROOM_AGENT_LOCALPART_PREFIX)
    ? localpart.slice(MINDROOM_AGENT_LOCALPART_PREFIX.length)
    : localpart;

const matchField = (value: string, query: string): FieldMatch => {
  const normalizedValue = value.toLocaleLowerCase();
  if (normalizedValue === query) return 'exact';
  if (normalizedValue.startsWith(query)) return 'prefix';
  if (normalizedValue.includes(query)) return 'includes';
  return 'none';
};

/**
 * Field-identity rank tiers. Matches on the display name or on the localpart
 * segment after the shared agent prefix outrank matches that only hit the
 * shared `mindroom_` prefix, so one agent's name cannot bury another agent
 * behind the whole fleet.
 */
const NO_MATCH_TIER = 8;

const getRankTier = (user: ServerUserDirectoryUser, normalizedQuery: string): number => {
  const localpart = getUserLocalpart(user.userId);
  const postPrefixLocalpart = getPostPrefixLocalpart(localpart);
  const displayName = matchField(user.displayName ?? '', normalizedQuery);
  const local = matchField(localpart, normalizedQuery);
  const postPrefix =
    postPrefixLocalpart === localpart ? local : matchField(postPrefixLocalpart, normalizedQuery);
  // Queries reach here with any leading @ stripped, so match the MXID
  // without its sigil or an exact/prefix MXID paste could never rank as one.
  const mxid = matchField(user.userId.replace(/^@/, ''), normalizedQuery);

  if (displayName === 'exact') return 0;
  if (postPrefix === 'exact' || local === 'exact' || mxid === 'exact') return 1;
  if (displayName === 'prefix') return 2;
  if (postPrefix === 'prefix') return 3;
  if (displayName === 'includes') return 4;
  if (postPrefix === 'includes') return 5;
  if (local === 'prefix' || mxid === 'prefix') return 6;
  if (local === 'includes' || mxid === 'includes') return 7;
  return NO_MATCH_TIER;
};

/**
 * Tiers 0-3 are identity-bearing hits (exact on any field, or a prefix of the
 * display name / post-prefix localpart segment). Shared-prefix and fuzzy
 * matches are weaker and must not suppress the server-directory fallback.
 */
const STRONG_MATCH_MAX_TIER = 3;

export const countStrongInviteUserMatches = (
  users: readonly ServerUserDirectoryUser[],
  query: string
): number => {
  const normalizedQuery = normalizeQuery(query);
  if (normalizedQuery.length === 0) return 0;

  return users.filter((user) => getRankTier(user, normalizedQuery) <= STRONG_MATCH_MAX_TIER).length;
};

const toSearchableUsers = (
  users: readonly ServerUserDirectoryUser[]
): SearchableUserDirectoryUser[] =>
  users.map((user) => {
    const localpart = getUserLocalpart(user.userId);
    return {
      ...user,
      localpart,
      postPrefixLocalpart: getPostPrefixLocalpart(localpart),
    };
  });

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

// Tiers are precomputed per candidate; recomputing them inside the comparator
// would repeat the string matching O(n log n) times while sorting.
const compareUserDirectoryResults = (
  left: UserDirectoryFuseResult,
  right: UserDirectoryFuseResult
): number =>
  left.tier - right.tier ||
  left.score - right.score ||
  left.user.userId.localeCompare(right.user.userId);

const searchSingleCharacter = (
  users: readonly ServerUserDirectoryUser[],
  normalizedQuery: string,
  limit: number
): ServerUserDirectoryUser[] =>
  users
    .map((user) => ({
      user,
      score: 0,
      tier: getRankTier(user, normalizedQuery),
    }))
    .filter((result) => result.tier < NO_MATCH_TIER)
    .sort(compareUserDirectoryResults)
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
  const normalizedQuery = normalizeQuery(query);
  if (normalizedQuery.length === 0) return [];

  if (normalizedQuery.length === 1) {
    return searchSingleCharacter(users, normalizedQuery, limit);
  }

  return getFuse(users)
    .search(normalizedQuery)
    .map((result) => ({
      user: result.item,
      score: result.score ?? 1,
      tier: getRankTier(result.item, normalizedQuery),
    }))
    .sort(compareUserDirectoryResults)
    .slice(0, limit)
    .map((result) => result.user);
};
