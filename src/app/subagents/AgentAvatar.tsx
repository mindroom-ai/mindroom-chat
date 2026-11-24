import type { Room } from 'matrix-js-sdk';
import { Avatar, Text } from 'folds';
import { agentMember } from '../approvals/approvalPeople';
import { UserAvatar } from '../avatars/UserAvatar';
import { nameInitials } from '../lib/common';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { mxcUrlToHttp } from '../matrix/matrix';
import { getMemberAvatarMxc, getMemberDisplayName } from '../matrix/room';

/** Pictures show at most 28 px wide; twice that keeps them sharp on dense screens. */
const PICTURE_SIZE = 56;

export type AgentProfile = { name: string; colorId: string; avatarSrc?: string };

/**
 * The name and picture of the agent MindRoom calls `agent`: those of its account in the room
 * (`mindroom_<agent>`, or `mindroom_<agent>_<namespace>`), or the name itself.
 */
export const useAgentProfile = (room: Room, agent: string): AgentProfile => {
  // matrix-js-sdk mutates Room's member table in place when loadMembersIfNeeded resolves;
  // memoizing on room reference freezes pre-load fallback names and avatars.
  'use no memo';
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const userId = agentMember(room, agent)?.userId;
  if (!userId) return { name: agent, colorId: agent };
  const picture = getMemberAvatarMxc(room, userId);
  const src = picture
    ? mxcUrlToHttp(mx, picture, useAuthentication, PICTURE_SIZE, PICTURE_SIZE, 'crop')
    : null;
  return {
    name: getMemberDisplayName(room, userId) ?? agent,
    colorId: userId,
    avatarSrc: src ?? undefined,
  };
};

/** The agent's picture, or its initials: small on a card, as a thread card's people; a message's size in a run. */
export function AgentAvatar({ agent, size }: { agent: AgentProfile; size: '200' | '300' }) {
  return (
    <Avatar size={size} radii={size === '200' ? '400' : undefined} aria-hidden>
      <UserAvatar
        alt=""
        userId={agent.colorId}
        src={agent.avatarSrc}
        renderFallback={() => (
          <Text as="span" size={size === '200' ? 'L400' : 'H6'}>
            {nameInitials(agent.name)}
          </Text>
        )}
      />
    </Avatar>
  );
}
