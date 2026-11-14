import type { PrimitiveAtom, useStore } from 'jotai';
import { forgetCallState } from '../calls/callStore';
import { agentCallFailureAtom } from '../calls/agent/agentCaller';
import { focusHandOffAtom } from '../calls/window/callWindowState';
import {
  callTranscriptionAtom,
  liveTranscriptAtom,
  pauseRequestAtom,
} from '../calls/transcription/transcriptionState';
import { transcriptPanelAtom } from '../calls/transcription/transcriptPanel';
import { commandPaletteOpenAtom } from '../command-palette/commandPaletteState';
import { shortcutHelpOpenAtom } from '../navigation/shortcutHelpState';
import { subagentsPanelAtom } from '../navigation/subagentsPanel';
import {
  crossRoomThreadIndexAtom,
  emptyCrossRoomThreadIndexSnapshot,
} from '../threads/cross-room/crossRoomThreadIndex';
import { archivedRoomsAtom } from '../matrix/state/archivedRooms';
import { replacedRoomsAtom } from '../matrix/state/replacedRooms';
import { accountSettingsAtom } from '../matrix/hooks/useAccountSettings';
import {
  pendingRoamingSettingsAtom,
  roamingAccountContentAtom,
} from '../preferences/roamingSettings';
import { lastExitedThreadAtom } from '../threads/lastExitedThread';
import { createRoomModalAtom } from '../navigation/createRoomModal';
import { createSpaceModalAtom } from '../navigation/createSpaceModal';
import { imageViewerOpenAtom } from '../navigation/imageViewerState';
import {
  phoneNavDrawerOpenAtom,
  phoneNavSectionRootAtom,
  phoneNavSlotAtom,
  phoneSheetOpenAtom,
  phoneSheetSlotAtom,
} from '../navigation/phoneNavDrawer';
import {
  conversationBehindPanelAtom,
  conversationCoveredAtom,
  conversationUnderThreadAtom,
} from '../navigation/conversationCover';
import { listNoticeSlotAtom, pageNoticeSlotAtom } from '../ui/noticeSlots';
import { mDirectAtom } from '../matrix/state/mDirectList';
import { allInvitesAtom } from '../matrix/state/inviteList';
import {
  activityRowsAtom,
  activityShowAutomationsAtom,
  activityUnreadOnlyAtom,
} from '../activity/activityState';
import { allRoomsAtom } from '../matrix/state/roomList';
import { forgetComposerStateOfSession } from '../composer/roomInputDrafts';
import { roomToParentsAtom } from '../matrix/state/roomToParents';
import { roomToUnreadAtom } from '../matrix/state/roomToUnread';
import { roomSettingsAtom } from '../navigation/roomSettingsState';
import { recoveryDialogAtom } from '../account/encryption/recoveryDialog';
import { settingsModalAtom } from '../navigation/settingsModal';
import { roomIdToTypingMembersAtom } from '../matrix/state/typingMembers';
import { userDirectoryCacheAtom } from '../members/userDirectoryCache';
import { userRoomProfileAtom } from '../navigation/userRoomProfile';

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
  (store) => store.set(replacedRoomsAtom, new Set<string>()),
  (store) => store.set(roomIdToTypingMembersAtom, { type: 'RESET' }),
  (store) => store.set(roomToUnreadAtom, { type: 'RESET', unreadInfos: [] }),
  toInitial(accountSettingsAtom),
  toInitial(roamingAccountContentAtom),
  toInitial(pendingRoamingSettingsAtom),
  // Built by the pages from the account's rooms and people.
  (store) => store.set(crossRoomThreadIndexAtom, emptyCrossRoomThreadIndexSnapshot()),
  toInitial(activityRowsAtom),
  toInitial(activityUnreadOnlyAtom),
  toInitial(activityShowAutomationsAtom),
  toInitial(userDirectoryCacheAtom),
  toInitial(lastExitedThreadAtom),
  // What the person was doing: composer replies and staged files, the call and its panel (and the
  // focus Dock or Float hands its view), its transcription, Pause and live transcript panel, the
  // Sub-agents panel, why an agent call did not start, and the dialogs and overlays open.
  forgetComposerStateOfSession,
  forgetCallState,
  toInitial(focusHandOffAtom),
  toInitial(callTranscriptionAtom),
  toInitial(liveTranscriptAtom),
  toInitial(pauseRequestAtom),
  toInitial(transcriptPanelAtom),
  toInitial(subagentsPanelAtom),
  toInitial(agentCallFailureAtom),
  toInitial(settingsModalAtom),
  toInitial(recoveryDialogAtom),
  toInitial(roomSettingsAtom),
  toInitial(createRoomModalAtom),
  toInitial(createSpaceModalAtom),
  toInitial(userRoomProfileAtom),
  toInitial(commandPaletteOpenAtom),
  toInitial(shortcutHelpOpenAtom),
  toInitial(imageViewerOpenAtom),
  toInitial(phoneNavDrawerOpenAtom),
  toInitial(phoneNavSlotAtom),
  toInitial(phoneNavSectionRootAtom),
  toInitial(phoneSheetSlotAtom),
  toInitial(phoneSheetOpenAtom),
  toInitial(conversationCoveredAtom),
  toInitial(conversationBehindPanelAtom),
  toInitial(conversationUnderThreadAtom),
  toInitial(listNoticeSlotAtom),
  toInitial(pageNoticeSlotAtom),
];

/** Forgets everything {@link ACCOUNT_STATE} lists. */
export const forgetAccountState = (store: Store): void => {
  ACCOUNT_STATE.forEach((forget) => forget(store));
};
