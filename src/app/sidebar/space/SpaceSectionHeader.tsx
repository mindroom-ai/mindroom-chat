import {
  type MouseEvent,
  type MouseEventHandler,
  type ReactNode,
  type Ref,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import classNames from 'classnames';
import { Icon, IconButton, Icons, Line, type IconSrc, type RectCords } from 'folds';
import { atom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { NavCategoryHeader } from '../../ui/nav/NavCategoryHeader';
import { RoomNavCategoryButton } from '../room-nav/RoomNavCategoryButton';
import { type RoomSortInheritOption, RoomSortMenuContent } from '../room-nav/RoomSortMenu';
import type { RoomSortMode } from '../room-nav/roomOrder';
import { UnreadBadge, UnreadBadgeCenter } from '../../ui/UnreadBadge';
import { revealDirectionControls } from '../../ui/directional';
import { MenuGroup } from '../../ui/MenuEntry';
import { useLongPress } from '../../lib/hooks/useLongPress';
import { useRoomName } from '../../matrix/hooks/useRoomMeta';
import { navigationRoomToUnreadAtom } from '../../notifications/navigationUnread';
import {
  SpaceAddMenuEntries,
  SpaceMenuGroups,
  type SpaceMenuGroupsProps,
  type SpaceQuickDialogHandlers,
  type SpaceQuickPermissions,
  useSpaceQuickDialogs,
  useSpaceQuickPermissions,
} from '../../spaces/SpaceActions';
import {
  type CollapsedSectionUnread,
  getCollapsedSectionUnread,
} from '../../spaces/spaceRoomSections';
import { SectionMenuPopOut } from '../SectionMenuPopOut';
import * as css from './SpaceSectionHeader.css';

const EMPTY_UNREAD_ATOM = atom((): CollapsedSectionUnread | undefined => undefined);
// Clears NavCategoryHeader's inline 32px minHeight so css.Header controls compact desktop/touch heights.
export const COMPACT_HEADER_STYLE = { minHeight: undefined };

export type SectionHeaderButtonProps = {
  buttonRef?: Ref<HTMLButtonElement>;
  label: string;
  ownDirection?: boolean;
  before?: ReactNode;
  categoryId: string;
  closed: boolean;
  shownRoomIds: readonly string[];
  selectedRoomId: string | undefined;
  quietUnread?: boolean;
  onClick: MouseEventHandler<HTMLElement>;
};

/**
 * Collapsible heading for a sidebar room section. Keeps one button mounted across toggles
 * (preserving keyboard focus) and subscribes to unread state only while collapsed.
 */
export function SectionHeaderButton({
  buttonRef,
  label,
  ownDirection,
  before,
  categoryId,
  closed,
  shownRoomIds,
  selectedRoomId,
  quietUnread = false,
  onClick,
}: SectionHeaderButtonProps) {
  const { t } = useTranslation();
  const unreadAtom = useMemo(
    () =>
      closed
        ? atom((get) =>
            getCollapsedSectionUnread(
              true,
              shownRoomIds,
              selectedRoomId,
              get(navigationRoomToUnreadAtom)
            )
          )
        : EMPTY_UNREAD_ATOM,
    [closed, shownRoomIds, selectedRoomId]
  );
  const unread = useAtomValue(unreadAtom);

  return (
    <RoomNavCategoryButton
      ref={buttonRef}
      className={css.HeaderButton}
      closed={closed}
      ownDirection={ownDirection}
      before={before}
      data-category-id={categoryId}
      aria-label={unread ? t('featureUi.spaceNav.subspaceUnread', { name: label }) : undefined}
      after={
        unread && (
          <span className={css.UnreadSlot}>
            <UnreadBadgeCenter>
              <span data-unread data-highlight={unread.highlight ? 'true' : undefined}>
                {quietUnread ? (
                  <span
                    className={unread.highlight ? css.QuietHighlightDot : css.QuietUnreadDot}
                    aria-hidden="true"
                  />
                ) : (
                  <UnreadBadge count={0} highlight={unread.highlight} />
                )}
              </span>
            </UnreadBadgeCenter>
          </span>
        )
      }
      onClick={onClick}
    >
      {label}
    </RoomNavCategoryButton>
  );
}

export type SectionActionButtonProps = {
  icon: IconSrc;
  label: string;
  className?: string;
  hasMenu?: boolean;
  menuOpen?: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
};

/** Compact hover/focus action icon button inside a collapsible sidebar section header. */
export function SectionActionButton({
  icon,
  label,
  className,
  hasMenu,
  menuOpen,
  onClick,
}: SectionActionButtonProps) {
  return (
    <IconButton
      size="300"
      radii="300"
      variant="Background"
      fill="None"
      className={classNames(css.ActionButton, className)}
      aria-label={label}
      aria-haspopup={hasMenu ? 'menu' : undefined}
      aria-expanded={hasMenu ? Boolean(menuOpen) : undefined}
      onClick={onClick}
    >
      <Icon size="50" src={icon} />
    </IconButton>
  );
}

/** Sub-space options menu with live immediate-parent permissions; mounts only while open. */
function SubspaceOptionsWithParent({
  subspace,
  parentSpace,
  permissions,
  dialogs,
  showAdd,
  pinMode,
  showOverview,
  onClose,
}: {
  subspace: Room;
  parentSpace: Room;
  permissions: SpaceQuickPermissions;
  dialogs: SpaceQuickDialogHandlers;
  showAdd: boolean;
  pinMode?: SpaceMenuGroupsProps['pinMode'];
  showOverview?: boolean;
  onClose: () => void;
}) {
  const parentName = useRoomName(parentSpace);
  const { canAdd: canEditParent } = useSpaceQuickPermissions(parentSpace);
  return (
    <SpaceMenuGroups
      space={subspace}
      permissions={permissions}
      dialogs={dialogs}
      onClose={onClose}
      showAdd={showAdd}
      showOverview={showOverview}
      pinMode={pinMode}
      removeFromParent={
        canEditParent ? { parentSpaceId: parentSpace.roomId, parentName } : undefined
      }
    />
  );
}

type SectionMenuKind = 'add' | 'options' | 'context';
type OpenSectionMenu = {
  kind: SectionMenuKind;
  anchor: RectCords;
  position: 'Bottom' | 'Right';
  align: 'Start' | 'End';
  opener: HTMLElement | null;
};

const pointerAnchor = (event: MouseEvent): RectCords => ({
  x: event.clientX,
  y: event.clientY,
  width: 0,
  height: 0,
});

const isTouchOrNoHover = (event: MouseEvent): boolean =>
  (event.nativeEvent as Partial<PointerEvent> | undefined)?.pointerType === 'touch' ||
  (typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: none)').matches);

export type SubspaceSortOptions = {
  mode: RoomSortMode;
  inherit?: RoomSortInheritOption;
  showTimes: boolean;
  hasSavedOrder: boolean;
  onModeChange: (mode: RoomSortMode) => void;
  onShowTimesChange: (show: boolean) => void;
};

export type SpaceSectionHeaderProps = {
  /** The space this section lists (root space or joined descendant sub-space). */
  space: Room;
  /** Immediate parent space for a sub-space section (`undefined` for root Rooms). */
  parentSpace: Room | undefined;
  isRoot: boolean;
  isEmpty: boolean;
  categoryId: string;
  closed: boolean;
  shownRoomIds: readonly string[];
  selectedRoomId: string | undefined;
  onCategoryClick: MouseEventHandler<HTMLElement>;
  /** Per-section sort controls shown inside the space options menu. */
  sort?: SubspaceSortOptions;
  /** Optional sidebar pin entry for space options menus (e.g. `'toggle'` for sub-spaces). */
  pinMode?: SpaceMenuGroupsProps['pinMode'];
  /** Include a `Space overview` entry navigating directly to the space lobby. */
  showOverview?: boolean;
  /** Use calm quiet dots for collapsed unread state (Home sidebar). */
  quietUnread?: boolean;
  /** Heading level (`aria-level`) for nested space trees (defaults to `3`). */
  headingLevel?: number;
};

/**
 * Collapsible Space sidebar section heading with pure-CSS hover/focus quick actions (`+` and
 * sub-space `⋮`), plus right-click and touch long-press menu support.
 */
export function SpaceSectionHeader({
  space,
  parentSpace,
  isRoot,
  isEmpty,
  categoryId,
  closed,
  shownRoomIds,
  selectedRoomId,
  onCategoryClick,
  sort,
  pinMode,
  showOverview = false,
  quietUnread = false,
  headingLevel = 3,
}: SpaceSectionHeaderProps) {
  const { t } = useTranslation();
  const spaceName = revealDirectionControls(useRoomName(space));
  const label = isRoot ? t('sharedUi.space.rooms') : spaceName;
  const permissions = useSpaceQuickPermissions(space);
  const dialogs = useSpaceQuickDialogs(space);

  const [menu, setMenu] = useState<OpenSectionMenu>();
  const headerRef = useRef<HTMLDivElement>(null);
  const headingButtonRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenu(undefined), []);

  const canOpenContextMenu = !isRoot || permissions.canAdd;
  const contextKind: SectionMenuKind = isRoot ? 'add' : 'context';
  const actionCount = (permissions.canAdd ? 1 : 0) + (!isRoot ? 1 : 0);
  const hasActions = actionCount > 0;

  const openAtHeader = useCallback(() => {
    const header = headerRef.current;
    if (!header) return;
    setMenu({
      kind: contextKind,
      anchor: header.getBoundingClientRect(),
      position: 'Bottom',
      align: 'Start',
      opener: headingButtonRef.current,
    });
  }, [contextKind]);

  const longPress = useLongPress(openAtHeader, () => canOpenContextMenu);

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    if ((event.nativeEvent as Partial<PointerEvent>).pointerType === 'touch') {
      openAtHeader();
      return;
    }
    setMenu({
      kind: contextKind,
      anchor: pointerAnchor(event),
      position: 'Right',
      align: 'Start',
      opener: headingButtonRef.current,
    });
  };

  const openAddFromButton = (event: MouseEvent<HTMLButtonElement>) => {
    setMenu({
      kind: 'add',
      anchor: event.currentTarget.getBoundingClientRect(),
      position: 'Bottom',
      align: 'End',
      opener: event.currentTarget,
    });
  };

  const openOptionsFromButton = (event: MouseEvent<HTMLButtonElement>) => {
    setMenu({
      kind: isTouchOrNoHover(event) ? 'context' : 'options',
      anchor: event.currentTarget.getBoundingClientRect(),
      position: 'Bottom',
      align: 'End',
      opener: event.currentTarget,
    });
  };

  return (
    <>
      <NavCategoryHeader
        ref={headerRef}
        aria-level={headingLevel}
        className={css.Header}
        style={COMPACT_HEADER_STYLE}
        data-actions-count={hasActions ? actionCount : undefined}
        data-empty-add={isEmpty && permissions.canAdd ? 'true' : undefined}
        data-menu-open={menu ? 'true' : undefined}
        {...longPress}
        onContextMenu={canOpenContextMenu ? handleContextMenu : undefined}
      >
        <SectionHeaderButton
          buttonRef={headingButtonRef}
          label={label}
          ownDirection={!isRoot}
          categoryId={categoryId}
          closed={closed}
          shownRoomIds={shownRoomIds}
          selectedRoomId={selectedRoomId}
          quietUnread={quietUnread}
          onClick={onCategoryClick}
        />
        {hasActions && (
          <div className={css.SectionActions}>
            {permissions.canAdd && (
              <SectionActionButton
                icon={Icons.Plus}
                label={t('featureUi.spaceNav.addToSpace', { name: label })}
                className={classNames(
                  !isRoot && css.SubspaceAddButton,
                  isEmpty && css.EmptyAddButton
                )}
                hasMenu
                menuOpen={menu?.kind === 'add'}
                onClick={openAddFromButton}
              />
            )}
            {!isRoot && (
              <SectionActionButton
                icon={Icons.VerticalDots}
                label={t('featureUi.spaceNav.subspaceOptions', { name: spaceName })}
                hasMenu
                menuOpen={menu?.kind === 'options' || menu?.kind === 'context'}
                onClick={openOptionsFromButton}
              />
            )}
          </div>
        )}
      </NavCategoryHeader>
      {menu && (
        <SectionMenuPopOut
          anchor={menu.anchor}
          position={menu.position}
          align={menu.align}
          returnFocusTo={menu.opener}
          onClose={closeMenu}
        >
          {menu.kind === 'add' ? (
            <MenuGroup>
              <SpaceAddMenuEntries
                spaceId={space.roomId}
                roomsOnly={isRoot}
                onClose={closeMenu}
                onAddRooms={dialogs.openAddRooms}
                onAddSpaces={dialogs.openAddSpaces}
              />
            </MenuGroup>
          ) : (
            <>
              {sort && (
                <>
                  <RoomSortMenuContent
                    mode={sort.mode}
                    showTimes={sort.showTimes}
                    hasSavedOrder={sort.hasSavedOrder}
                    inherit={
                      sort.inherit
                        ? {
                            ...sort.inherit,
                            onReset: () => {
                              sort.inherit!.onReset();
                              closeMenu();
                            },
                          }
                        : undefined
                    }
                    onModeChange={(nextMode) => {
                      sort.onModeChange(nextMode);
                      closeMenu();
                    }}
                    onShowTimesChange={sort.onShowTimesChange}
                    inlineDisplay
                  />
                  <Line size="300" />
                </>
              )}
              {parentSpace ? (
                <SubspaceOptionsWithParent
                  subspace={space}
                  parentSpace={parentSpace}
                  permissions={permissions}
                  dialogs={dialogs}
                  showAdd={menu.kind === 'context'}
                  pinMode={pinMode}
                  showOverview={showOverview}
                  onClose={closeMenu}
                />
              ) : (
                <SpaceMenuGroups
                  space={space}
                  permissions={permissions}
                  dialogs={dialogs}
                  onClose={closeMenu}
                  showAdd={menu.kind === 'context'}
                  showOverview={showOverview}
                  pinMode={pinMode}
                />
              )}
            </>
          )}
        </SectionMenuPopOut>
      )}
      {dialogs.dialog}
    </>
  );
}
