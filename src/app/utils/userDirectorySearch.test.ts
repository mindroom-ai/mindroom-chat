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
      '@carol:example.org',
      '@elise:example.org',
      '@malice:example.org',
      '@bob:example.org',
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

  it('ranks display-name prefix matches above localpart-substring matches', () => {
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

const AGENT_NAMES = [
  'alpha',
  'basil',
  'clio',
  'delta',
  'echo',
  'fable',
  'gamma',
  'helix',
  'iris',
  'juno',
  'kilo',
  'lyra',
  'mind',
  'nova',
  'oracle',
  'pico',
  'quill',
  'rho',
  'sarro',
  'tesla',
];

const agentUserId = (name: string): string => `@mindroom_${name}:mindroom.example.org`;

const namedAgents: ServerUserDirectoryUser[] = AGENT_NAMES.map((name) => ({
  userId: agentUserId(name),
  displayName: name.charAt(0).toLocaleUpperCase() + name.slice(1),
}));

// Direct-user candidates and bootstrap rows can carry no profile data.
const bareAgents: ServerUserDirectoryUser[] = AGENT_NAMES.map((name) => ({
  userId: agentUserId(name),
}));

const humans: ServerUserDirectoryUser[] = [
  { userId: '@bas:mindroom.example.org', displayName: 'Bas Nijholt' },
  { userId: '@dominic:mindroom.example.org', displayName: 'Dominic Mindler' },
  { userId: '@melinda:mindroom.example.org', displayName: 'Melinda Woods' },
  { userId: '@mia:mindroom.example.org', displayName: 'Mia Torres' },
  { userId: '@sara:mindroom.example.org', displayName: 'Sara Rowe' },
];

describe('rankUsers with shared-prefix agent localparts', () => {
  it('surfaces the agent named by the query even when its cached row has no display name', () => {
    const results = rankUsers([...bareAgents, ...humans], 'mind').map((user) => user.userId);

    expect(results[0]).toBe(agentUserId('mind'));
  });

  it('ranks display-name matches above matches that only hit the shared agent prefix', () => {
    const results = rankUsers([...namedAgents, ...humans], 'mind').map((user) => user.userId);
    const dominicIndex = results.indexOf('@dominic:mindroom.example.org');
    const sharedPrefixSiblingIndexes = results
      .map((userId, index) => ({ userId, index }))
      .filter(({ userId }) => userId.startsWith('@mindroom_') && userId !== agentUserId('mind'))
      .map(({ index }) => index);

    expect(results[0]).toBe(agentUserId('mind'));
    expect(dominicIndex).toBeGreaterThan(-1);
    sharedPrefixSiblingIndexes.forEach((siblingIndex) => {
      expect(siblingIndex).toBeGreaterThan(dominicIndex);
    });
  });

  it('keeps post-prefix and display-name prefix matches above the shared-prefix flood while typing', () => {
    const results = rankUsers([...namedAgents, ...humans], 'mi').map((user) => user.userId);

    expect(results.slice(0, 2).sort()).toEqual(['@mia:mindroom.example.org', agentUserId('mind')]);
  });

  it('ranks an exact display-name match above an exact localpart match on another user', () => {
    const results = rankUsers(
      [
        { userId: '@mind:mindroom.example.org', displayName: 'Milo Human' },
        { userId: agentUserId('mind'), displayName: 'Mind' },
      ],
      'mind'
    ).map((user) => user.userId);

    expect(results).toEqual([agentUserId('mind'), '@mind:mindroom.example.org']);
  });

  it('keeps weak fuzzy display-name matches below post-prefix localpart hits', () => {
    const results = rankUsers([...bareAgents, ...humans], 'sarro').map((user) => user.userId);

    expect(results[0]).toBe(agentUserId('sarro'));
    expect(results.indexOf('@sara:mindroom.example.org')).toBeGreaterThan(
      results.indexOf(agentUserId('sarro'))
    );
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
