import type { Room } from 'matrix-js-sdk';
import {
  isMindroomAgentUserIdForViewer,
  isMindroomOwnerUserId,
} from '../../matrix/protocol/agentIdentity';
import { roomBoundRoster } from '../../matrix/protocol/agentRoomState';
import { getDirectActiveMemberCount, getDirectPartnerId } from '../../matrix/room';
import { getMDirectPartnerId } from '../../matrix/state/mDirectList';
import type { RoomToUnread } from '../../matrix/types/room';
import { agentNameIn, type HomeAgent } from './homeAgents';

export {
  HOME_AGENTS_CATEGORY_ID,
  HOME_DIRECT_CATEGORY_ID,
} from '../../ui/nav/homeExpandedDirectSections';

/** Direct messages and Agents lists stay compact above this count, showing the first 5 plus any selected room. */
export const HOME_DIRECT_COMPACT_LIMIT = 6;
export const HOME_DIRECT_COMPACT_PREVIEW = 5;

export type HiddenSectionUnread = { readonly total: number; readonly highlight: boolean };

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
  /** Agents from `useHomeAgents` plus any unlisted 1:1 agent DM, live DMs first by DM recency. */
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

/**
 * Custom-username agent vouched for by an explicit `io.mindroom.accounts` roster written by a
 * trusted same-homeserver MindRoom router (never a self-bound foreign DM creator with no roster).
 */
const isRosteredLocalAgent = (room: Room, partnerId: string): boolean => {
  const bound = roomBoundRoster(room);
  return Boolean(
    bound &&
    isMindroomAgentUserIdForViewer(bound.boundUserId, room.myUserId) &&
    bound.roster.has(partnerId)
  );
};

/**
 * Partner user ID if `room` is a 1:1 agent DM (<= 2 active members, excluding self-DMs and the
 * router owner account, with a partner matching same-homeserver MindRoom agent identity,
 * `homeAgentIds`, or an explicit same-homeserver MindRoom router roster), else `undefined`.
 */
export const getOneToOneAgentPartnerId = (
  room: Room,
  homeAgentIds: ReadonlySet<string>,
  mDirect?: Record<string, unknown>
): string | undefined => {
  const activeMembers = getDirectActiveMemberCount(room);
  if (activeMembers > 2 || activeMembers === 1) return undefined;
  const partnerId = getDirectPartnerUserId(room, mDirect);
  if (!partnerId || isMindroomOwnerUserId(partnerId)) return undefined;
  return isMindroomAgentUserIdForViewer(partnerId, room.myUserId) ||
    homeAgentIds.has(partnerId) ||
    isRosteredLocalAgent(room, partnerId)
    ? partnerId
    : undefined;
};

/**
 * Splits joined direct rooms into Home's Direct messages section and Agents section, merging in
 * `homeAgents` (which may not have a DM yet) with live 1:1 agent DMs ranked ahead of agents
 * without a live DM.
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
  const primaryAgentDmByUserId = new Map<string, { room: Room; lastActiveTs: number }>();

  for (const room of directRooms) {
    const partnerId = getOneToOneAgentPartnerId(room, homeAgentIds, mDirect);
    if (!partnerId) continue;
    const lastActiveTs = room.getLastActiveTimestamp?.() ?? 0;
    const existing = primaryAgentDmByUserId.get(partnerId);
    if (!existing || lastActiveTs > existing.lastActiveTs) {
      primaryAgentDmByUserId.set(partnerId, { room, lastActiveTs });
    }
  }

  const primaryAgentDmIds = new Set(
    Array.from(primaryAgentDmByUserId.values(), ({ room }) => room.roomId)
  );
  const humanDms = directRooms.filter((room) => !primaryAgentDmIds.has(room.roomId));

  const rankedAgents: Array<{ agent: HomeSidebarAgent; dmActivityTs: number }> = homeAgents.map(
    (agent) => {
      const dm = primaryAgentDmByUserId.get(agent.userId);
      const dmActivityTs = dm?.lastActiveTs ?? 0;
      return {
        dmActivityTs,
        agent: {
          userId: agent.userId,
          name: agent.name,
          avatarMxc: agent.avatarMxc,
          dmRoom: dm?.room,
          directRoomId: dm?.room.roomId ?? agent.direct?.roomId,
          lastActivityTs: Math.max(agent.lastUsedTs, dmActivityTs),
        },
      };
    }
  );

  for (const [partnerId, { room: dmRoom, lastActiveTs: dmActivityTs }] of primaryAgentDmByUserId) {
    if (homeAgentIds.has(partnerId)) continue;
    rankedAgents.push({
      dmActivityTs,
      agent: {
        userId: partnerId,
        name: agentNameIn(dmRoom, partnerId),
        avatarMxc: dmRoom.getAvatarFallbackMember?.()?.getMxcAvatarUrl() ?? undefined,
        dmRoom,
        directRoomId: dmRoom.roomId,
        lastActivityTs: dmActivityTs,
      },
    });
  }

  rankedAgents.sort(
    (a, b) =>
      Number(Boolean(b.agent.dmRoom)) - Number(Boolean(a.agent.dmRoom)) ||
      b.dmActivityTs - a.dmActivityTs ||
      b.agent.lastActivityTs - a.agent.lastActivityTs ||
      a.agent.name.localeCompare(b.agent.name) ||
      a.agent.userId.localeCompare(b.agent.userId)
  );

  const agents = rankedAgents.map(({ agent }) => agent);
  const agentDmRoomIds = agents.flatMap((agent) => (agent.dmRoom ? [agent.dmRoom.roomId] : []));
  return { humanDms, agents, agentDmRoomIds };
};

const selectCompactItems = <T>(
  items: readonly T[],
  getRoomId: (item: T) => string | undefined,
  selectedRoomId: string | undefined,
  closed: boolean,
  expanded: boolean,
  limit: number,
  previewCount: number
): T[] => {
  const selected = selectedRoomId
    ? items.find((item) => getRoomId(item) === selectedRoomId)
    : undefined;
  if (closed) return selected ? [selected] : [];
  if (expanded || items.length <= limit) return [...items];
  const visible = items.slice(0, previewCount);
  if (selected && !visible.includes(selected)) visible.push(selected);
  return visible;
};

/**
 * Single source of truth for rendered Direct messages rows (used by both the section and keyboard
 * shortcuts): when collapsed, shows only `selectedRoomId` if present; when expanded, shows all
 * rooms up to `limit` (or when `expanded`), otherwise the first `previewCount` plus
 * `selectedRoomId` if it sits past the cap.
 */
export const selectRenderedDirectRooms = (
  rooms: readonly Room[],
  selectedRoomId: string | undefined,
  closed: boolean,
  expanded: boolean,
  limit = HOME_DIRECT_COMPACT_LIMIT,
  previewCount = HOME_DIRECT_COMPACT_PREVIEW
): Room[] =>
  selectCompactItems(
    rooms,
    (room) => room.roomId,
    selectedRoomId,
    closed,
    expanded,
    limit,
    previewCount
  );

/**
 * Single source of truth for rendered Agents rows (used by both the section and keyboard
 * shortcuts): uses the same collapse and compact-cap rules as `selectRenderedDirectRooms`.
 */
export const selectRenderedAgents = (
  agents: readonly HomeSidebarAgent[],
  selectedRoomId: string | undefined,
  closed: boolean,
  expanded = false,
  limit = HOME_DIRECT_COMPACT_LIMIT,
  previewCount = HOME_DIRECT_COMPACT_PREVIEW
): HomeSidebarAgent[] =>
  selectCompactItems(
    agents,
    (agent) => agent.dmRoom?.roomId,
    selectedRoomId,
    closed,
    expanded,
    limit,
    previewCount
  );

/** Aggregated unread count and highlight across rooms hidden behind a section's compact cap. */
export const getHiddenSectionUnread = (
  hiddenRoomIds: readonly string[],
  unreads: RoomToUnread
): HiddenSectionUnread | undefined => {
  let hasUnread = false;
  let total = 0;
  let highlight = false;
  for (const roomId of hiddenRoomIds) {
    const unread = unreads.get(roomId);
    if (!unread) continue;
    hasUnread = true;
    total += unread.total ?? 0;
    highlight ||= unread.highlight > 0;
  }
  return hasUnread ? { total, highlight } : undefined;
};
