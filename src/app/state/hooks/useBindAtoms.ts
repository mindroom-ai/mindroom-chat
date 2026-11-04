import type { MatrixClient } from 'matrix-js-sdk';
import { useBindLiveReplyFrames } from '../../mindroom/live/bindLiveReplyFrames';
import { useBindArchivedRoomsAtom } from '../../mindroom/rooms/archivedRooms';
import { useModelControllerLifetime } from '../../mindroom/models/useModelPicker';
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
  // Archived rooms are left out of every list, so they are seeded behind the same gate.
  useBindArchivedRoomsAtom(client);
  // Live per-room state.
  useBindRoomIdToTypingMembersAtom(client, roomIdToTypingMembersAtom);
  useBindRoomToUnreadAtom(client, roomToUnreadAtom);
  // Agents' live reply frames, kept for any room, so a reply streams wherever it is opened.
  useBindLiveReplyFrames(client);
  // The model picker's owner listens from the start, instead of from the first thread that shows
  // a model chip; it reads the same client from MatrixClientProvider.
  useModelControllerLifetime();
}
