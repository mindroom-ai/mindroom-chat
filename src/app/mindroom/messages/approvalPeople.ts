import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getMxIdLocalPart } from '../../utils/matrix';
import { useThreadApprovals } from './ThreadApprovalProvider';

export type ApprovalMemberRoom = {
  getMember: (userId: string) => { name?: string } | null;
  getJoinedMembers: () => { userId: string; name?: string }[];
};

/** The room an approval belongs to, for resolving people and agents to display names. */
export const useApprovalRoom = (roomId?: string): ApprovalMemberRoom | null | undefined => {
  const mx = useMatrixClient();
  const context = useThreadApprovals();
  const id = roomId ?? context?.roomId;
  return id ? (mx.getRoom?.(id) as ApprovalMemberRoom | null | undefined) : undefined;
};

// MindRoom names agent accounts mindroom_<agent>, optionally followed by a namespace.
export const agentDisplayName = (
  room: ApprovalMemberRoom | null | undefined,
  agentName: string
): string => {
  const prefix = `mindroom_${agentName.toLowerCase()}`;
  const member = room
    ?.getJoinedMembers()
    .find((item) => (getMxIdLocalPart(item.userId) ?? '').toLowerCase().startsWith(prefix));
  return member?.name || agentName;
};

export const userDisplayName = (
  room: ApprovalMemberRoom | null | undefined,
  userId: string
): string => room?.getMember(userId)?.name || getMxIdLocalPart(userId) || userId;
