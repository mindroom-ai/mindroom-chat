import { describe, expect, it } from 'vitest';
import type { MatrixEvent, RoomMember } from 'matrix-js-sdk';
import { normalizeSearchString, rankMatches } from '../../lib/hooks/useAsyncSearch';
import {
  mentionRank,
  orderMentionCandidates,
  recentSenders,
  type SenderTimelines,
} from './mentionRanking';

const member = (userId: string, name: string) =>
  ({ userId, name, rawDisplayName: name } as unknown as RoomMember);

// A MindRoom team: agents and the owner under `mindroom_`, beside people without the prefix.
const scout = member('@mindroom_scout:example.org', 'Scout');
const owner = member('@mindroom_router_ab12cd:example.org', 'MindRoom');
const mind = member('@mindroom_mind:example.org', 'Mind');
const mindy = member('@mindy:example.org', 'Mindy');
const planner = member('@mindroom_daily_planner:example.org', 'Daily Planner');
const reviewer = member('@mindroom_code_reviewer:example.org', 'Ada');
const maya = member('@maya.lin:example.org', 'Maya Lin');
const berlin = member('@berlinbot:example.org', 'Berlin Bot');
const team = [scout, mindy, mind, planner, reviewer, maya, berlin];

const names = (members: RoomMember[]) => members.map(({ rawDisplayName }) => rawDisplayName);
const search = (query: string, members = team) =>
  names(rankMatches(members, mentionRank, normalizeSearchString(query)));

describe('mentionRank', () => {
  it('does not match agents by the user name prefix they all share', () => {
    expect(search('Min')).toEqual(['Mindy', 'Mind']);
    expect(search('Mind')).toEqual(['Mind', 'Mindy']);
  });

  it('puts the whole display name first, then its start, then the start of a later word', () => {
    expect(search('lin')).toEqual(['Maya Lin', 'Berlin Bot']);
    expect(search('plan')).toEqual(['Daily Planner']);
  });

  it('matches an agent by its user name without the prefix, below any display name', () => {
    expect(search('code')).toEqual(['Ada']);
    expect(search('rev')).toEqual(['Ada']);
    expect(search('maya.l')).toEqual(['Maya Lin']);
    expect(search('a', [reviewer, maya])).toEqual(['Ada', 'Maya Lin']);
  });

  it('matches every agent by the prefix only when it is typed', () => {
    expect(search('mindroom_s')).toEqual(['Scout']);
    expect(search('mindroom_')).toEqual(['Scout', 'Mind', 'Daily Planner', 'Ada']);
    expect(search('mindroom')).toEqual([]);
  });

  it('ignores case and compatibility forms', () => {
    expect(search('ＭＩＮＤ')).toEqual(['Mind', 'Mindy']);
  });

  it('matches nothing a name or user name does not hold', () => {
    expect(search('example')).toEqual([]);
  });
});

describe('orderMentionCandidates', () => {
  it('puts the latest sender first and keeps the rest in their order', () => {
    expect(names(orderMentionCandidates([scout, mind, maya], [maya.userId]))).toEqual([
      'Maya Lin',
      'Scout',
      'Mind',
    ]);
  });

  it('excludes the namespaced owner even when it spoke last', () => {
    expect(
      names(orderMentionCandidates([owner, scout, mind], [owner.userId, mind.userId]))
    ).toEqual(['Mind', 'Scout']);
  });

  it('excludes the default owner, not a person or agent with a similar user name', () => {
    const defaultOwner = member('@mindroom_router:example.org', 'MindRoom');
    const person = member('@router:example.org', 'Router');
    const routerBot = member('@mindroom_routerbot:example.org', 'Router Bot');
    expect(names(orderMentionCandidates([defaultOwner, person, routerBot], []))).toEqual([
      'Router',
      'Router Bot',
    ]);
  });
});

const event = (type: string, sender: string, ts: number) =>
  ({ getType: () => type, getSender: () => sender, getTs: () => ts } as unknown as MatrixEvent);

describe('recentSenders', () => {
  it('lists who sent messages in the room and its threads, latest first, once each', () => {
    const room = {
      getLiveTimeline: () => ({
        getEvents: () => [
          event('m.room.message', maya.userId, 1),
          event('m.room.member', scout.userId, 5),
          event('m.room.message', mind.userId, 2),
        ],
      }),
      getThreads: () => [
        {
          liveTimeline: {
            getEvents: () => [
              event('m.room.message', maya.userId, 3),
              event('m.reaction', owner.userId, 6),
            ],
          },
        },
      ],
    } as unknown as SenderTimelines;

    expect(recentSenders(room)).toEqual([maya.userId, mind.userId]);
  });

  it('is empty for a room given without timelines', () => {
    expect(recentSenders({})).toEqual([]);
  });
});
