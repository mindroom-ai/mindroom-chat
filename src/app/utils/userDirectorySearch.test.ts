import { describe, expect, it } from 'vitest';

import { Membership } from '../../types/matrix/room';
import {
  INVITE_AUTOCOMPLETE_LIMIT,
  type ServerUserDirectoryUser,
} from '../state/userDirectoryCache';
import {
  filterInviteUserCandidates,
  rankUsers,
  sanitizeInviteAutocompleteOptionId,
} from './userDirectorySearch';

const users: ServerUserDirectoryUser[] = [
  { userId: '@elise:example.org', displayName: 'Elise Example' },
  { userId: '@alice:example.org', displayName: 'Alice Adams' },
  { userId: '@malice:example.org', displayName: 'Malice Cooper' },
  { userId: '@bob:example.org', displayName: 'Robert Bobson' },
  { userId: '@alicea:example.org', displayName: 'Alicea Keys' },
  { userId: '@carol:example.org', displayName: 'Carol Example' },
  { userId: '@ally:example.org', displayName: 'Zed Person' },
];

describe('rankUsers', () => {
  it('short-circuits one-character queries to starts-with matches before contains matches', () => {
    expect(rankUsers(users, 'a').map((user) => user.userId)).toEqual([
      '@alice:example.org',
      '@alicea:example.org',
      '@ally:example.org',
      '@bob:example.org',
      '@carol:example.org',
      '@elise:example.org',
      '@malice:example.org',
    ]);
  });

  it('ranks exact matches above prefixes, contains matches, and fuzzy-only matches', () => {
    expect(rankUsers(users, 'alice').map((user) => user.userId)).toEqual([
      '@alice:example.org',
      '@alicea:example.org',
      '@malice:example.org',
      '@elise:example.org',
    ]);
  });

  it('ranks exact localpart and MXID matches above weak display-name matches', () => {
    const exactUser = { userId: '@casey:example.org', displayName: 'Unrelated' };
    const weakDisplayMatch = {
      userId: '@other:example.org',
      displayName: 'Casey Adjacent Team',
    };

    expect(rankUsers([weakDisplayMatch, exactUser], 'casey').map((user) => user.userId)).toEqual([
      '@casey:example.org',
      '@other:example.org',
    ]);
    expect(
      rankUsers([weakDisplayMatch, exactUser], '@casey:example.org').map((user) => user.userId)[0]
    ).toBe('@casey:example.org');
  });

  it('promotes an exact MXID even when stronger display-name Fuse matches exceed the visible limit', () => {
    const exactUser = { userId: '@alice:example.org', displayName: 'Unrelated' };
    const displayNameMatches = Array.from(
      { length: INVITE_AUTOCOMPLETE_LIMIT * 3 },
      (_, index): ServerUserDirectoryUser => ({
        userId: `@candidate-${index}:example.org`,
        displayName: `@alice:example.org teammate ${index}`,
      })
    );

    const resultIds = rankUsers([...displayNameMatches, exactUser], '@alice:example.org').map(
      (user) => user.userId
    );

    expect(resultIds).toHaveLength(INVITE_AUTOCOMPLETE_LIMIT);
    expect(resultIds[0]).toBe('@alice:example.org');
    expect(resultIds).toContain('@alice:example.org');
  });

  it('uses Fuse weights so display-name matches beat localpart-only matches', () => {
    const results = rankUsers(
      [
        { userId: '@zzz-robert:example.org', displayName: 'Unrelated' },
        { userId: '@zzz-bob:example.org', displayName: 'Robert Jones' },
      ],
      'robert'
    );

    expect(results.map((user) => user.userId)).toEqual([
      '@zzz-bob:example.org',
      '@zzz-robert:example.org',
    ]);
  });

  it('falls back to a deterministic userId tiebreak', () => {
    expect(
      rankUsers(
        [
          { userId: '@zeta:example.org', displayName: 'Sam' },
          { userId: '@alpha:example.org', displayName: 'Sam' },
        ],
        'sam'
      ).map((user) => user.userId)
    ).toEqual(['@alpha:example.org', '@zeta:example.org']);
  });
});

describe('filterInviteUserCandidates', () => {
  it('excludes the current user and joined, invited, or banned room members', () => {
    const room = {
      getMember: (userId: string) => {
        const memberships: Record<string, Membership> = {
          '@alice:example.org': Membership.Join,
          '@alicea:example.org': Membership.Join,
          '@bob:example.org': Membership.Invite,
          '@carol:example.org': Membership.Ban,
          '@elise:example.org': Membership.Leave,
        };

        return memberships[userId] ? { membership: memberships[userId] } : undefined;
      },
    };

    expect(
      filterInviteUserCandidates(users, room, '@ally:example.org').map((user) => user.userId)
    ).toEqual(['@elise:example.org', '@malice:example.org']);
  });
});

describe('sanitizeInviteAutocompleteOptionId', () => {
  it('produces stable DOM id suffixes from Matrix user IDs', () => {
    expect(sanitizeInviteAutocompleteOptionId('@user:name.example')).toBe('_40user_3Aname.example');
  });

  it('does not collide for MXIDs that differ only by punctuation placement', () => {
    expect(sanitizeInviteAutocompleteOptionId('@user:name.example')).not.toBe(
      sanitizeInviteAutocompleteOptionId('@user.name:example')
    );
  });
});
