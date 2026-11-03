import type { MatrixClient } from 'matrix-js-sdk';
import { mDirectAtom, useBindMDirectAtom } from '../mDirectList';
import { allInvitesAtom, useBindAllInvitesAtom } from '../room-list/inviteList';
import { allRoomsAtom, useBindAllRoomsAtom } from '../room-list/roomList';
import { roomToParentsAtom, useBindRoomToParentsAtom } from '../room/roomToParents';
import { roomToUnreadAtom, useBindRoomToUnreadAtom } from '../room/roomToUnread';
import { roomIdToTypingMembersAtom, useBindRoomIdToTypingMembersAtom } from '../typingMembers';

/** Connects the account-wide atoms to the Matrix client; each resets for a new client. */
export function useBindAtoms(mx: MatrixClient): void {
  // Room lists come first: the sidebar and the unread counts start from them.








}
