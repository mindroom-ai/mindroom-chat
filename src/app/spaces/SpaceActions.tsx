import { Fragment, type ReactNode, Suspense, lazy, useCallback, useState } from 'react';
import { Icons, Line } from 'folds';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { copyToClipboard } from '../lib/dom';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { usePowerLevels } from '../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../matrix/hooks/useRoomPermissions';
import { getCanonicalAliasOrRoomId } from '../matrix/matrix';
import { getMatrixToRoom } from '../matrix/matrix-to';
import { getViaServers } from '../matrix/via-servers';
import { StateEvent } from '../matrix/types/room';
import { useOpenCreateRoomModal } from '../navigation/useCreateRoomModal';
import { useOpenCreateSpaceModal } from '../navigation/useCreateSpaceModal';
import { useOpenRoomSettings } from '../navigation/useRoomSettingsState';
import { getSpaceLobbyPath } from '../routes/pathUtils';
import { MenuEntry, MenuGroup } from '../ui/MenuEntry';
import { revealDirectionControls } from '../ui/directional';
import { removeSpaceChild } from './lobby/spaceChildren';
import {
  isSpaceInSidebar,
  pinSpaceToSidebar,
  unpinSpaceFromSidebar,
  useSavedSidebarItems,
  useTopLevelSpaceIds,
} from './sidebarSpaces';

const AddExistingModal = lazy(() =>
  import('./AddExistingModal').then((module) => ({ default: module.AddExistingModal }))
);

const InviteUserPrompt = lazy(() =>
  import('../members/invite/InviteUserPrompt').then((module) => ({
    default: module.InviteUserPrompt,
  }))
);

const LeaveRoomPrompt = lazy(() =>
  import('../rooms/LeaveRoomPrompt').then((module) => ({
    default: module.LeaveRoomPrompt,
  }))
);

/**
 * A matrix.to link that opens the space in any Matrix client: by its canonical alias when it has
 * one, else by its ID with the servers that can route to it.
 */
export const getSpaceShareLink = (client: MatrixClient, space: Room): string => {
  const idOrAlias = getCanonicalAliasOrRoomId(client, space.roomId);
  return getMatrixToRoom(idOrAlias, idOrAlias.startsWith('#') ? undefined : getViaServers(space));
};

export type SpaceQuickPermissions = {
  /** Whether the user can add or remove children (`m.space.child`) on this space. */
  canAdd: boolean;
  /** Whether the user can invite members to this space. */
  canInvite: boolean;
};

/** Reactive quick-action permissions for a space (adding children and inviting members). */
export const useSpaceQuickPermissions = (space: Room): SpaceQuickPermissions => {
  const client = useMatrixClient();
  const permissions = useRoomPermissions(useRoomCreators(space), usePowerLevels(space));
  const userId = client.getUserId() ?? '';
  return {
    canAdd: permissions.stateEvent(StateEvent.SpaceChild, userId),
    canInvite: permissions.action('invite', userId),
  };
};

type SpaceQuickDialog = 'addRooms' | 'addSpaces' | 'invite' | 'leave';

export type SpaceQuickDialogHandlers = {
  openAddRooms: () => void;
  openAddSpaces: () => void;
  openInvite: () => void;
  openLeave: () => void;
};

export type SpaceQuickDialogs = SpaceQuickDialogHandlers & {
  /** Single lazy-mounted dialog node to render outside any popover or menu. */
  dialog: ReactNode;
};

/**
 * Manages one active quick-action dialog for `space` (add existing rooms/sub-spaces, invite, or
 * leave), rendered outside popovers so closing a menu keeps the dialog alive.
 */
export const useSpaceQuickDialogs = (
  space: Room,
  options?: { onLeft?: () => void }
): SpaceQuickDialogs => {
  const [active, setActive] = useState<SpaceQuickDialog>();
  const close = useCallback(() => setActive(undefined), []);
  const openAddRooms = useCallback(() => setActive('addRooms'), []);
  const openAddSpaces = useCallback(() => setActive('addSpaces'), []);
  const openInvite = useCallback(() => setActive('invite'), []);
  const openLeave = useCallback(() => setActive('leave'), []);

  const onLeft = options?.onLeft;
  const dialog = active ? (
    <Suspense fallback={null}>
      {active === 'addRooms' && (
        <AddExistingModal kind="rooms" into={space.roomId} requestClose={close} />
      )}
      {active === 'addSpaces' && (
        <AddExistingModal kind="spaces" into={space.roomId} requestClose={close} />
      )}
      {active === 'invite' && <InviteUserPrompt room={space} requestClose={close} />}
      {active === 'leave' && (
        <LeaveRoomPrompt
          roomId={space.roomId}
          requestClose={close}
          onLeft={() => {
            close();
            onLeft?.();
          }}
        />
      )}
    </Suspense>
  ) : null;

  return { dialog, openAddRooms, openAddSpaces, openInvite, openLeave };
};

export type SpaceAddMenuEntriesProps = {
  spaceId: string;
  onClose: () => void;
  onAddRooms: () => void;
  onAddSpaces?: () => void;
  /** Render only the two room entries (used by the root Rooms section `+` button). */
  roomsOnly?: boolean;
};

/** Menu entries for creating or adding existing rooms (and optionally sub-spaces) into a space. */
export function SpaceAddMenuEntries({
  spaceId,
  onClose,
  onAddRooms,
  onAddSpaces,
  roomsOnly = false,
}: SpaceAddMenuEntriesProps) {
  const { t } = useTranslation();
  const openCreateRoom = useOpenCreateRoomModal();
  const openCreateSpace = useOpenCreateSpaceModal();

  return (
    <>
      <MenuEntry
        label={t('featureUi.spaceNav.newRoom')}
        icon={Icons.HashPlus}
        onSelect={() => {
          onClose();
          openCreateRoom(spaceId);
        }}
      />
      <MenuEntry
        label={t('featureUi.spaceNav.addExistingRoom')}
        icon={Icons.Hash}
        onSelect={() => {
          onClose();
          onAddRooms();
        }}
      />
      {!roomsOnly && (
        <>
          <MenuEntry
            label={t('featureUi.spaceNav.newSubspace')}
            icon={Icons.SpacePlus}
            onSelect={() => {
              onClose();
              openCreateSpace(spaceId);
            }}
          />
          <MenuEntry
            label={t('featureUi.spaceNav.addExistingSubspace')}
            icon={Icons.Space}
            onSelect={() => {
              onClose();
              onAddSpaces?.();
            }}
          />
        </>
      )}
    </>
  );
}

/** Pin/Unpin sidebar toggle for a sub-space; mounts only while its menu is open. */
function PinToggleMenuEntry({ spaceId, onClose }: { spaceId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const savedItems = useSavedSidebarItems();
  const topLevelSpaces = useTopLevelSpaceIds();
  const pinned = isSpaceInSidebar(savedItems, spaceId);

  return (
    <MenuEntry
      label={
        pinned
          ? t('featureUi.lobby.hierarchyItemMenu.unpinFromSidebar')
          : t('featureUi.lobby.hierarchyItemMenu.pinToSidebar')
      }
      icon={Icons.Pin}
      onSelect={() => {
        onClose();
        if (pinned) void unpinSpaceFromSidebar(client, spaceId);
        else void pinSpaceToSidebar(client, spaceId, topLevelSpaces);
      }}
    />
  );
}

export type SpaceMenuGroupsProps = {
  space: Room;
  permissions: SpaceQuickPermissions;
  dialogs: SpaceQuickDialogHandlers;
  onClose: () => void;
  /** Include the Add group when the user can add children (defaults to `true`). */
  showAdd?: boolean;
  /** Caller-specific entries placed at the top of the main group (e.g. Mark as Read, Sort A-Z). */
  beforeMain?: ReactNode;
  /** Include a `Space overview` entry navigating directly to the space lobby. */
  showOverview?: boolean;
  /**
   * Optional sidebar pin action in the main group:
   * - `'toggle'` shows Pin to Sidebar / Unpin from Sidebar (sub-space sections)
   * - `'unpin'` shows Unpin (a pinned sub-space tab on the left rail)
   */
  pinMode?: 'toggle' | 'unpin';
  /** When set, includes `Remove from {{parentName}}` targeting the immediate parent space. */
  removeFromParent?: {
    parentSpaceId: string;
    parentName: string;
  };
};

/**
 * Composes grouped menu sections for a space (Add, Main, Destructive), inserting `<Line />`
 * dividers only between non-empty groups.
 */
export function SpaceMenuGroups({
  space,
  permissions,
  dialogs,
  onClose,
  showAdd = true,
  beforeMain,
  showOverview = false,
  pinMode,
  removeFromParent,
}: SpaceMenuGroupsProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const navigate = useNavigate();
  const openSpaceSettings = useOpenRoomSettings();

  const groups: Array<{ key: string; content: ReactNode }> = [];
  if (showAdd && permissions.canAdd) {
    groups.push({
      key: 'add',
      content: (
        <MenuGroup>
          <SpaceAddMenuEntries
            spaceId={space.roomId}
            onClose={onClose}
            onAddRooms={dialogs.openAddRooms}
            onAddSpaces={dialogs.openAddSpaces}
          />
        </MenuGroup>
      ),
    });
  }

  groups.push({
    key: 'main',
    content: (
      <MenuGroup>
        {beforeMain}
        {showOverview && (
          <MenuEntry
            label={t('sharedUi.space.overview')}
            icon={Icons.Category}
            onSelect={() => {
              onClose();
              void navigate(getSpaceLobbyPath(getCanonicalAliasOrRoomId(client, space.roomId)));
            }}
          />
        )}
        {permissions.canInvite && (
          <MenuEntry
            label={t('sharedUi.space.invite')}
            icon={Icons.UserPlus}
            onSelect={() => {
              onClose();
              dialogs.openInvite();
            }}
          />
        )}
        <MenuEntry
          label={t('sharedUi.space.copyLink')}
          icon={Icons.Link}
          onSelect={() => {
            onClose();
            void copyToClipboard(getSpaceShareLink(client, space));
          }}
        />
        <MenuEntry
          label={t('featureUi.lobby.lobbyHeader.spaceSettings')}
          icon={Icons.Setting}
          onSelect={() => {
            onClose();
            openSpaceSettings(space.roomId);
          }}
        />
        {pinMode === 'toggle' && <PinToggleMenuEntry spaceId={space.roomId} onClose={onClose} />}
        {pinMode === 'unpin' && (
          <MenuEntry
            label={t('sharedUi.spaceTabs.unpin')}
            icon={Icons.Pin}
            onSelect={() => {
              onClose();
              void unpinSpaceFromSidebar(client, space.roomId);
            }}
          />
        )}
      </MenuGroup>
    ),
  });

  groups.push({
    key: 'destructive',
    content: (
      <MenuGroup>
        {removeFromParent && (
          <MenuEntry
            label={t('featureUi.subRooms.takeOff', {
              name: revealDirectionControls(removeFromParent.parentName),
            })}
            icon={Icons.Delete}
            critical
            onSelect={() => {
              onClose();
              void removeSpaceChild(client, removeFromParent.parentSpaceId, space.roomId);
            }}
          />
        )}
        <MenuEntry
          label={t('sharedUi.space.leaveSpace')}
          icon={Icons.ArrowGoLeft}
          directional
          critical
          onSelect={() => {
            onClose();
            dialogs.openLeave();
          }}
        />
      </MenuGroup>
    ),
  });

  return (
    <>
      {groups.map((group, index) => (
        <Fragment key={group.key}>
          {index > 0 && <Line size="300" />}
          {group.content}
        </Fragment>
      ))}
    </>
  );
}
