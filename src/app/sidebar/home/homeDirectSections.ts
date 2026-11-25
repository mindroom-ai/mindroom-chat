import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { getPowersLevelFromMatrixEvent } from '../../matrix/hooks/usePowerLevels';
import { getRoomCreators } from '../../matrix/hooks/useRoomCreators';
import {
  isMindroomAgentUserIdForViewer,
  isMindroomOwnerUserId,
} from '../../matrix/protocol/agentIdentity';
import {
  boundRoomRoster,
  MINDROOM_ACCOUNTS_STATE_EVENT,
  MINDROOM_ROUTER_STATE_EVENT,
  trustedRouterUserId,
} from '../../matrix/protocol/routerBinding';
import { getDirectPartnerId } from '../../matrix/room';
import { StateEvent } from '../../matrix/types/room';
import { makeNavCategoryId } from '../../ui/nav/closedNavCategories';
import { getDirectActiveMemberCount, getMDirectPartnerId } from '../room-nav/DirectRoomRowExtras';
import { agentNameIn, type HomeAgent } from './homeAgents';

export { getDirectActiveMemberCount };

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
  /** Human 1:1 DMs, group DMs (> 2 active members), self-DMs, and secondary duplicate agent DMs. */
  humanDms: Room[];
  /** Agents from `useHomeAgents` plus any 1:1 agent DM whose agent was not listed, by recency. */
  agents: HomeSidebarAgent[];
  /** Room IDs of the 1:1 agent DMs rendered in `agents`, in rendered order. */
  agentDmRoomIds: string[];
};

/**
 * Other active participant in a 1:1 direct room, checking avatar fallback member, loaded active
 * members, and finally `m.direct` account data (for lazy-loaded rooms before members hydrate).
 */
export const getDirectPartnerUserId = (
  room: Room,
  mDirect?: Record<string, unknown>
): string | undefined => {
  const fallback = getDirectPartnerId(room);
  if (fallback && fallback !== room.myUserId) return fallback;
  const activeMember = room
    .getMembers?.()
    .find(
      (member) =>
        member.userId !== room.myUserId &&
        (member.membership === 'join' || member.membership === 'invite')
    );
  if (activeMember) return activeMember.userId;
  const fromMDirect = getMDirectPartnerId(mDirect, room.roomId, room.myUserId);
  return fromMDirect && fromMDirect !== room.myUserId ? fromMDirect : undefined;
};

const getRoomStateByKey = (
  room: Room,
  eventType: string,
  stateKey: string
): MatrixEvent | undefined =>
  room.currentState
    ?.getStateEvents(eventType)
    .find((event) => event.getStateKey() === stateKey && !event.isRedacted?.());

/**
 * Custom-username agent vouched for by an explicit `io.mindroom.accounts` roster written by a
 * trusted same-homeserver MindRoom router (never a self-bound foreign DM creator with no roster).
 */
const isRosteredLocalAgent = (room: Room, partnerId: string): boolean => {
  if (!room.currentState) return false;
  const binding = getRoomStateByKey(room, MINDROOM_ROUTER_STATE_EVENT, '');
  if (!binding) return false;
  const powerLevelsEvent = getRoomStateByKey(room, StateEvent.RoomPowerLevels, '');
  const powerLevels = getPowersLevelFromMatrixEvent(powerLevelsEvent);
  const createEvent = getRoomStateByKey(room, StateEvent.RoomCreate, '');
  const creators = createEvent ? getRoomCreators(createEvent) : new Set<string>();
  const boundUserId = trustedRouterUserId(
    binding,
    powerLevels,
    creators,
    powerLevelsEvent?.getContent()
  );
  if (!boundUserId || !isMindroomAgentUserIdForViewer(boundUserId, room.myUserId)) return false;
  const rosterEvent = getRoomStateByKey(room, MINDROOM_ACCOUNTS_STATE_EVENT, boundUserId);
  return boundRoomRoster(boundUserId, rosterEvent).has(partnerId);
};

/**
 * Whether `room` is a 1:1 agent DM (<= 2 active members, excluding self-DMs and the router owner
 * account, with a partner matching same-homeserver MindRoom agent identity, `homeAgentIds`, or
 * an explicit same-homeserver MindRoom router roster).
 */
export const isAgentOneToOneDirectRoom = (
  room: Room,
  homeAgentIds: ReadonlySet<string>,
  mDirect?: Record<string, unknown>
): boolean => {
  const activeMembers = getDirectActiveMemberCount(room);
  if (activeMembers > 2 || activeMembers === 1) return false;
  const partnerId = getDirectPartnerUserId(room, mDirect);
  if (!partnerId || partnerId === room.myUserId) return false;
  if (isMindroomOwnerUserId(partnerId)) return false;
  return (
    isMindroomAgentUserIdForViewer(partnerId, room.myUserId) ||
    homeAgentIds.has(partnerId) ||
    isRosteredLocalAgent(room, partnerId)
  );
};

/**
 * Splits joined direct rooms into Home's Direct messages section and Agents section, merging in
 * `homeAgents` (which may not have a DM yet) and ordering agents by recency.
 *
 * Conservation invariant: every room in `directRooms` appears strictly once across `humanDms` and
 * `agentDmRoomIds`. When multiple 1:1 DMs exist for the same agent, the newest attaches to the
 * agent row and any additional 1:1 DMs stay reachable in `humanDms`.
 */
export const splitHomeDirectSections = (
  directRooms: readonly Room[],
  homeAgents: readonly HomeAgent[],
  mDirect?: Record<string, unknown>
): HomeDirectSections => {
  const homeAgentIds = new Set(homeAgents.map((agent) => agent.userId));
  const primaryAgentDmByUserId = new Map<string, Room>();

  for (const room of directRooms) {
    if (!isAgentOneToOneDirectRoom(room, homeAgentIds, mDirect)) continue;
    const partnerId = getDirectPartnerUserId(room, mDirect);
    if (!partnerId) continue;
    const existing = primaryAgentDmByUserId.get(partnerId);
    if (
      !existing ||
      (room.getLastActiveTimestamp?.() ?? 0) > (existing.getLastActiveTimestamp?.() ?? 0)
    ) {
      primaryAgentDmByUserId.set(partnerId, room);
    }
  }

  const primaryAgentDmIds = new Set(
    Array.from(primaryAgentDmByUserId.values(), (room) => room.roomId)
  );
  const humanDms = directRooms.filter((room) => !primaryAgentDmIds.has(room.roomId));

  const agents: HomeSidebarAgent[] = homeAgents.map((agent) => {
    const dmRoom = primaryAgentDmByUserId.get(agent.userId);
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

  for (const [partnerId, dmRoom] of primaryAgentDmByUserId) {
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

/**
 * Single source of truth for rendered Direct messages rows (used by both the section and keyboard
 * shortcuts): when collapsed, shows only `selectedRoomId` if present; when expanded, applies the
 * compact cap.
 */
export const selectRenderedDirectRooms = (
  rooms: readonly Room[],
  selectedRoomId: string | undefined,
  closed: boolean,
  expanded: boolean,
  limit = HOME_DIRECT_COMPACT_LIMIT,
  previewCount = HOME_DIRECT_COMPACT_PREVIEW
): { rooms: Room[]; capped: boolean } => {
  if (closed) {
    const selected = selectedRoomId
      ? rooms.find((room) => room.roomId === selectedRoomId)
      : undefined;
    return { rooms: selected ? [selected] : [], capped: false };
  }
  return selectVisibleDirectRooms(rooms, selectedRoomId, expanded, limit, previewCount);
};

/** Single source of truth for rendered Agents rows (collapsed shows only the selected agent DM). */
export const selectRenderedAgents = (
  agents: readonly HomeSidebarAgent[],
  selectedRoomId: string | undefined,
  closed: boolean
): HomeSidebarAgent[] => {
  if (!closed) return [...agents];
  const selected = selectedRoomId
    ? agents.find((agent) => agent.dmRoom?.roomId === selectedRoomId)
    : undefined;
  return selected ? [selected] : [];
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
