import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { agentMember } from '../matrix/protocol/agentIdentity';
import { getMxIdLocalPart } from '../matrix/matrix';
import { useThreadApprovals } from './ThreadApprovalProvider';
import { isolateInSentence } from '../ui/directional';

type ApprovalMember = { userId: string; name?: string; getMxcAvatarUrl?: () => string | undefined };

export type ApprovalMemberRoom = {
  getMember: (userId: string) => { name?: string } | null;
  getJoinedMembers: () => ApprovalMember[];
};

/** The room an approval belongs to, for resolving people and agents to display names. */
export const useApprovalRoom = (roomId?: string): ApprovalMemberRoom | null | undefined => {
  const mx = useMatrixClient();
  const context = useThreadApprovals();
  const id = roomId ?? context?.roomId;
  return id ? (mx.getRoom?.(id) as ApprovalMemberRoom | null | undefined) : undefined;
};

export { agentMember };

export const agentDisplayName = (
  room: ApprovalMemberRoom | null | undefined,
  agentName: string
): string => isolateInSentence(agentMember(room, agentName)?.name || agentName);

export const userDisplayName = (
  room: ApprovalMemberRoom | null | undefined,
  userId: string
): string => isolateInSentence(room?.getMember(userId)?.name || getMxIdLocalPart(userId) || userId);
