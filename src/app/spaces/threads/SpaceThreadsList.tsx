import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
} from 'react';
import { Text } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { canPinRoomEvents, setRoomEventPinned } from '../../event-store/threads/threadPinning';
import { getThreadPrimarySummaryText } from '../../event-store/threads/threadPresentation';
import { MINDROOM_THREAD_TAGS_EVENT } from '../../event-store/threads/threadTags';
import type { ThreadWorkflowBucket } from '../../event-store/threads/threadWorkflow';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import {
  getPowersLevelFromMatrixEvent,
  PowerLevelsContextProvider,
  usePowerLevels,
} from '../../matrix/hooks/usePowerLevels';
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
import { findCompactCard } from '../../threads/overview/compactCardKeys';
import { sectionBlockGroups } from '../../threads/overview/CompactThreadCardChrome';
import {
  CompactThreadCardRow,
  getCompactCardRowActions,
  type ThreadActionsMenuState,
} from '../../threads/overview/CompactThreadCardRow';
import {
  buildCompactThreadCardViewModelFromRecord,
  getForkedFrom,
} from '../../threads/overview/compactThreadCardViewModel';
import { setThreadResolved, unsnoozeThread } from '../../threads/tags/useMutateThreadTags';
import { ownDirectionLine } from '../../ui/directional';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';
import { RoomDot } from './RoomDot';
import { useIsSpaceThreadsPassive } from '../spaceUnderLayerContext';
import type { SpaceRoomItem } from './spaceThreadsModel';
import { SpaceThreadsColumnsBody } from './SpaceThreadsColumnsBody';
import { SpaceThreadsVerticalBody } from './SpaceThreadsVerticalBody';
import * as css from './SpaceThreads.css';

const ThreadActionsMenu = lazy(() =>
  import('../../threads/ThreadActionsMenu').then((m) => ({ default: m.ThreadActionsMenu }))
);

function RoomThreadActionsMenu(props: ComponentProps<typeof ThreadActionsMenu>) {
  const powerLevels = usePowerLevels(props.room);
  return (
    <PowerLevelsContextProvider value={powerLevels}>
      <Suspense fallback={null}>
        <ThreadActionsMenu {...props} />
      </Suspense>
    </PowerLevelsContextProvider>
  );
}

const getSpaceRowId = (row: Element): string | undefined => {
  const anchor = row.getAttribute('data-scroll-anchor');
  const roomId = row.getAttribute('data-room-id');
  return anchor ? (roomId ? getCrossRoomThreadIndexKey(roomId, anchor) : anchor) : undefined;
};

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
  passive: boolean;
  snoozeNow: number;
  metaVersion: number;
  onOpenThread: (roomId: string, threadRootId: string) => void;
  onSetResolved: (roomId: string, threadRootId: string, resolved: boolean) => void;
  onUnsnooze: (roomId: string, threadRootId: string) => void;
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
  passive,
  snoozeNow,
  metaVersion,
  onOpenThread,
  onSetResolved,
  onUnsnooze,
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
  const handleUnsnooze = useCallback(
    (rootId: string) => onUnsnooze(entry.roomId, rootId),
    [entry.roomId, onUnsnooze]
  );
  const handlePin = useCallback(
    (rootId: string, isPinned: boolean) => onPin(entry.roomId, rootId, isPinned),
    [entry.roomId, onPin]
  );

  const actions = getCompactCardRowActions({
    rootId: entry.threadRootId,
    isResolved: viewModel.isResolved,
    pinned,
    canToggle,
    canPin,
    resolving,
    pinning,
    menuOpen,
  });

  return (
    <CompactThreadCardRow
      room={room}
      scrollRootRef={scrollRootRef}
      viewModel={viewModel}
      roomName={showRoomBadge ? roomName : undefined}
      leadingBadges={leadingBadges}
      pinned={pinned}
      {...actions}
      menuOpen={menuOpen}
      passive={passive}
      resolveLabel={t('thread.resolve')}
      reopenLabel={t('threadActions.reopen')}
      snoozeLabel={t('thread.snooze')}
      unsnoozeLabel={t('thread.unsnooze')}
      onThreadClick={handleClick}
      onSetResolved={handleSetResolved}
      onUnsnooze={handleUnsnooze}
      onPin={handlePin}
      onOpenMenu={onOpenMenu}
    />
  );
});

export type SpaceThreadsListProps = {
  entryKeys: readonly string[];
  entryByKey: ReadonlyMap<string, CrossRoomThreadIndexEntry>;
  sections?: readonly CompactThreadSection[];
  foldedSections: readonly CompactThreadSectionId[];
  sectionOrder?: readonly CompactThreadSectionId[];
  columns?: boolean;
  singleBucketTab?: ThreadWorkflowBucket;
  onToggleSectionFold: (id: CompactThreadSectionId) => void;
  onReorderSections?: (order: CompactThreadSectionId[]) => void;
  roomsById: ReadonlyMap<string, SpaceRoomItem>;
  pinnedByRoom?: ReadonlyMap<string, readonly string[]>;
  showRoomBadge: boolean;
  snoozeNow: number;
  metaVersion: number;
  showLoading: boolean;
  emptyKey?: SpaceThreadsEmptyKey;
  scrollMemory?: ScrollAnchorMemory;
  scrollMemoryKey: string;
  indexPending?: boolean;
  onOpenThread: (roomId: string, threadRootId: string) => void;
};

export function SpaceThreadsList({
  entryKeys,
  entryByKey,
  sections,
  foldedSections,
  sectionOrder,
  columns = false,
  singleBucketTab,
  onToggleSectionFold,
  onReorderSections,
  roomsById,
  pinnedByRoom,
  showRoomBadge,
  snoozeNow,
  metaVersion,
  showLoading,
  emptyKey,
  scrollMemory,
  scrollMemoryKey,
  indexPending = false,
  onOpenThread,
}: SpaceThreadsListProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const myUserId = mx.getSafeUserId();
  const passive = useIsSpaceThreadsPassive();
  const scrollRef = useRef<HTMLDivElement>(null);
  const fallbackMemoryRef = useRef<ScrollAnchorMemory>(new Map());
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

  const handleUnsnooze = useCallback(
    (roomId: string, rootId: string) => {
      const room = roomsByIdRef.current.get(roomId)?.room;
      if (!room) return;
      runResolve(
        `${roomId}:${rootId}`,
        () => unsnoozeThread(mx, room, rootId),
        (err) => {
          // eslint-disable-next-line no-console
          console.error('[SpaceThreadsList] Unsnooze failed:', err);
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
  const clearMenu = useCallback((selectedMenu: ThreadActionsMenuState) => {
    if (menuRef.current !== selectedMenu) return false;
    menuRef.current = undefined;
    setMenu(undefined);
    return true;
  }, []);
  const menuRoom = menu ? roomsById.get(menu.roomId)?.room : undefined;
  useLayoutEffect(() => {
    if (menu && !menuRoom) clearMenu(menu);
  }, [clearMenu, menu, menuRoom]);
  const menuKey = menu ? getCrossRoomThreadIndexKey(menu.roomId, menu.rootId) : undefined;
  const menuEntry = menuKey ? entryByKey.get(menuKey) : undefined;
  const menuSummaryText = menuEntry
    ? getThreadPrimarySummaryText(menuEntry.threadRecord.presentation)
    : menu?.viewModel.primarySummaryText;
  const columnsShown = Boolean(
    columns && sections && !singleBucketTab && !showLoading && !emptyKey && entryKeys.length > 0
  );
  const groups = useMemo(
    () =>
      sections
        ? sectionBlockGroups(sections, foldedSections, singleBucketTab)
        : { all: [...entryKeys] },
    [entryKeys, foldedSections, sections, singleBucketTab]
  );
  const resolvedMemory = scrollMemory ?? fallbackMemoryRef.current;
  const spaceCardIdOf = useCallback(
    (card: HTMLElement) =>
      getSpaceRowId(card.closest('[data-scroll-anchor]') ?? card) ?? card.dataset.threadRootId,
    []
  );

  const renderCard = (key: string, rowScrollRef: RefObject<HTMLDivElement | null> = scrollRef) => {
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
        scrollRootRef={rowScrollRef}
        showRoomBadge={showRoomBadge}
        pinned={pinned}
        canToggle={permissions?.canToggle ?? false}
        canPin={permissions?.canPin ?? false}
        resolving={resolvingKeys.has(`${entry.roomId}:${entry.threadRootId}`)}
        pinning={pinningRoomIds.has(entry.roomId)}
        menuOpen={Boolean(menuRoom) && menuKey === entry.key}
        passive={passive}
        snoozeNow={snoozeNow}
        metaVersion={metaVersion}
        onOpenThread={onOpenThread}
        onSetResolved={handleSetResolved}
        onUnsnooze={handleUnsnooze}
        onPin={handlePin}
        onOpenMenu={openMenu}
      />
    );
  };

  return (
    <div ref={scrollRef} className={css.ThreadListHost}>
      {columnsShown && sections ? (
        <SpaceThreadsColumnsBody
          sections={sections}
          foldedSections={foldedSections}
          sectionOrder={sectionOrder}
          entryByKey={entryByKey}
          scrollMemory={resolvedMemory}
          scrollMemoryKey={scrollMemoryKey}
          pinError={pinError}
          cardIdOf={spaceCardIdOf}
          onToggleSectionFold={onToggleSectionFold}
          onReorderSections={onReorderSections}
          renderCard={renderCard}
        />
      ) : (
        <SpaceThreadsVerticalBody
          groups={groups}
          sections={sections}
          foldedSections={foldedSections}
          singleBucketTab={singleBucketTab}
          entryByKey={entryByKey}
          roomsById={roomsById}
          scrollMemory={resolvedMemory}
          scrollMemoryKey={scrollMemoryKey}
          menuKey={menuKey}
          indexPending={indexPending}
          pinError={pinError}
          getRowId={getSpaceRowId}
          notice={
            <>
              {showLoading && <SpaceThreadsNotice message={t('spaceThreads.loading')} loading />}
              {emptyKey && (
                <SpaceThreadsNotice message={t(EMPTY_MESSAGE_KEYS[emptyKey])} emptyKey={emptyKey} />
              )}
            </>
          }
          onToggleSectionFold={onToggleSectionFold}
          renderCard={renderCard}
        />
      )}
      {menu && menuRoom && (
        <RoomThreadActionsMenu
          key={`${menu.roomId}:${menu.rootId}:${menu.initialDialog ?? ''}`}
          room={menuRoom}
          rootId={menu.rootId}
          summaryText={menuSummaryText}
          anchor={menu.anchor}
          initialDialog={menu.initialDialog}
          onClose={() => {
            if (!clearMenu(menu)) return;
            if (passive) return;
            const trigger = menu.trigger?.isConnected
              ? menu.trigger
              : menuKey && findCompactCard(scrollRef.current, menuKey);
            (
              trigger || scrollRef.current?.querySelector<HTMLElement>('[data-space-threads-list]')
            )?.focus();
          }}
          onOpenThread={() => {
            if (clearMenu(menu)) onOpenThread(menu.roomId, menu.rootId);
          }}
        />
      )}
    </div>
  );
}
