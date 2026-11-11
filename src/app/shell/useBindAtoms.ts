import type { MatrixClient } from 'matrix-js-sdk';
import { useBindLiveReplyFrames } from '../messages/live/bindLiveReplyFrames';
import { useBindSubagentFrames } from '../messages/live/bindSubagentFrames';
import { useBindArchivedRoomsAtom } from '../matrix/state/archivedRooms';
import { useBindReplacedRoomsAtom } from '../matrix/state/replacedRooms';
import { useModelControllerLifetime } from '../models/useModelPicker';
import { useBindAccountSettings } from '../matrix/hooks/useAccountSettings';
import { useBindRoamingSettings } from '../matrix/hooks/useBindRoamingSettings';
import { mDirectAtom, useBindMDirectAtom } from '../matrix/state/mDirectList';
import { allInvitesAtom, useBindAllInvitesAtom } from '../matrix/state/inviteList';
import { allRoomsAtom, useBindAllRoomsAtom } from '../matrix/state/roomList';
import { roomToParentsAtom, useBindRoomToParentsAtom } from '../matrix/state/roomToParents';
import { roomToUnreadAtom, useBindRoomToUnreadAtom } from '../matrix/state/roomToUnread';
import { roomIdToTypingMembersAtom, useBindRoomIdToTypingMembersAtom } from '../matrix/state/typingMembers';

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
  // So are rooms upgraded into one the account has joined.
  useBindReplacedRoomsAtom(client);
  // The account's `io.mindroom.settings`, which the first render of the pages already reads.
  useBindAccountSettings(client);
  // The app settings that follow the account (`io.mindroom.client.settings`), and the edits of
  // this device that the homeserver does not have yet; the first render reads them too.
  useBindRoamingSettings(client);
  // Live per-room state.
  useBindRoomIdToTypingMembersAtom(client, roomIdToTypingMembersAtom);
  useBindRoomToUnreadAtom(client, roomToUnreadAtom);
  // Agents' live reply frames, kept for any room, so a reply streams wherever it is opened.
  useBindLiveReplyFrames(client);
  // Agents' sub-agent runs, kept per room the same way, so a room's runs show as soon as it opens.
  useBindSubagentFrames(client);
  // The model picker's owner listens from the start, instead of from the first thread that shows
  // a model chip; it reads the same client from MatrixClientProvider.
  useModelControllerLifetime();
}
