import type { PrimitiveAtom, useStore } from 'jotai';
import { forgetCallState } from '../../features/calls/callStore';
import { agentCallFailureAtom } from '../../mindroom/calls/agentCaller';
import { commandPaletteOpenAtom } from '../../mindroom/command-palette/commandPaletteState';
import {
  crossRoomThreadIndexAtom,
  emptyCrossRoomThreadIndexSnapshot,
} from '../../mindroom/cross-room-threads/crossRoomThreadIndex';
import { archivedRoomsAtom } from '../../mindroom/rooms/archivedRooms';
import { mindroomAccountSettingsAtom } from '../../mindroom/settings/useMindroomAccountSettings';
import { lastExitedThreadAtom } from '../../mindroom/threads/lastExitedThread';
import { createRoomModalAtom } from '../../state/createRoomModal';
import { createSpaceModalAtom } from '../../state/createSpaceModal';
import { imageViewerOpenAtom } from '../../state/imageViewer';
import { mDirectAtom } from '../../state/mDirectList';
import { allInvitesAtom } from '../../state/room-list/inviteList';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { forgetComposerStateOfSession } from '../../state/room/roomInputDrafts';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { roomSettingsAtom } from '../../state/roomSettings';
import { settingsModalAtom } from '../../state/settingsModal';
import { spaceSettingsAtom } from '../../state/spaceSettings';
import { roomIdToTypingMembersAtom } from '../../state/typingMembers';
import { userDirectoryCacheAtom } from '../../state/userDirectoryCache';
import { userRoomProfileAtom } from '../../state/userRoomProfile';

type Store = ReturnType<typeof useStore>;

/** Forgets one thing an account left in the app-wide store. */
type Forget = (store: Store) => void;

/** Puts an atom back to the value it started with. */
const toInitial =
  <Value>(atom: PrimitiveAtom<Value> & { init: Value }): Forget =>
  (store) =>
    store.set(atom, atom.init);

/**
 * Everything the signed-in pages keep for one account in the app-wide jotai store, outside its
 * Matrix client. `ClientBindAtoms` forgets all of it when the account's pages go (sign-out,
 * switch, a startup failure), so the next account never starts from what this one left; what the
 * client feeds is seeded again for the next client before its pages render.
 *
 * A new atom at module level is either listed here or device-wide or keyed by account; the test
 * beside this file fails for one that is neither, and names each kept atom with its reason. The
 * cached queries and secret storage keys belong to the client and go in `ClientSession`.
 */
const ACCOUNT_STATE: readonly Forget[] = [
  // Fed by the client (`useBindAtoms`).
  (store) => store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [] }),
  (store) => store.set(allInvitesAtom, { type: 'INITIALIZE', rooms: [] }),
  (store) => store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set<string>() }),
  (store) => store.set(roomToParentsAtom, { type: 'INITIALIZE', roomToParents: new Map() }),
  (store) => store.set(archivedRoomsAtom, new Set<string>()),
  (store) => store.set(roomIdToTypingMembersAtom, { type: 'RESET' }),
  (store) => store.set(roomToUnreadAtom, { type: 'RESET', unreadInfos: [] }),
  toInitial(mindroomAccountSettingsAtom),
  // Built by the pages from the account's rooms and people.
  (store) => store.set(crossRoomThreadIndexAtom, emptyCrossRoomThreadIndexSnapshot()),
  toInitial(userDirectoryCacheAtom),
  toInitial(lastExitedThreadAtom),
  // What the person was doing: composer replies and staged files, the call and its panel, why an
  // agent call did not start, and the dialogs and overlays open.
  forgetComposerStateOfSession,
  forgetCallState,
  toInitial(agentCallFailureAtom),
  toInitial(settingsModalAtom),
  toInitial(roomSettingsAtom),
  toInitial(spaceSettingsAtom),
  toInitial(createRoomModalAtom),
  toInitial(createSpaceModalAtom),
  toInitial(userRoomProfileAtom),
  toInitial(commandPaletteOpenAtom),
  toInitial(imageViewerOpenAtom),
];

/** Forgets everything {@link ACCOUNT_STATE} lists. */
export const forgetAccountState = (store: Store): void => {
  ACCOUNT_STATE.forEach((forget) => forget(store));
};
