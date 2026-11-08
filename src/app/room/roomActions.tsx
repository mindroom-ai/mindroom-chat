import { lazy, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { Room } from 'matrix-js-sdk';
import { Icons, Spinner } from 'folds';
import { MenuEntry } from '../ui/MenuEntry';
import { MarkRoomReadMenuItem } from '../notifications/MarkRoomReadMenuItem';
import { RoomNotificationModeSwitcher } from '../notifications/RoomNotificationSwitcher';
import {
  getRoomNotificationMode,
  getRoomNotificationModeIcon,
  useRoomsNotificationPreferencesContext,
} from '../matrix/hooks/useRoomsNotificationPreferences';
import { ArchiveRoomMenuItem } from '../rooms/archive/ArchiveRoomMenuItem';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { usePowerLevels } from '../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../matrix/hooks/useRoomPermissions';
import { useStateEvent } from '../matrix/hooks/useStateEvent';
import { StateEvent } from '../matrix/types/room';
import { useOffersSubRooms, useParentRooms } from '../matrix/state/subRooms';
import { useListRoomsRefusal } from '../rooms/create/useListRoomsRefusal';
import { useOpenRoomSettings } from '../navigation/useRoomSettingsState';
import { getCanonicalAliasOrRoomId, isRoomAlias } from '../matrix/matrix';
import { getMatrixToRoom } from '../matrix/matrix-to';
import { getViaServers } from '../matrix/via-servers';
import { copyToClipboard } from '../lib/dom';
import { revealDirectionControls } from '../ui/directional';
import { getHomeSearchPath, getSpaceSearchPath, withSearchParam } from '../routes/pathUtils';

// Each room row has a menu: its dialogs load the first time someone opens one.
const InviteUserPrompt = lazy(() =>
  import('../members/invite/InviteUserPrompt').then((module) => ({
    default: module.InviteUserPrompt,
  }))
);
const JumpToTime = lazy(() =>
  import('../timeline/jump-to-time/JumpToTime').then((module) => ({ default: module.JumpToTime }))
);
const LeaveRoomPrompt = lazy(() =>
  import('../rooms/LeaveRoomPrompt').then((module) => ({ default: module.LeaveRoomPrompt }))
);
const CreateSubRoomDialog = lazy(() =>
  import('../rooms/create/CreateSubRoomDialog').then((module) => ({
    default: module.CreateSubRoomDialog,
  }))
);

/** A dialog an entry opens; it outlives the menu, and `close` ends it. */
export type RoomActionDialog = (close: () => void) => ReactNode;

/** What every entry of a room menu gets: the room, where the menu opened, and its controls. */
export type RoomActionProps = {
  room: Room;
  /** The space the room is listed or open in, which its settings and search stay in. */
  spaceId?: string;
  /** The thread open in the room (the room header's menu), which Jump to Time stays in. */
  threadId?: string;
  /** The side an entry's own menu opens on (the notification modes), away from the screen edge. */
  submenuSide: 'Left' | 'Right';
  /** Closes the room menu. */
  close: () => void;
  /** Shows a dialog, which stays after the menu has closed. */
  showDialog: (dialog: RoomActionDialog) => void;
  /** Called once the person has left the room from its menu. */
  onLeft?: () => void;
};

/**
 * One entry of the room menu. Its component draws the entry's row, or nothing for a room that
 * has no such action. An action the room has but the person cannot use here keeps its row,
 * disabled, and says why (`MenuEntry`'s `disabledReason`), so every room's menu has the same
 * shape.
 */
export type RoomAction = { id: string; Entry: ComponentType<RoomActionProps> };

function MarkReadEntry({ room, close }: RoomActionProps) {
  return <MarkRoomReadMenuItem room={room} onClose={close} />;
}

/** The room's notification mode, with its bell; it opens the mode menu beside the entry. */
function NotificationsEntry({ room, close, submenuSide }: RoomActionProps) {
  const { t } = useTranslation();
  const mode = getRoomNotificationMode(useRoomsNotificationPreferencesContext(), room.roomId);
  return (
    <RoomNotificationModeSwitcher
      roomId={room.roomId}
      value={mode}
      onChange={close}
      side={submenuSide}
    >
      {(handleOpen, opened, changing) => (
        <MenuEntry
          label={t('mindroomUi.threads.mindroomRoomViewHeader.notifications')}
          icon={getRoomNotificationModeIcon(mode)}
          after={changing ? <Spinner size="100" variant="Secondary" /> : undefined}
          fill={opened ? 'Soft' : 'None'}
          aria-haspopup="menu"
          aria-expanded={opened}
          onSelect={handleOpen}
        />
      )}
    </RoomNotificationModeSwitcher>
  );
}

function InviteEntry({ room, close, showDialog }: RoomActionProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const permissions = useRoomPermissions(useRoomCreators(room), usePowerLevels(room));
  const allowed = permissions.action('invite', client.getSafeUserId());
  return (
    <MenuEntry
      icon={Icons.UserPlus}
      label={t('mindroomUi.threads.mindroomRoomViewHeader.invite')}
      disabledReason={allowed ? undefined : t('featureUi.roomActions.noInvitePermission')}
      onSelect={() => {
        close();
        showDialog((done) => <InviteUserPrompt room={room} requestClose={done} />);
      }}
    />
  );
}

/** Opens New Sub-room in a room that takes sub-rooms. */
function NewSubRoomEntry({ room, spaceId, close, showDialog }: RoomActionProps) {
  const { t } = useTranslation();
  const refusal = useListRoomsRefusal(room);
  const offered = useOffersSubRooms(room);
  if (!offered) return null;
  return (
    <MenuEntry
      icon={Icons.Plus}
      label={t('featureUi.subRooms.newSubRoom')}
      disabledReason={refusal}
      onSelect={() => {
        close();
        showDialog((done) => (
          <CreateSubRoomDialog parent={room} spaceId={spaceId} requestClose={done} />
        ));
      }}
    />
  );
}

/**
 * Takes the room off the list of a chat room it is a sub-room of: an empty `m.space.child` there.
 * The room keeps naming that room as its parent, which MindRoom's agents read to leave it.
 */
function TakeOffParentEntry({
  room,
  parent,
  close,
}: {
  room: Room;
  parent: Room;
  close: () => void;
}) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const refusal = useListRoomsRefusal(parent);
  return (
    <MenuEntry
      icon={Icons.ArrowGoLeft}
      directional
      label={t('featureUi.subRooms.takeOff', { name: revealDirectionControls(parent.name) })}
      disabledReason={refusal}
      onSelect={() => {
        close();
        void client.sendStateEvent(
          parent.roomId,
          StateEvent.SpaceChild as never,
          {} as never,
          room.roomId
        );
      }}
    />
  );
}

/** Remove from, for each chat room the room is a sub-room of. */
function TakeOffEntry({ room, close }: RoomActionProps) {
  return (
    <>
      {useParentRooms(room).map((parent) => (
        <TakeOffParentEntry key={parent.roomId} room={room} parent={parent} close={close} />
      ))}
    </>
  );
}

/** A matrix.to link, which opens the room in any Matrix client. */
function CopyLinkEntry({ room, close }: RoomActionProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const copy = () => {
    const target = getCanonicalAliasOrRoomId(client, room.roomId);
    const via = isRoomAlias(target) ? undefined : getViaServers(room);
    void copyToClipboard(getMatrixToRoom(target, via));
  };
  return (
    <MenuEntry
      icon={Icons.Link}
      label={t('mindroomUi.threads.mindroomRoomViewHeader.copyLink')}
      onSelect={() => {
        close();
        copy();
      }}
    />
  );
}

function SettingsEntry({ room, spaceId, close }: RoomActionProps) {
  const { t } = useTranslation();
  const openRoomSettings = useOpenRoomSettings();
  return (
    <MenuEntry
      icon={Icons.Setting}
      label={t('mindroomUi.threads.mindroomRoomViewHeader.roomSettings')}
      onSelect={() => {
        close();
        openRoomSettings(room.roomId, spaceId);
      }}
    />
  );
}

/** Searches the room's messages; the server cannot read an encrypted room's. */
function SearchEntry({ room, spaceId, close }: RoomActionProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const navigate = useNavigate();
  const encrypted = useStateEvent(room, StateEvent.RoomEncryption) !== undefined;
  const search = () => {
    const searchPath = spaceId
      ? getSpaceSearchPath(getCanonicalAliasOrRoomId(client, spaceId))
      : getHomeSearchPath();
    navigate(withSearchParam(searchPath, { rooms: room.roomId }));
  };
  return (
    <MenuEntry
      icon={Icons.Search}
      label={t('nav.messageSearch')}
      disabledReason={encrypted ? t('featureUi.roomActions.searchEncrypted') : undefined}
      onSelect={() => {
        close();
        search();
      }}
    />
  );
}

function JumpToTimeEntry({ room, threadId, close, showDialog }: RoomActionProps) {
  const { t } = useTranslation();
  return (
    <MenuEntry
      icon={Icons.RecentClock}
      label={t('featureUi.room.jumpToTime.jumpToTime')}
      onSelect={() => {
        close();
        showDialog((done) => <JumpToTime room={room} threadId={threadId} requestClose={done} />);
      }}
    />
  );
}

function ArchiveEntry({ room, close }: RoomActionProps) {
  return <ArchiveRoomMenuItem room={room} onClose={close} />;
}

function LeaveEntry({ room, close, showDialog, onLeft }: RoomActionProps) {
  const { t } = useTranslation();
  return (
    <MenuEntry
      critical
      directional
      icon={Icons.ArrowGoLeft}
      label={t('mindroomUi.threads.mindroomRoomViewHeader.leaveRoom')}
      onSelect={() => {
        close();
        showDialog((done) => (
          <LeaveRoomPrompt
            roomId={room.roomId}
            requestClose={done}
            onLeft={() => {
              done();
              onLeft?.();
            }}
          />
        ));
      }}
    />
  );
}

/**
 * Every room menu's entries, in groups that a line divides. The room's sidebar row (its More
 * Options button, and a right-click or a long press that fires one) and the open room's header
 * show these, in this order; an entry added here appears in each of them. The header's menu puts
 * what only works inside the open room in a section of its own, before these.
 */
export const ROOM_ACTIONS: readonly (readonly RoomAction[])[] = [
  [
    { id: 'markRead', Entry: MarkReadEntry },
    { id: 'notifications', Entry: NotificationsEntry },
    { id: 'invite', Entry: InviteEntry },
    { id: 'newSubRoom', Entry: NewSubRoomEntry },
    { id: 'copyLink', Entry: CopyLinkEntry },
    { id: 'settings', Entry: SettingsEntry },
    { id: 'search', Entry: SearchEntry },
    { id: 'jumpToTime', Entry: JumpToTimeEntry },
  ],
  [
    { id: 'takeOff', Entry: TakeOffEntry },
    { id: 'archive', Entry: ArchiveEntry },
    { id: 'leave', Entry: LeaveEntry },
  ],
];
