import { useCallback } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
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

/** Joined MindRoom agents in a room on the viewer's homeserver, excluding the router owner ID. */
export const getRoomMindroomAgents = (mx: MatrixClient, roomId: string): RoomMindroomAgent[] => {
  const room = mx.getRoom(roomId);
  const viewerUserId = mx.getUserId() ?? undefined;
  if (!room) return [];

  const seen = new Set<string>();
  const agents: RoomMindroomAgent[] = [];
  for (const member of room.getJoinedMembers()) {
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
    const agentName = extractAgentName(userId);
    agents.push({
      userId,
      agentName,
      displayName: member.name || agentName,
    });
  }
  return agents.sort((a, b) => a.agentName.localeCompare(b.agentName));
};

/** Finds the paired controller entry for an agent, matching by user ID first or agent name. */
export const findPairedController = (
  snapshot: DesktopAccessSnapshot | null,
  agentUserId: string,
  agentName: string
): DesktopAccessControllerConfig | undefined => {
  const controllers = snapshot?.status?.config.controllers ?? [];
  return (
    controllers.find((ctrl) => ctrl.user_id === agentUserId) ??
    controllers.find((ctrl) => ctrl.allowed_agent_names.includes(agentName))
  );
};

/** Whether a controller holds Full Access consent on this Mac. */
export const isControllerFullAccess = (
  snapshot: DesktopAccessSnapshot | null,
  controllerKey: string
): boolean => snapshot?.consent[controllerKey]?.mode === 'full';

const BIDI_OR_INVISIBLE_CODES = new Set([
  0x061c, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d,
  0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff,
]);

/**
 * Visibly escapes control characters, tabs, CR, LF, ANSI escapes, and invisible bidi/format code
 * points so shell commands and paths cannot disguise hidden text.
 */
export const escapeShellDisplay = (value: string): string => {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0x0a) out += '\\n';
    else if (code === 0x0d) out += '\\r';
    else if (code === 0x09) out += '\\t';
    else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      out += `\\x${code.toString(16).padStart(2, '0')}`;
    } else if (BIDI_OR_INVISIBLE_CODES.has(code)) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else {
      out += value[i] ?? '';
    }
  }
  return out;
};
