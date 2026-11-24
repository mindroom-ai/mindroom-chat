import type { Room } from 'matrix-js-sdk';

import {
  foldText,
  matchWord,
  prepareText,
  typosBetween,
  type PreparedText,
} from '../lib/fuzzyMatch';
import { Membership } from '../matrix/types/room';
import { INVITE_AUTOCOMPLETE_LIMIT, type ServerUserDirectoryUser } from './userDirectoryCache';
import { getMxIdLocalPart } from '../matrix/matrix';

export const MINDROOM_AGENT_LOCALPART_PREFIX = 'mindroom_';

type PreparedField = {
  prepared: PreparedText;
  weight: number;
  name: boolean;
};

type PreparedUser = {
  user: ServerUserDirectoryUser;
  fields: PreparedField[];
};

type UserDirectorySearchResult = {
  user: ServerUserDirectoryUser;
  tier: number;
  score: number;
  detail: number;
};

type FieldMatch = 'exact' | 'prefix' | 'includes' | 'none';

const PREPARED_TEXT_CACHE_LIMIT = 4096;
const preparedTextCache = new Map<string, PreparedText>();
const preparedUsersCache = new WeakMap<readonly ServerUserDirectoryUser[], PreparedUser[]>();

const blockedMemberships = new Set<string>([Membership.Join, Membership.Invite, Membership.Ban]);

export const sanitizeInviteAutocompleteOptionId = (userId: string): string =>
  encodeURIComponent(userId).replace(/%/g, '_');

const getUserLocalpart = (userId: string): string => getMxIdLocalPart(userId) ?? userId;

// Accept queries with or without the MXID sigil so a pasted @user:server
// ranks as the exact match it is.
const normalizeQuery = (query: string): string =>
  query.trim().toLocaleLowerCase().replace(/^@/, '');

export const getUserDirectoryQueryVariants = (query: string): string[] => {
  const compactQuery = query.replace(/\s+/g, '');
  return compactQuery.length >= 2 && compactQuery !== query ? [query, compactQuery] : [query];
};

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

const MIN_ONE_EDIT_LENGTH = 3;
// Weighted score is 4 * 0.5 = 2.0 on display name and 4 * 0.25 = 1.0 on post-prefix localpart,
// strictly below every weighted matchWord score (minimum 3.0 on non-name fields, 4.0 on name
// fields) so stronger fuzzy matches always outrank a one-edit fallback.
const ONE_EDIT_FALLBACK_SCORE = 4;
const ONE_EDIT_TOKEN_PENALTY = -0.5;
const ONE_EDIT_PREFIX_PENALTY = -0.25;
const ONE_EDIT_TOKEN_PENALTY_CAP = 4;
const ONE_EDIT_PREFIX_DELTAS = [0, 1, -1] as const;
const TOKEN_SEPARATOR = /[^\p{L}\p{N}]+/u;

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

const getPreparedText = (value: string): PreparedText => {
  const cached = preparedTextCache.get(value);
  if (cached) return cached;
  const prepared = prepareText(value);
  if (preparedTextCache.size >= PREPARED_TEXT_CACHE_LIMIT) preparedTextCache.clear();
  preparedTextCache.set(value, prepared);
  return prepared;
};

const getPreparedUsers = (users: readonly ServerUserDirectoryUser[]): PreparedUser[] => {
  const cached = preparedUsersCache.get(users);
  if (cached) return cached;

  const prepared = users.map((user): PreparedUser => {
    const localpart = getUserLocalpart(user.userId);
    const postPrefixLocalpart = getPostPrefixLocalpart(localpart);
    const fields: PreparedField[] = [];
    if (user.displayName) {
      fields.push({ prepared: getPreparedText(user.displayName), weight: 0.5, name: true });
    }
    if (postPrefixLocalpart) {
      fields.push({ prepared: getPreparedText(postPrefixLocalpart), weight: 0.25, name: true });
    }
    if (localpart && localpart !== postPrefixLocalpart) {
      fields.push({ prepared: getPreparedText(localpart), weight: 0.15, name: false });
    }
    const mxid = user.userId.replace(/^@/, '');
    if (mxid) {
      fields.push({ prepared: getPreparedText(mxid), weight: 0.1, name: false });
    }
    return { user, fields };
  });
  preparedUsersCache.set(users, prepared);
  return prepared;
};

const hasSingleEditPrefixMatch = (word: string, token: string): boolean => {
  if (token.length <= word.length) return false;
  for (const delta of ONE_EDIT_PREFIX_DELTAS) {
    const size = word.length + delta;
    if (
      size >= MIN_ONE_EDIT_LENGTH &&
      size < token.length &&
      typosBetween(word, token.slice(0, size), 1) === 1
    ) {
      return true;
    }
  }
  return false;
};

const matchSingleEditFallback = (
  word: string,
  prepared: PreparedText
): { score: number; detail: number } | undefined => {
  if (word.length < MIN_ONE_EDIT_LENGTH) return undefined;
  let tokenIndex = 0;
  let bestDetail = -Infinity;
  for (const token of prepared.text.split(TOKEN_SEPARATOR)) {
    if (token.length === 0) continue;
    if (token.length >= MIN_ONE_EDIT_LENGTH) {
      const tokenPenalty =
        Math.min(tokenIndex, ONE_EDIT_TOKEN_PENALTY_CAP) * ONE_EDIT_TOKEN_PENALTY;
      if (Math.abs(word.length - token.length) <= 1 && typosBetween(word, token, 1) === 1) {
        bestDetail = Math.max(bestDetail, tokenPenalty);
      } else if (hasSingleEditPrefixMatch(word, token)) {
        bestDetail = Math.max(bestDetail, tokenPenalty + ONE_EDIT_PREFIX_PENALTY);
      }
    }
    tokenIndex += 1;
  }
  return bestDetail > -Infinity
    ? { score: ONE_EDIT_FALLBACK_SCORE, detail: bestDetail }
    : undefined;
};

const scorePreparedUser = (
  fields: readonly PreparedField[],
  words: readonly string[],
  allowOneEditFallback = false
): { score: number; detail: number } | undefined => {
  if (words.length === 0) return undefined;
  let scoreSum = 0;
  let detailSum = 0;
  for (const word of words) {
    let bestScore = -1;
    let bestDetail = -Infinity;
    for (const field of fields) {
      const match =
        matchWord(word, field.prepared, field.name) ??
        (allowOneEditFallback && field.name
          ? matchSingleEditFallback(word, field.prepared)
          : undefined);
      if (!match) continue;
      const score = match.score * field.weight;
      const detail = match.detail * field.weight;
      if (score > bestScore || (score === bestScore && detail > bestDetail)) {
        bestScore = score;
        bestDetail = detail;
      }
    }
    if (bestScore < 0) return undefined;
    scoreSum += bestScore;
    detailSum += bestDetail;
  }
  return { score: scoreSum / words.length, detail: detailSum / words.length };
};

// Tiers and fuzzy scores are precomputed per candidate; recomputing them inside
// the comparator would repeat the string matching O(n log n) times while sorting.
const compareUserDirectoryResults = (
  left: UserDirectorySearchResult,
  right: UserDirectorySearchResult
): number =>
  left.tier - right.tier ||
  right.score - left.score ||
  right.detail - left.detail ||
  left.user.userId.localeCompare(right.user.userId);

const keepBestResult = (
  resultsByUserId: Map<string, UserDirectorySearchResult>,
  candidate: UserDirectorySearchResult
): void => {
  const currentBest = resultsByUserId.get(candidate.user.userId);
  if (!currentBest || compareUserDirectoryResults(candidate, currentBest) < 0) {
    resultsByUserId.set(candidate.user.userId, candidate);
  }
};

const searchSingleCharacter = (
  users: readonly ServerUserDirectoryUser[],
  normalizedQuery: string,
  limit: number
): ServerUserDirectoryUser[] =>
  users
    .map((user) => ({
      user,
      tier: getRankTier(user, normalizedQuery),
      score: 0,
      detail: 0,
    }))
    .filter((result) => result.tier < NO_MATCH_TIER)
    .sort(compareUserDirectoryResults)
    .slice(0, limit)
    .map((result) => result.user);

export const filterInviteUserCandidates = (
  users: readonly ServerUserDirectoryUser[],
  room: Pick<Room, 'getMember'> | undefined,
  selfUserId?: string
): ServerUserDirectoryUser[] =>
  users.filter((user) => {
    if (user.userId === selfUserId) return false;
    if (!room) return true;

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

  // A spaced query must also rank space-less identities (`r 2 d 2` → `R2D2`),
  // where the added spaces can prevent a literal match; each user keeps its
  // best result across the raw and compacted query forms.
  const queryVariants = getUserDirectoryQueryVariants(normalizedQuery).map((rankQuery) => ({
    rankQuery,
    words: foldText(rankQuery)
      .split(/\s+/)
      .filter((word) => word.length > 0),
  }));

  const preparedUsers = getPreparedUsers(users);
  const literalByUserId = new Map<string, UserDirectorySearchResult>();

  for (const preparedUser of preparedUsers) {
    for (const { rankQuery, words } of queryVariants) {
      const tier = getRankTier(preparedUser.user, rankQuery);
      if (tier >= NO_MATCH_TIER) continue;
      const fuzzy = scorePreparedUser(preparedUser.fields, words);
      keepBestResult(literalByUserId, {
        user: preparedUser.user,
        tier,
        score: fuzzy?.score ?? 0,
        detail: fuzzy?.detail ?? 0,
      });
    }
  }

  // Fuzzy-only hits stand in for a typo when no user contains the query. Once one does, they are
  // noise: a three-letter query is one edit away from most names and from every shared prefix.
  if (literalByUserId.size > 0) {
    return Array.from(literalByUserId.values())
      .sort(compareUserDirectoryResults)
      .slice(0, limit)
      .map((result) => result.user);
  }

  const fuzzyByUserId = new Map<string, UserDirectorySearchResult>();
  for (const preparedUser of preparedUsers) {
    for (const { words } of queryVariants) {
      const fuzzy = scorePreparedUser(preparedUser.fields, words, true);
      if (!fuzzy) continue;
      keepBestResult(fuzzyByUserId, {
        user: preparedUser.user,
        tier: NO_MATCH_TIER,
        score: fuzzy.score,
        detail: fuzzy.detail,
      });
    }
  }

  return Array.from(fuzzyByUserId.values())
    .sort(compareUserDirectoryResults)
    .slice(0, limit)
    .map((result) => result.user);
};
