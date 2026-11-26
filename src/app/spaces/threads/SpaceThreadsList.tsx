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
import {
  handleCardArrowKey,
  useCompactCardNavigation,
  type CompactCardFocusIntent,
} from '../../threads/overview/compactCardKeys';
import { CompactSectionHeader } from '../../threads/overview/CompactSectionHeader';
import {
  CompactBlockSpacer,
  CompactCardList,
  CompactHeightGuard,
} from '../../threads/overview/CompactThreadCardChrome';
import {
  CompactThreadCardRow,
  getCompactCardRowActions,
  type ThreadActionsMenuState,
} from '../../threads/overview/CompactThreadCardRow';
import {
  buildCompactThreadCardViewModelFromRecord,
  getForkedFrom,
} from '../../threads/overview/compactThreadCardViewModel';
import { useCompactBlocks, type CompactBlockRow } from '../../threads/overview/useCompactBlocks';
import { setThreadResolved } from '../../threads/tags/useMutateThreadTags';
import { ownDirectionLine } from '../../ui/directional';
import { useScrollAnchorMemory, type ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';
import { RoomDot } from './RoomDot';
import type { SpaceRoomItem } from './spaceThreadsModel';
import * as css from './SpaceThreads.css';

const ThreadActionsMenu = lazy(() =>
  import('../../threads/ThreadActionsMenu').then((m) => ({ default: m.ThreadActionsMenu }))
);

function RoomThreadActionsMenu({
  room,
  rootId,
  summaryText,
  anchor,
  onClose,
  onOpenThread,
}: {
  room: Room;
  rootId: string;
  summaryText?: string;
  anchor: ThreadActionsMenuState['anchor'];
  onClose: () => void;
  onOpenThread: () => void;
}) {
  const powerLevels = usePowerLevels(room);
  return (
    <PowerLevelsContextProvider value={powerLevels}>
      <Suspense fallback={null}>
        <ThreadActionsMenu
          room={room}
          rootId={rootId}
          summaryText={summaryText}
          anchor={anchor}
          onClose={onClose}
          onOpenThread={onOpenThread}
        />
      </Suspense>
    </PowerLevelsContextProvider>
  );
}

const getSpaceRowId = (row: Element): string | undefined => {
  if (!(row instanceof HTMLElement) || !row.dataset.scrollAnchor) return undefined;
  return row.dataset.roomId
    ? getCrossRoomThreadIndexKey(row.dataset.roomId, row.dataset.scrollAnchor)
    : row.dataset.scrollAnchor;
};
const getSpaceRowKey = (row: Element): string | null => getSpaceRowId(row) ?? null;
const getSpaceCardKey = (card: HTMLElement): string | undefined =>
  getSpaceRowId(card.closest('[data-scroll-anchor]') ?? card) ?? card.dataset.threadRootId;

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
  scrollMemory?: ScrollAnchorMemory;
  scrollMemoryKey?: string;
  indexPending?: boolean;
  onOpenThread: (roomId: string, threadRootId: string) => void;
};

export function SpaceThreadsList({
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
  scrollMemory,
  scrollMemoryKey = 'space-threads',
  indexPending = false,
  onOpenThread,
}: SpaceThreadsListProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const myUserId = mx.getSafeUserId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const fallbackScrollMemoryRef = useRef<ScrollAnchorMemory>(new Map());
  const memory = scrollMemory ?? fallbackScrollMemoryRef.current;
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

  const groups = useMemo<Record<string, string[]>>(() => {
    if (sections) {
      return Object.fromEntries(
        sections.map((section) => {
          const fixedOpen = section.id === singleBucketTab;
          const closed = !fixedOpen && foldedSections.includes(section.id);
          return [section.id, closed ? [] : [...section.rootIds]];
        })
      );
    }
    return { all: [...entryKeys] };
  }, [entryKeys, foldedSections, sections, singleBucketTab]);
  const ids = useMemo(() => Object.values(groups).flat(), [groups]);

  const [intent, setIntent] = useState<CompactCardFocusIntent>();
  const pending = intent?.scope === scrollMemoryKey && ids.includes(intent.id) ? intent : undefined;

  const blocks = useCompactBlocks({
    groups,
    scrollRef,
    contentRef,
    memory,
    roomId: scrollMemoryKey,
    target: pending?.id,
    protectedId: menu ? getCrossRoomThreadIndexKey(menu.roomId, menu.rootId) : undefined,
    records: entryByKey,
    indexPending,
    getRowId: getSpaceRowId,
  });

  useScrollAnchorMemory({
    memory,
    memoryKey: scrollMemoryKey,
    scrollRef,
    contentRef,
    ready: ids.length > 0 && blocks.placeReady,
    progress: blocks.progress,
    getRowKey: getSpaceRowKey,
  });

  useCompactCardNavigation({
    scrollRef,
    ids,
    idOf: getSpaceCardKey,
    scope: scrollMemoryKey,
    intent,
    pending,
    setIntent,
    targetReady: blocks.targetReady,
    progress: blocks.progress,
  });

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

  const renderRow = (row: CompactBlockRow) =>
    typeof row === 'string' ? (
      renderCard(row)
    ) : (
      <CompactBlockSpacer key={`spacer:${row.key}`} row={row} scrollRef={scrollRef} />
    );

  return (
    <div
      ref={scrollRef}
      className={css.ThreadListScroll}
      data-space-threads-list="true"
      data-page-slide-clip=""
      data-compact-card-count={ids.length}
      data-cards-pending={!blocks.extentComplete || undefined}
      tabIndex={-1}
    >
      <CompactCardList ref={contentRef} onKeyDown={handleCardArrowKey}>
        <CompactHeightGuard
          scrollRef={scrollRef}
          contentRef={contentRef}
          liveIds={blocks.liveIds}
        />
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
          ? sections.flatMap((section, index) => {
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
                ...(closed ? [] : (blocks.rows[index] ?? []).map(renderRow)),
              ];
            })
          : (blocks.rows[0] ?? []).map(renderRow)}
      </CompactCardList>
      {menu && menuRoom && (
        <RoomThreadActionsMenu
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
      )}
    </div>
  );
}
