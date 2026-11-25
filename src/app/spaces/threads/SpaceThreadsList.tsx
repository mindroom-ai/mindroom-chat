import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { Text } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { canPinRoomEvents, setRoomEventPinned } from '../../event-store/threads/threadPinning';
import { getThreadPrimarySummaryText } from '../../event-store/threads/threadPresentation';
import { isConfirmedMatrixEventId } from '../../event-store/threads/threadRouteUtils';
import { MINDROOM_THREAD_TAGS_EVENT } from '../../event-store/threads/threadTags';
import type { ThreadWorkflowBucket } from '../../event-store/threads/threadWorkflow';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { getPowersLevelFromMatrixEvent } from '../../matrix/hooks/usePowerLevels';
import { getRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { getRoomPermissionsAPI } from '../../matrix/hooks/useRoomPermissions';
import { getStateEvent } from '../../matrix/room';
import { StateEvent } from '../../matrix/types/room';
import {
  getCrossRoomThreadIndexKey,
  type CrossRoomThreadIndexEntry,
} from '../../threads/cross-room/crossRoomThreadIndex';
import type {
  CompactThreadSection,
  CompactThreadSectionId,
} from '../../threads/overview/compactThreadSections';
import * as compactCss from '../../threads/overview/CompactRoomView.css';
import { CompactSectionHeader } from '../../threads/overview/CompactSectionHeader';
import { CompactCardList } from '../../threads/overview/CompactThreadCardChrome';
import {
  CompactThreadCardRow,
  type ThreadActionsMenuState,
} from '../../threads/overview/CompactThreadCardRow';
import {
  buildCompactThreadCardViewModelFromRecord,
  getForkedFrom,
} from '../../threads/overview/compactThreadCardViewModel';
import { setThreadResolved } from '../../threads/tags/useMutateThreadTags';
import { ownDirectionLine } from '../../ui/directional';
import { RoomDot } from './RoomDot';
import type { SpaceRoomItem } from './spaceThreadsModel';
import * as css from './SpaceThreads.css';

const ThreadActionsMenu = lazy(() =>
  import('../../threads/ThreadActionsMenu').then((m) => ({ default: m.ThreadActionsMenu }))
);

export type SpaceThreadsEmptyKey = 'no-rooms' | 'no-threads' | 'no-matching';

const EMPTY_MESSAGE_KEYS = {
  'no-rooms': 'spaceThreads.empty.noRooms',
  'no-threads': 'spaceThreads.empty.noThreads',
  'no-matching': 'mindroomUi.threads.roomThreadOverview.noThreadsMatchCurrentFilters',
} as const;

const getRoomCardPermissions = (room: Room, myUserId: string) => {
  const createEvent = getStateEvent(room, StateEvent.RoomCreate);
  const creators = createEvent ? getRoomCreators(createEvent) : new Set<string>();
  const levels = getPowersLevelFromMatrixEvent(getStateEvent(room, StateEvent.RoomPowerLevels));
  return {
    canToggle: getRoomPermissionsAPI(creators, levels).stateEvent(
      MINDROOM_THREAD_TAGS_EVENT,
      myUserId
    ),
    canPin: canPinRoomEvents(creators, levels, myUserId),
  };
};

const useInFlightKeys = () => {
  const keysRef = useRef(new Set<string>());
  const [keys, setKeys] = useState<ReadonlySet<string>>(() => new Set());
  const run = useCallback(
    (key: string, task: () => Promise<void>, onError: (e: unknown) => void) => {
      if (keysRef.current.has(key)) return;
      keysRef.current.add(key);
      setKeys(new Set(keysRef.current));
      void task()
        .catch(onError)
        .finally(() => {
          keysRef.current.delete(key);
          setKeys(new Set(keysRef.current));
        });
    },
    []
  );
  return [keys, run] as const;
};

export function SpaceThreadsNotice({
  message,
  loading,
  emptyKey,
}: {
  message: string;
  loading?: boolean;
  emptyKey?: SpaceThreadsEmptyKey;
}) {
  return (
    <div
      className={compactCss.EmptyState}
      data-space-threads-loading={loading ? 'true' : undefined}
      data-space-threads-empty={emptyKey}
    >
      <Text size="T300" priority="400">
        {message}
      </Text>
    </div>
  );
}

type SpaceThreadCardRowProps = {
  entry: CrossRoomThreadIndexEntry;
  room: Room;
  roomName: string;
  accentColor: string;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  showRoomBadge: boolean;
  pinned: boolean;
  canToggle: boolean;
  canPin: boolean;
  resolving: boolean;
  pinning: boolean;
  menuOpen: boolean;
  snoozeNow: number;
  metaVersion: number;
  onOpenThread: (roomId: string, threadRootId: string) => void;
  onSetResolved: (roomId: string, threadRootId: string, resolved: boolean) => void;
  onPin: (roomId: string, threadRootId: string, pinned: boolean) => void;
  onOpenMenu: (menu: ThreadActionsMenuState) => void;
};

const SpaceThreadCardRow = memo(function SpaceThreadCardRow({
  entry,
  room,
  roomName,
  accentColor,
  scrollRootRef,
  showRoomBadge,
  pinned,
  canToggle,
  canPin,
  resolving,
  pinning,
  menuOpen,
  snoozeNow,
  metaVersion,
  onOpenThread,
  onSetResolved,
  onPin,
  onOpenMenu,
}: SpaceThreadCardRowProps) {
  const { t, i18n } = useTranslation();
  const mx = useMatrixClient();
  const myUserId = mx.getSafeUserId();
  const useAuthentication = useMediaAuthentication();

  const viewModel = useMemo(() => {
    void metaVersion;
    return buildCompactThreadCardViewModelFromRecord({
      record: entry.threadRecord,
      room,
      forkedFrom: getForkedFrom(room, entry.threadRootId),
      now: snoozeNow,
      currentUserId: myUserId,
      mx,
      useAuthentication,
      t,
      locale: i18n.language,
    });
  }, [
    entry.threadRecord,
    entry.threadRootId,
    i18n.language,
    metaVersion,
    mx,
    myUserId,
    room,
    snoozeNow,
    t,
    useAuthentication,
  ]);

  const leadingBadges = useMemo(
    () =>
      showRoomBadge ? (
        <span className={css.RoomBadge} data-space-thread-room-badge={entry.roomId}>
          <RoomDot color={accentColor} />
          <span className={css.RoomBadgeName} {...ownDirectionLine}>
            {roomName}
          </span>
        </span>
      ) : undefined,
    [accentColor, entry.roomId, roomName, showRoomBadge]
  );

  const handleClick = useCallback(
    (rootId: string) => onOpenThread(entry.roomId, rootId),
    [entry.roomId, onOpenThread]
  );
  const handleSetResolved = useCallback(
    (rootId: string, resolved: boolean) => onSetResolved(entry.roomId, rootId, resolved),
    [entry.roomId, onSetResolved]
  );
  const handlePin = useCallback(
    (rootId: string, isPinned: boolean) => onPin(entry.roomId, rootId, isPinned),
    [entry.roomId, onPin]
  );

  const confirmed = isConfirmedMatrixEventId(entry.threadRootId);
  const showResolveAction = canToggle && !viewModel.isResolved && !pinned;
  const showPinAction = canPin && confirmed;

  return (
    <CompactThreadCardRow
      room={room}
      scrollRootRef={scrollRootRef}
      viewModel={viewModel}
      roomName={showRoomBadge ? roomName : undefined}
      leadingBadges={leadingBadges}
      pinned={pinned}
      showResolveAction={showResolveAction}
      showPinAction={showPinAction}
      actionsDisabled={(showResolveAction || showPinAction) && (pinning || resolving)}
      swipeEnabled={canToggle && !menuOpen && !pinned && confirmed && !resolving}
      menuOpen={menuOpen}
      resolveLabel={t('thread.resolve')}
      reopenLabel={t('threadActions.reopen')}
      onThreadClick={handleClick}
      onSetResolved={handleSetResolved}
      onPin={handlePin}
      onOpenMenu={onOpenMenu}
    />
  );
});

export type SpaceThreadsListProps = {
  spaceId?: string;
  entryKeys: readonly string[];
  entryByKey: ReadonlyMap<string, CrossRoomThreadIndexEntry>;
  sections?: readonly CompactThreadSection[];
  foldedSections: readonly CompactThreadSectionId[];
  singleBucketTab?: ThreadWorkflowBucket;
  onToggleSectionFold: (id: CompactThreadSectionId) => void;
  roomsById: ReadonlyMap<string, SpaceRoomItem>;
  pinnedByRoom?: ReadonlyMap<string, readonly string[]>;
  showRoomBadge: boolean;
  snoozeNow: number;
  metaVersion: number;
  showLoading: boolean;
  emptyKey?: SpaceThreadsEmptyKey;
  onOpenThread: (roomId: string, threadRootId: string) => void;
};

export function SpaceThreadsList({
  spaceId,
  entryKeys,
  entryByKey,
  sections,
  foldedSections,
  singleBucketTab,
  onToggleSectionFold,
  roomsById,
  pinnedByRoom,
  showRoomBadge,
  snoozeNow,
  metaVersion,
  showLoading,
  emptyKey,
  onOpenThread,
}: SpaceThreadsListProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const myUserId = mx.getSafeUserId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const roomsByIdRef = useRef(roomsById);
  useLayoutEffect(() => {
    roomsByIdRef.current = roomsById;
  });

  const permissionsByRoom = useMemo(() => {
    void metaVersion;
    return new Map(
      [...roomsById].map(([roomId, item]) => [roomId, getRoomCardPermissions(item.room, myUserId)])
    );
  }, [metaVersion, myUserId, roomsById]);

  const [resolvingKeys, runResolve] = useInFlightKeys();
  const [pinningRoomIds, runPin] = useInFlightKeys();
  const [pinError, setPinError] = useState(false);

  const handleSetResolved = useCallback(
    (roomId: string, rootId: string, resolved: boolean) => {
      const room = roomsByIdRef.current.get(roomId)?.room;
      if (!room) return;
      runResolve(
        `${roomId}:${rootId}`,
        () => setThreadResolved(mx, room, rootId, resolved),
        (err) => {
          // eslint-disable-next-line no-console
          console.error('[SpaceThreadsList] Resolve failed:', err);
        }
      );
    },
    [mx, runResolve]
  );

  const handlePin = useCallback(
    (roomId: string, rootId: string, currentlyPinned: boolean) => {
      const room = roomsByIdRef.current.get(roomId)?.room;
      if (!room) return;
      setPinError(false);
      runPin(
        roomId,
        () => setRoomEventPinned(mx, room, rootId, !currentlyPinned),
        (err) => {
          setPinError(true);
          // eslint-disable-next-line no-console
          console.error('[SpaceThreadsList] Pin failed:', err);
        }
      );
    },
    [mx, runPin]
  );

  const [menu, setMenu] = useState<ThreadActionsMenuState>();
  const menuRef = useRef<ThreadActionsMenuState>(undefined);
  const openMenu = useCallback((nextMenu: ThreadActionsMenuState) => {
    menuRef.current = nextMenu;
    setMenu(nextMenu);
  }, []);
  const closeMenu = useCallback((selectedMenu: ThreadActionsMenuState) => {
    if (menuRef.current !== selectedMenu) return;
    menuRef.current = undefined;
    setMenu(undefined);
    const trigger = selectedMenu.trigger?.isConnected
      ? selectedMenu.trigger
      : (Array.from(
          scrollRef.current?.querySelectorAll<HTMLElement>('[data-room-id][data-scroll-anchor]') ??
            []
        )
          .find(
            (shell) =>
              shell.dataset.roomId === selectedMenu.roomId &&
              shell.dataset.scrollAnchor === selectedMenu.rootId
          )
          ?.querySelector<HTMLButtonElement>('[data-thread-root-id]') ?? undefined);
    (trigger ?? scrollRef.current)?.focus();
  }, []);

  const menuRoom = menu ? roomsById.get(menu.roomId)?.room : undefined;
  useLayoutEffect(() => {
    setPinError(false);
    if (menuRef.current === undefined) return;
    menuRef.current = undefined;
    setMenu(undefined);
  }, [spaceId]);
  useLayoutEffect(() => {
    if (!menu || menuRoom) return;
    if (menuRef.current === menu) menuRef.current = undefined;
    setMenu(undefined);
  }, [menu, menuRoom]);

  const menuEntry = menu
    ? entryByKey.get(getCrossRoomThreadIndexKey(menu.roomId, menu.rootId))
    : undefined;
  const menuSummaryText = menuEntry
    ? getThreadPrimarySummaryText(menuEntry.threadRecord.presentation)
    : menu?.viewModel.primarySummaryText;

  const renderCard = (key: string) => {
    const entry = entryByKey.get(key);
    const roomItem = entry ? roomsById.get(entry.roomId) : undefined;
    if (!entry || !roomItem) return null;
    const permissions = permissionsByRoom.get(entry.roomId);
    const pinned = pinnedByRoom?.get(entry.roomId)?.includes(entry.threadRootId) ?? false;
    return (
      <SpaceThreadCardRow
        key={entry.key}
        entry={entry}
        room={roomItem.room}
        roomName={roomItem.name}
        accentColor={roomItem.accentColor}
        scrollRootRef={scrollRef}
        showRoomBadge={showRoomBadge}
        pinned={pinned}
        canToggle={permissions?.canToggle ?? false}
        canPin={permissions?.canPin ?? false}
        resolving={resolvingKeys.has(`${entry.roomId}:${entry.threadRootId}`)}
        pinning={pinningRoomIds.has(entry.roomId)}
        menuOpen={
          Boolean(menuRoom) && menu?.roomId === entry.roomId && menu.rootId === entry.threadRootId
        }
        snoozeNow={snoozeNow}
        metaVersion={metaVersion}
        onOpenThread={onOpenThread}
        onSetResolved={handleSetResolved}
        onPin={handlePin}
        onOpenMenu={openMenu}
      />
    );
  };

  return (
    <div
      ref={scrollRef}
      className={css.ThreadListScroll}
      data-space-threads-list="true"
      tabIndex={-1}
    >
      <CompactCardList>
        {pinError && (
          <Text role="alert" size="T200">
            {t('thread.pinFailed')}
          </Text>
        )}
        {showLoading && <SpaceThreadsNotice message={t('spaceThreads.loading')} loading />}
        {emptyKey && (
          <SpaceThreadsNotice message={t(EMPTY_MESSAGE_KEYS[emptyKey])} emptyKey={emptyKey} />
        )}
        {sections
          ? sections.flatMap((section) => {
              const fixedOpen = section.id === singleBucketTab;
              const closed = !fixedOpen && foldedSections.includes(section.id);
              return [
                <CompactSectionHeader
                  key={`section:${section.id}`}
                  id={section.id}
                  count={section.rootIds.length}
                  closed={closed}
                  fixedOpen={fixedOpen}
                  onToggle={onToggleSectionFold}
                />,
                ...(closed ? [] : section.rootIds.map(renderCard)),
              ];
            })
          : entryKeys.map(renderCard)}
      </CompactCardList>
      {menu && menuRoom && (
        <Suspense fallback={null}>
          <ThreadActionsMenu
            key={`${menu.roomId}:${menu.rootId}`}
            room={menuRoom}
            rootId={menu.rootId}
            summaryText={menuSummaryText}
            anchor={menu.anchor}
            onClose={() => closeMenu(menu)}
            onOpenThread={() => {
              if (menuRef.current !== menu) return;
              menuRef.current = undefined;
              setMenu(undefined);
              onOpenThread(menu.roomId, menu.rootId);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
