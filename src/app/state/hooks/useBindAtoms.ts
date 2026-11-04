import type { MatrixClient } from 'matrix-js-sdk';
import { useBindLiveReplyFrames } from '../../mindroom/live/bindLiveReplyFrames';
import { mDirectAtom, useBindMDirectAtom } from '../mDirectList';
import { allInvitesAtom, useBindAllInvitesAtom } from '../room-list/inviteList';
import { allRoomsAtom, useBindAllRoomsAtom } from '../room-list/roomList';
import { roomToParentsAtom, useBindRoomToParentsAtom } from '../room/roomToParents';
import { roomToUnreadAtom, useBindRoomToUnreadAtom } from '../room/roomToUnread';
import { roomIdToTypingMembersAtom, useBindRoomIdToTypingMembersAtom } from '../typingMembers';

/** Connects the account-wide atoms to the Matrix client; each resets for a new client. */
export function useBindAtoms(client: MatrixClient): void {
  // Room lists come first: the sidebar and the unread counts start from them.
  useBindAllRoomsAtom(client, allRoomsAtom);
  useBindAllInvitesAtom(client, allInvitesAtom);
  // Direct chats and the space tree decide where each room is listed.
  useBindMDirectAtom(client, mDirectAtom);
  useBindRoomToParentsAtom(client, roomToParentsAtom);
  // Live per-room state.
  useBindRoomIdToTypingMembersAtom(client, roomIdToTypingMembersAtom);
  useBindRoomToUnreadAtom(client, roomToUnreadAtom);
  // Agents' live reply frames, kept for any room, so a reply streams wherever it is opened.
  useBindLiveReplyFrames(client);
}
