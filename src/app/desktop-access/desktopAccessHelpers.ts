import { useCallback } from 'react';
import type { MatrixClient, RoomMember } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import type { DesktopAccessControllerConfig, DesktopAccessSnapshot } from '../lib/desktopBridge';
import { getMxIdLocalPart } from '../matrix/matrix';
import {
  AGENT_USERNAME_PREFIX,
  isMindroomAgentUserIdForViewer,
  isMindroomOwnerUserId,
} from '../matrix/protocol/agentIdentity';

export type RoomMindroomAgent = {
  userId: string;
  agentName: string;
  displayName: string;
};

/**
 * Translates `featureUi.desktopAccess.*` keys with English fallbacks while keeping i18next
 * overload resolution fast and cleanly typed before all 17 locale addition catalogs land.
 */
export const useDesktopT = () => {
  const { t } = useTranslation();
  return useCallback(
    (
      key: `featureUi.desktopAccess.${string}`,
      defaultValue: string,
      values?: Record<string, string | number>
    ): string => {
      const rawKey: string = key;
      return t(rawKey, { ...values, defaultValue });
    },
    [t]
  );
};

export type DesktopT = ReturnType<typeof useDesktopT>;

/** Derives the MindRoom agent name from a Matrix user ID (stripping the `mindroom_` prefix). */
export const extractAgentName = (userId: string): string => {
  const localpart = getMxIdLocalPart(userId) ?? userId;
  return localpart.toLowerCase().startsWith(AGENT_USERNAME_PREFIX) &&
    localpart.length > AGENT_USERNAME_PREFIX.length
    ? localpart.slice(AGENT_USERNAME_PREFIX.length)
    : localpart;
};

const NAMESPACED_ROUTER_RE = /^mindroom_router_([a-z0-9]{4,32})$/i;

export type RoomAgentMember = Pick<RoomMember, 'userId' | 'name' | 'membership'> &
  Partial<Pick<RoomMember, 'rawDisplayName'>>;

/**
 * Resolves a clean human-facing display name for a room member, preferring rawDisplayName over
 * disambiguated name and falling back when unset or equal to the Matrix user ID.
 */
export const resolveMemberDisplayName = (
  member: Pick<RoomMember, 'userId' | 'name'> & Partial<Pick<RoomMember, 'rawDisplayName'>>,
  fallback: string
): string => {
  const raw = member.rawDisplayName?.trim();
  if (raw && raw !== member.userId) return raw;
  const name = member.name?.trim();
  if (name && name !== member.userId) return name;
  return fallback;
};

/**
 * Resolves joined MindRoom agents from room members on the viewer's homeserver, excluding the
 * bare router owner ID and namespaced routers paired with sibling agents sharing that suffix.
 */
export const resolveRoomAgents = (
  members: readonly RoomAgentMember[],
  viewerUserId?: string
): RoomMindroomAgent[] => {
  const seen = new Set<string>();
  const candidates: Array<RoomMindroomAgent & { localpart: string }> = [];
  for (const member of members) {
    if (member.membership !== 'join') continue;
    const { userId } = member;
    if (
      seen.has(userId) ||
      userId === viewerUserId ||
      isMindroomOwnerUserId(userId) ||
      !isMindroomAgentUserIdForViewer(userId, viewerUserId)
    ) {
      continue;
    }
    seen.add(userId);
    const localpart = (getMxIdLocalPart(userId) ?? userId).toLowerCase();
    const agentName = extractAgentName(userId);
    candidates.push({
      userId,
      agentName,
      displayName: resolveMemberDisplayName(member, agentName),
      localpart,
    });
  }

  const agents: RoomMindroomAgent[] = [];
  for (const candidate of candidates) {
    const ns = NAMESPACED_ROUTER_RE.exec(candidate.localpart)?.[1];
    if (ns) {
      const suffix = `_${ns.toLowerCase()}`;
      const hasSiblingAgent = candidates.some(
        (other) =>
          other.userId !== candidate.userId &&
          other.localpart.endsWith(suffix) &&
          other.localpart.length > AGENT_USERNAME_PREFIX.length + suffix.length
      );
      if (hasSiblingAgent) continue;
    }
    agents.push({
      userId: candidate.userId,
      agentName: candidate.agentName,
      displayName: candidate.displayName,
    });
  }

  return agents.sort((a, b) => a.agentName.localeCompare(b.agentName));
};

/** Joined MindRoom agents in a room on the viewer's homeserver, excluding the router owner ID. */
export const getRoomMindroomAgents = (mx: MatrixClient, roomId: string): RoomMindroomAgent[] => {
  const room = mx.getRoom(roomId);
  if (!room) return [];
  return resolveRoomAgents(room.getJoinedMembers(), mx.getUserId() ?? undefined);
};

/**
 * Finds the paired controller entry for an agent by exact Matrix user ID and, when provided,
 * matching allowed requester ID.
 */
export const findPairedController = (
  snapshot: DesktopAccessSnapshot | null,
  agentUserId: string,
  requesterId?: string
): DesktopAccessControllerConfig | undefined => {
  const controllers = snapshot?.status?.config.controllers ?? [];
  return controllers.find(
    (ctrl) =>
      ctrl.user_id === agentUserId &&
      (requesterId === undefined || ctrl.allowed_requester_ids.includes(requesterId))
  );
};

/** Whether a controller holds Full Access consent on this Mac. */
export const isControllerFullAccess = (
  snapshot: DesktopAccessSnapshot | null,
  controllerKey: string
): boolean => snapshot?.consent[controllerKey]?.mode === 'full';

const INVISIBLE_OR_CONTROL_RE = /^[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]$/u;

/**
 * Visibly escapes backslashes, control characters, tabs, CR, LF, ANSI escapes, and invisible
 * Unicode format/bidi/line/tag code points so shell commands and paths cannot disguise hidden text.
 */
export const escapeShellDisplay = (value: string): string => {
  let out = '';
  for (const ch of value) {
    if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (INVISIBLE_OR_CONTROL_RE.test(ch)) {
      const cp = ch.codePointAt(0) ?? 0;
      if (cp <= 0xff) out += `\\x${cp.toString(16).padStart(2, '0')}`;
      else if (cp <= 0xffff) out += `\\u${cp.toString(16).padStart(4, '0')}`;
      else out += `\\u{${cp.toString(16)}}`;
    } else {
      out += ch;
    }
  }
  return out;
};
