import type { Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import type { HomeAgent } from './homeAgents';
import {
  getOneToOneAgentPartnerId,
  HOME_AGENTS_CATEGORY_ID,
  HOME_DIRECT_CATEGORY_ID,
  selectRenderedAgents,
  selectRenderedDirectRooms,
  splitHomeDirectSections,
} from './homeDirectSections';

const ME = '@maya:example.org';
const LIAM = '@liam:example.org';
const NORA = '@nora:example.org';
const DEV_AGENT = '@mindroom_dev:example.org';
const RESEARCHER = '@mindroom_researcher:example.org';
const CUSTOM_AGENT = '@helper_bot:example.org';

type MockDirectRoomOptions = {
  roomId: string;
  name?: string;
  joined: number;
  invited?: number;
  partnerId?: string;
  partnerDisplayName?: string;
  partnerAvatarMxc?: string;
  lastActiveTs?: number;
  members?: Array<{ userId: string; membership: string; rawDisplayName?: string }>;
  stateEvents?: Record<
    string,
    Array<{ stateKey: string; sender: string; content: Record<string, unknown> }>
  >;
};

const makeRoom = ({
  roomId,
  name = roomId,
  joined,
  invited = 0,
  partnerId,
  partnerDisplayName,
  partnerAvatarMxc,
  lastActiveTs = 0,
  members,
  stateEvents,
}: MockDirectRoomOptions): Room =>
  ({
    roomId,
    name,
    myUserId: ME,
    getJoinedMemberCount: () => joined,
    getInvitedMemberCount: () => invited,
    getLastActiveTimestamp: () => lastActiveTs,
    getAvatarFallbackMember: () =>
      partnerId
        ? {
            userId: partnerId,
            rawDisplayName: partnerDisplayName,
            getMxcAvatarUrl: () => partnerAvatarMxc ?? null,
          }
        : null,
    getMember: (userId: string) => {
      if (userId === partnerId) {
        return {
          userId,
          membership: invited > 0 ? 'invite' : 'join',
          rawDisplayName: partnerDisplayName ?? '',
          getMxcAvatarUrl: () => partnerAvatarMxc ?? null,
        };
      }
      return members?.find((m) => m.userId === userId) ?? null;
    },
    currentState: stateEvents
      ? {
          getStateEvents: (eventType: string) =>
            (stateEvents[eventType] ?? []).map((ev) => ({
              getStateKey: () => ev.stateKey,
              getSender: () => ev.sender,
              getContent: () => ev.content,
              isRedacted: () => false,
            })),
        }
      : undefined,
    getMembers: () =>
      members ?? [
        { userId: ME, membership: 'join' },
        ...(partnerId ? [{ userId: partnerId, membership: invited > 0 ? 'invite' : 'join' }] : []),
      ],
  }) as unknown as Room;

const makeHomeAgent = (
  overrides: Partial<HomeAgent> & Pick<HomeAgent, 'userId' | 'name'>
): HomeAgent => ({
  roomIds: ['!general:example.org'],
  lastUsedTs: 0,
  ...overrides,
});

describe('homeDirectSections', () => {
  it('places Direct messages and Agents category IDs in the mindroom namespace', () => {
    expect(HOME_DIRECT_CATEGORY_ID).toBe('mindroom|home-direct');
    expect(HOME_AGENTS_CATEGORY_ID).toBe('mindroom|home-agents');
    expect(HOME_DIRECT_CATEGORY_ID.startsWith('home|')).toBe(false);
    expect(HOME_AGENTS_CATEGORY_ID.startsWith('home|')).toBe(false);
  });

  it('classifies 1:1 agent DMs separately from human 1:1 DMs, group DMs (even with agents), and self-DMs', () => {
    const humanDm = makeRoom({ roomId: '!dm-liam:example.org', joined: 2, partnerId: LIAM });
    const invitedHumanDm = makeRoom({
      roomId: '!dm-nora:example.org',
      joined: 1,
      invited: 1,
      partnerId: NORA,
    });
    const agentDm = makeRoom({ roomId: '!dm-dev:example.org', joined: 2, partnerId: DEV_AGENT });
    const invitedAgentDm = makeRoom({
      roomId: '!dm-researcher:example.org',
      joined: 1,
      invited: 1,
      partnerId: RESEARCHER,
    });
    const customAgentDm = makeRoom({
      roomId: '!dm-custom:example.org',
      joined: 2,
      partnerId: CUSTOM_AGENT,
    });
    const groupDmWithAgent = makeRoom({
      roomId: '!dm-group-agent:example.org',
      joined: 3,
      partnerId: DEV_AGENT,
    });
    const groupDmWithInvitedAgent = makeRoom({
      roomId: '!dm-group-invited:example.org',
      joined: 2,
      invited: 1,
      partnerId: DEV_AGENT,
    });
    const selfDm = makeRoom({
      roomId: '!dm-self:example.org',
      joined: 1,
      partnerId: ME,
    });
    const selfDmWithStalePartner = makeRoom({
      roomId: '!dm-self-left:example.org',
      joined: 1,
      partnerId: DEV_AGENT,
    });

    const homeAgentIds = new Set([CUSTOM_AGENT]);

    expect(getOneToOneAgentPartnerId(humanDm, homeAgentIds)).toBeUndefined();
    expect(getOneToOneAgentPartnerId(invitedHumanDm, homeAgentIds)).toBeUndefined();
    expect(getOneToOneAgentPartnerId(agentDm, homeAgentIds)).toBe(DEV_AGENT);
    expect(getOneToOneAgentPartnerId(invitedAgentDm, homeAgentIds)).toBe(RESEARCHER);
    expect(getOneToOneAgentPartnerId(customAgentDm, homeAgentIds)).toBe(CUSTOM_AGENT);
    expect(getOneToOneAgentPartnerId(groupDmWithAgent, homeAgentIds)).toBeUndefined();
    expect(getOneToOneAgentPartnerId(groupDmWithInvitedAgent, homeAgentIds)).toBeUndefined();
    expect(getOneToOneAgentPartnerId(selfDm, homeAgentIds)).toBeUndefined();
    expect(getOneToOneAgentPartnerId(selfDmWithStalePartner, homeAgentIds)).toBeUndefined();
  });

  it('merges useHomeAgents with unlisted 1:1 agent DMs and orders agents by recency', () => {
    const liamDm = makeRoom({
      roomId: '!dm-liam:example.org',
      joined: 2,
      partnerId: LIAM,
      lastActiveTs: 9000,
    });
    const groupWithAgent = makeRoom({
      roomId: '!dm-design-group:example.org',
      joined: 3,
      partnerId: DEV_AGENT,
      lastActiveTs: 8500,
    });
    const selfDm = makeRoom({
      roomId: '!dm-self:example.org',
      joined: 1,
      partnerId: ME,
      lastActiveTs: 8000,
    });
    const devDm = makeRoom({
      roomId: '!dm-dev:example.org',
      joined: 2,
      partnerId: DEV_AGENT,
      partnerDisplayName: 'DevAgent',
      lastActiveTs: 4000,
    });
    const unlistedAgentDm = makeRoom({
      roomId: '!dm-researcher:example.org',
      joined: 2,
      partnerId: RESEARCHER,
      partnerDisplayName: 'Researcher',
      partnerAvatarMxc: 'mxc://example.org/researcher',
      lastActiveTs: 7000,
    });

    const devAgent = makeHomeAgent({
      userId: DEV_AGENT,
      name: 'DevAgent',
      avatarMxc: 'mxc://example.org/dev',
      direct: { roomId: '!dm-dev:example.org', waiting: false },
      lastUsedTs: 2000,
    });
    const writerAgent = makeHomeAgent({
      userId: '@mindroom_writer:example.org',
      name: 'Writer',
      lastUsedTs: 6000,
    });

    const result = splitHomeDirectSections(
      [liamDm, groupWithAgent, selfDm, unlistedAgentDm, devDm],
      [writerAgent, devAgent]
    );

    expect(result.humanDms.map((r) => r.roomId)).toEqual([
      '!dm-liam:example.org',
      '!dm-design-group:example.org',
      '!dm-self:example.org',
    ]);
    expect(
      result.agents.map((a) => ({
        userId: a.userId,
        name: a.name,
        dmRoomId: a.dmRoom?.roomId,
        directRoomId: a.directRoomId,
        avatarMxc: a.avatarMxc,
        lastActivityTs: a.lastActivityTs,
      }))
    ).toEqual([
      {
        userId: RESEARCHER,
        name: 'Researcher',
        dmRoomId: '!dm-researcher:example.org',
        directRoomId: '!dm-researcher:example.org',
        avatarMxc: 'mxc://example.org/researcher',
        lastActivityTs: 7000,
      },
      {
        userId: '@mindroom_writer:example.org',
        name: 'Writer',
        dmRoomId: undefined,
        directRoomId: undefined,
        avatarMxc: undefined,
        lastActivityTs: 6000,
      },
      {
        userId: DEV_AGENT,
        name: 'DevAgent',
        dmRoomId: '!dm-dev:example.org',
        directRoomId: '!dm-dev:example.org',
        avatarMxc: 'mxc://example.org/dev',
        lastActivityTs: 4000,
      },
    ]);
    expect(result.agentDmRoomIds).toEqual(['!dm-researcher:example.org', '!dm-dev:example.org']);
  });

  it('conserves every direct room ID: newest duplicate 1:1 agent DM attaches to Agents and older stays in humanDms', () => {
    const newer = makeRoom({
      roomId: '!dm-dev-new:example.org',
      joined: 2,
      partnerId: DEV_AGENT,
      lastActiveTs: 5000,
    });
    const older = makeRoom({
      roomId: '!dm-dev-old:example.org',
      joined: 2,
      partnerId: DEV_AGENT,
      lastActiveTs: 1000,
    });
    const liam = makeRoom({
      roomId: '!dm-liam:example.org',
      joined: 2,
      partnerId: LIAM,
      lastActiveTs: 3000,
    });

    for (const input of [
      [newer, liam, older],
      [older, liam, newer],
    ]) {
      const result = splitHomeDirectSections(input, []);
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0]?.dmRoom?.roomId).toBe('!dm-dev-new:example.org');
      expect(result.humanDms.map((r) => r.roomId)).toEqual(
        input.filter((r) => r.roomId !== '!dm-dev-new:example.org').map((r) => r.roomId)
      );
      const allOutputIds = [...result.humanDms.map((r) => r.roomId), ...result.agentDmRoomIds];
      expect(new Set(allOutputIds).size).toBe(input.length);
      expect(allOutputIds).toHaveLength(input.length);
    }
  });

  it('falls back to m.direct when members are lazy-loaded, excludes mindroom_router, and honors custom homeAgents', () => {
    const lazyAgentDm = makeRoom({
      roomId: '!dm-lazy-dev:example.org',
      joined: 2,
      members: [],
      lastActiveTs: 4000,
    });
    const lazyCustomAgentDm = makeRoom({
      roomId: '!dm-lazy-custom:example.org',
      joined: 2,
      members: [],
      lastActiveTs: 3500,
    });
    const routerOwnerDm = makeRoom({
      roomId: '!dm-router:example.org',
      joined: 2,
      partnerId: '@mindroom_router:example.org',
      lastActiveTs: 3000,
    });
    const routerNamedAgentDm = makeRoom({
      roomId: '!dm-router-agent:example.org',
      joined: 2,
      partnerId: '@mindroom_router_helper:example.org',
      lastActiveTs: 2500,
    });

    const mDirect = {
      [DEV_AGENT]: ['!dm-lazy-dev:example.org'],
      [CUSTOM_AGENT]: ['!dm-lazy-custom:example.org'],
    };
    const customAgent = makeHomeAgent({
      userId: CUSTOM_AGENT,
      name: 'HelperBot',
      lastUsedTs: 1000,
    });

    const result = splitHomeDirectSections(
      [lazyAgentDm, lazyCustomAgentDm, routerOwnerDm, routerNamedAgentDm],
      [customAgent],
      mDirect
    );

    expect(result.humanDms.map((r) => r.roomId)).toEqual(['!dm-router:example.org']);
    expect(result.agents.map((a) => ({ userId: a.userId, dmRoomId: a.dmRoom?.roomId }))).toEqual([
      { userId: DEV_AGENT, dmRoomId: '!dm-lazy-dev:example.org' },
      { userId: CUSTOM_AGENT, dmRoomId: '!dm-lazy-custom:example.org' },
      { userId: '@mindroom_router_helper:example.org', dmRoomId: '!dm-router-agent:example.org' },
    ]);
  });

  it('keeps foreign-homeserver mindroom_* partners in humanDms and classifies trusted-roster custom agents into agents', () => {
    const foreignSpoofDm = makeRoom({
      roomId: '!dm-foreign:example.org',
      joined: 2,
      partnerId: '@mindroom_dev:foreign.example',
      lastActiveTs: 4000,
    });
    const foreignSelfBoundId = '@alice:foreign.example';
    const foreignSelfBoundDm = makeRoom({
      roomId: '!dm-foreign-selfbound:example.org',
      joined: 2,
      partnerId: foreignSelfBoundId,
      lastActiveTs: 3500,
      stateEvents: {
        'm.room.power_levels': [
          {
            stateKey: '',
            sender: foreignSelfBoundId,
            content: { users_default: 0, state_default: 50, users: { [foreignSelfBoundId]: 100 } },
          },
        ],
        'io.mindroom.router': [
          { stateKey: '', sender: foreignSelfBoundId, content: { user_id: foreignSelfBoundId } },
        ],
      },
    });
    const routerId = '@mindroom_router:example.org';
    const rosteredCustomId = '@studio_helper:example.org';
    const rosteredCustomDm = makeRoom({
      roomId: '!dm-rostered:example.org',
      joined: 2,
      partnerId: rosteredCustomId,
      partnerDisplayName: 'Studio Helper',
      lastActiveTs: 3000,
      stateEvents: {
        'm.room.power_levels': [
          {
            stateKey: '',
            sender: routerId,
            content: { users_default: 0, state_default: 50, users: { [routerId]: 100 } },
          },
        ],
        'io.mindroom.router': [{ stateKey: '', sender: routerId, content: { user_id: routerId } }],
        'io.mindroom.accounts': [
          {
            stateKey: routerId,
            sender: routerId,
            content: { accounts: [rosteredCustomId] },
          },
        ],
      },
    });

    const result = splitHomeDirectSections(
      [foreignSpoofDm, foreignSelfBoundDm, rosteredCustomDm],
      []
    );
    expect(result.humanDms.map((r) => r.roomId)).toEqual([
      '!dm-foreign:example.org',
      '!dm-foreign-selfbound:example.org',
    ]);
    expect(result.agents.map((a) => ({ userId: a.userId, dmRoomId: a.dmRoom?.roomId }))).toEqual([
      { userId: rosteredCustomId, dmRoomId: '!dm-rostered:example.org' },
    ]);
  });

  it('derives rendered direct rooms and agents consistently across collapsed and expanded states', () => {
    const rooms = [
      makeRoom({ roomId: '!dm-1:example.org', joined: 2, partnerId: LIAM }),
      makeRoom({ roomId: '!dm-2:example.org', joined: 2, partnerId: NORA }),
    ];
    expect(selectRenderedDirectRooms(rooms, undefined, true, false)).toEqual([]);
    expect(selectRenderedDirectRooms(rooms, '!dm-2:example.org', true, false)).toEqual([rooms[1]]);
    expect(selectRenderedDirectRooms(rooms, undefined, false, false)).toEqual(rooms);

    const agents = [
      { userId: DEV_AGENT, name: 'DevAgent', dmRoom: rooms[0], lastActivityTs: 2 },
      { userId: RESEARCHER, name: 'Researcher', dmRoom: rooms[1], lastActivityTs: 1 },
    ];
    expect(selectRenderedAgents(agents, undefined, true)).toEqual([]);
    expect(selectRenderedAgents(agents, '!dm-2:example.org', true)).toEqual([agents[1]]);
    expect(selectRenderedAgents(agents, undefined, false)).toEqual(agents);
  });

  it('caps Direct messages at 5 + selected when > 6 and expands all when requested', () => {
    const six = Array.from({ length: 6 }, (_, i) =>
      makeRoom({ roomId: `!dm-${i + 1}:example.org`, joined: 2, partnerId: `@u${i}:example.org` })
    );
    expect(selectRenderedDirectRooms(six, undefined, false, false)).toEqual(six);

    const eight = [
      ...six,
      makeRoom({ roomId: '!dm-7:example.org', joined: 2, partnerId: '@u7:example.org' }),
      makeRoom({ roomId: '!dm-8:example.org', joined: 2, partnerId: '@u8:example.org' }),
    ];

    expect(selectRenderedDirectRooms(eight, undefined, false, false).map((r) => r.roomId)).toEqual([
      '!dm-1:example.org',
      '!dm-2:example.org',
      '!dm-3:example.org',
      '!dm-4:example.org',
      '!dm-5:example.org',
    ]);

    // Selected room past index 5 stays visible under the compact cap.
    expect(
      selectRenderedDirectRooms(eight, '!dm-8:example.org', false, false).map((r) => r.roomId)
    ).toEqual([
      '!dm-1:example.org',
      '!dm-2:example.org',
      '!dm-3:example.org',
      '!dm-4:example.org',
      '!dm-5:example.org',
      '!dm-8:example.org',
    ]);

    // Selected room within the first 5 is not duplicated.
    expect(selectRenderedDirectRooms(eight, '!dm-3:example.org', false, false)).toHaveLength(5);

    // Expanded shows every room.
    expect(selectRenderedDirectRooms(eight, '!dm-8:example.org', false, true)).toHaveLength(8);
  });

  it('caps Agents at 5 + selected when > 6, expands all when requested, and shows only selected when closed', () => {
    const makeAgent = (index: number, withDm = true) => ({
      userId: `@mindroom_a${index}:example.org`,
      name: `Agent ${index}`,
      dmRoom: withDm
        ? makeRoom({
            roomId: `!dm-agent-${index}:example.org`,
            joined: 2,
            partnerId: `@mindroom_a${index}:example.org`,
          })
        : undefined,
      lastActivityTs: 100 - index,
    });

    const six = Array.from({ length: 6 }, (_, i) => makeAgent(i + 1));
    expect(selectRenderedAgents(six, undefined, false, false)).toEqual(six);

    const eight = [...six, makeAgent(7, false), makeAgent(8, true)];
    expect(selectRenderedAgents(eight, undefined, false, false).map((a) => a.userId)).toEqual([
      '@mindroom_a1:example.org',
      '@mindroom_a2:example.org',
      '@mindroom_a3:example.org',
      '@mindroom_a4:example.org',
      '@mindroom_a5:example.org',
    ]);

    // Selected agent past the cap stays visible; selected within first 5 is not duplicated.
    expect(
      selectRenderedAgents(eight, '!dm-agent-8:example.org', false, false).map((a) => a.userId)
    ).toEqual([
      '@mindroom_a1:example.org',
      '@mindroom_a2:example.org',
      '@mindroom_a3:example.org',
      '@mindroom_a4:example.org',
      '@mindroom_a5:example.org',
      '@mindroom_a8:example.org',
    ]);
    expect(selectRenderedAgents(eight, '!dm-agent-3:example.org', false, false)).toHaveLength(5);

    // Expanded shows every agent; closed overrides expanded and shows only the selected agent.
    expect(selectRenderedAgents(eight, '!dm-agent-8:example.org', false, true)).toHaveLength(8);
    expect(
      selectRenderedAgents(eight, '!dm-agent-8:example.org', true, true).map((a) => a.userId)
    ).toEqual(['@mindroom_a8:example.org']);
    expect(selectRenderedAgents(eight, undefined, true, true)).toEqual([]);
  });
});
