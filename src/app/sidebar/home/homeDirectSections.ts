import type { Room } from 'matrix-js-sdk';
import { isMindroomAgentUserId } from '../../matrix/protocol/agentIdentity';
import { getDirectPartnerId } from '../../matrix/room';
import { makeNavCategoryId } from '../../ui/nav/closedNavCategories';
import { agentNameIn, type HomeAgent } from './homeAgents';

/** Category IDs in the `'mindroom'` namespace so Home space-section selectors (`home|`) stay unaffected. */
export const HOME_DIRECT_CATEGORY_ID = makeNavCategoryId('mindroom', 'home-direct');
export const HOME_AGENTS_CATEGORY_ID = makeNavCategoryId('mindroom', 'home-agents');

/** Direct messages list stays compact above this count, showing the first 5 plus any selected room. */
export const HOME_DIRECT_COMPACT_LIMIT = 6;
export const HOME_DIRECT_COMPACT_PREVIEW = 5;

export type HomeSidebarAgent = {
  userId: string;
  name: string;
  avatarMxc?: string;
  dmRoom?: Room;
  /** Existing direct room ID (from the live DM room or `homeAgent.direct.roomId`). */
  directRoomId?: string;
  lastActivityTs: number;
};

export type HomeDirectSections = {
  /** Human 1:1 DMs, group DMs (> 2 active members), and self-DMs (1 active member). */
  humanDms: Room[];
  /** Agents from `useHomeAgents` plus any 1:1 agent DM whose agent was not listed, by recency. */
  agents: HomeSidebarAgent[];
  /** Room IDs of the 1:1 agent DMs rendered in `agents`, in rendered order. */
  agentDmRoomIds: string[];
};

/** Count of active (joined + invited) members in a direct room. */
export const getDirectActiveMemberCount = (room: Room): number =>
  (room.getJoinedMemberCount?.() ?? 0) + (room.getInvitedMemberCount?.() ?? 0);

/** Other active participant in a 1:1 direct room, falling back to active member lookup. */
export const getDirectPartnerUserId = (room: Room): string | undefined => {
  const fallback = getDirectPartnerId(room);
  if (fallback && fallback !== room.myUserId) return fallback;
  const members = room.getMembers?.();
  if (!members) return fallback;
  return members.find(
    (member) =>
      member.userId !== room.myUserId &&
      (member.membership === 'join' || member.membership === 'invite')
  )?.userId;
};

/**
 * Whether `room` is a 1:1 agent DM (<= 2 active members, excluding self-DMs where the viewer is
 * the only active member, with a partner matching MindRoom agent identity or `homeAgentIds`).
 */
export const isAgentOneToOneDirectRoom = (
  room: Room,
  homeAgentIds: ReadonlySet<string>
): boolean => {
  const activeMembers = getDirectActiveMemberCount(room);
  if (activeMembers > 2 || activeMembers === 1) return false;
  const partnerId = getDirectPartnerUserId(room);
  if (!partnerId || partnerId === room.myUserId) return false;
  return isMindroomAgentUserId(partnerId) || homeAgentIds.has(partnerId);
};

/**
 * Splits joined direct rooms into Home's Direct messages section and Agents section, merging in
 * `homeAgents` (which may not have a DM yet) and ordering agents by recency.
 */
export const splitHomeDirectSections = (
  directRooms: readonly Room[],
  homeAgents: readonly HomeAgent[]
): HomeDirectSections => {
  const homeAgentIds = new Set(homeAgents.map((agent) => agent.userId));
  const humanDms: Room[] = [];
  const agentDmByUserId = new Map<string, Room>();

  for (const room of directRooms) {
    if (isAgentOneToOneDirectRoom(room, homeAgentIds)) {
      const partnerId = getDirectPartnerUserId(room);
      if (partnerId && !agentDmByUserId.has(partnerId)) {
        agentDmByUserId.set(partnerId, room);
      }
    } else {
      humanDms.push(room);
    }
  }

  const agents: HomeSidebarAgent[] = homeAgents.map((agent) => {
    const dmRoom = agentDmByUserId.get(agent.userId);
    const dmTs = dmRoom?.getLastActiveTimestamp?.() ?? 0;
    return {
      userId: agent.userId,
      name: agent.name,
      avatarMxc: agent.avatarMxc,
      dmRoom,
      directRoomId: dmRoom?.roomId ?? agent.direct?.roomId,
      lastActivityTs: Math.max(agent.lastUsedTs, dmTs),
    };
  });

  for (const [partnerId, dmRoom] of agentDmByUserId) {
    if (homeAgentIds.has(partnerId)) continue;
    agents.push({
      userId: partnerId,
      name: agentNameIn(dmRoom, partnerId),
      avatarMxc: dmRoom.getAvatarFallbackMember?.()?.getMxcAvatarUrl() ?? undefined,
      dmRoom,
      directRoomId: dmRoom.roomId,
      lastActivityTs: dmRoom.getLastActiveTimestamp?.() ?? 0,
    });
  }

  agents.sort(
    (a, b) =>
      b.lastActivityTs - a.lastActivityTs ||
      a.name.localeCompare(b.name) ||
      a.userId.localeCompare(b.userId)
  );

  const agentDmRoomIds = agents.flatMap((agent) => (agent.dmRoom ? [agent.dmRoom.roomId] : []));
  return { humanDms, agents, agentDmRoomIds };
};

/**
 * Selects the visible direct rooms under Home's compact cap: all rooms when `rooms.length <= limit`
 * or `expanded`, otherwise the first `previewCount` plus `selectedRoomId` if it sits past the cap.
 */
export const selectVisibleDirectRooms = (
  rooms: readonly Room[],
  selectedRoomId: string | undefined,
  expanded: boolean,
  limit = HOME_DIRECT_COMPACT_LIMIT,
  previewCount = HOME_DIRECT_COMPACT_PREVIEW
): { rooms: Room[]; capped: boolean } => {
  if (expanded || rooms.length <= limit) {
    return { rooms: [...rooms], capped: false };
  }
  const visible = rooms.slice(0, previewCount);
  if (selectedRoomId && !visible.some((room) => room.roomId === selectedRoomId)) {
    const selected = rooms.find((room) => room.roomId === selectedRoomId);
    if (selected) visible.push(selected);
  }
  return { rooms: visible, capped: true };
};

/** Deduplicates room IDs while preserving first-seen visual order. */
export const dedupeRoomIds = (...lists: readonly (readonly string[])[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const list of lists) {
    for (const roomId of list) {
      if (seen.has(roomId)) continue;
      seen.add(roomId);
      result.push(roomId);
    }
  }
  return result;
};

/** Visible room IDs across Home Rooms/Spaces, Direct messages, and Agents for keyboard stepping. */
export const collectHomeShortcutRoomIds = ({
  roomShortcutIds,
  humanDms,
  agentDmRoomIds,
  showDirectSection,
  directClosed,
  agentsClosed,
  showAllDms,
  selectedRoomId,
}: {
  roomShortcutIds: readonly string[];
  humanDms: readonly Room[];
  agentDmRoomIds: readonly string[];
  showDirectSection: boolean;
  directClosed: boolean;
  agentsClosed: boolean;
  showAllDms: boolean;
  selectedRoomId: string | undefined;
}): string[] => {
  const directIds = !showDirectSection
    ? []
    : directClosed
      ? selectedRoomId && humanDms.some((room) => room.roomId === selectedRoomId)
        ? [selectedRoomId]
        : []
      : selectVisibleDirectRooms(humanDms, selectedRoomId, showAllDms).rooms.map(
          (room) => room.roomId
        );
  const agentIds = agentsClosed
    ? selectedRoomId && agentDmRoomIds.includes(selectedRoomId)
      ? [selectedRoomId]
      : []
    : agentDmRoomIds;
  return dedupeRoomIds(roomShortcutIds, directIds, agentIds);
};
