import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Icon, Icons, Text } from 'folds';
import { EventTimeline, KnownMembership, type Room, type RoomMember } from 'matrix-js-sdk';
import { logger } from 'matrix-js-sdk/lib/logger';
import classNames from 'classnames';
import { RoomIcon } from '../../avatars/RoomAvatar';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { getPowersLevelFromMatrixEvent } from '../../matrix/hooks/usePowerLevels';
import { getRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { getRoomPermissionsAPI } from '../../matrix/hooks/useRoomPermissions';
import { isMindroomAgentUserId, isMindroomOwnerUserId } from '../../matrix/protocol/agentIdentity';
import { getRoomThreadMode } from '../../matrix/protocol/roomThreadMode';
import { navigationRoomsAtom } from '../../matrix/state/archivedRooms';
import { StateEvent } from '../../matrix/types/room';
import { getRecentRoomsAtom } from '../../navigation/recentRooms';
import { isJoinedRoom } from '../../navigation/routeVisibility';
import { ActionDialog } from '../../ui/ActionDialog';
import * as css from './ForkToRoomDialog.css';

const isRespondingMindroomAgent = (userId: string): boolean =>
  isMindroomAgentUserId(userId) && !isMindroomOwnerUserId(userId);

/**
 * Whether `targetMembers` includes at least one active (joined or invited) responding MindRoom
 * agent (excluding `@mindroom_router`, which is joined to every room) and none of those agents
 * are joined to the source room.
 */
export const targetHasUnsharedAgents = (
  sourceMembers: readonly Pick<RoomMember, 'membership' | 'userId'>[],
  targetMembers: readonly Pick<RoomMember, 'membership' | 'userId'>[]
): boolean => {
  const targetAgents = targetMembers.filter(
    ({ membership, userId }) =>
      (membership === KnownMembership.Join || membership === KnownMembership.Invite) &&
      isRespondingMindroomAgent(userId)
  );
  if (targetAgents.length === 0) return false;
  const sourceJoinedAgents = new Set(
    sourceMembers
      .filter(
        ({ membership, userId }) =>
          membership === KnownMembership.Join && isRespondingMindroomAgent(userId)
      )
      .map(({ userId }) => userId)
  );
  return !targetAgents.some(({ userId }) => sourceJoinedAgents.has(userId));
};

const getForwardState = (room: Room) =>
  room.getLiveTimeline?.()?.getState?.(EventTimeline.FORWARDS) ?? room.currentState;

const canMessageInRoom = (room: Room, userId: string): boolean => {
  const state = getForwardState(room);
  if (state?.getStateEvents(StateEvent.RoomTombstone, '')) return false;
  const createEvent = state?.getStateEvents(StateEvent.RoomCreate, '');
  const creators = createEvent ? getRoomCreators(createEvent) : new Set<string>();
  const levels = getPowersLevelFromMatrixEvent(
    state?.getStateEvents(StateEvent.RoomPowerLevels, '')
  );
  return getRoomPermissionsAPI(creators, levels).event('m.room.message', userId);
};

/** Maximum number of displayed candidate rooms to lazy-load members for at a time. */
export const MAX_MEMBER_LOAD_CANDIDATES = 20;

type EligibleCandidateRoom = {
  room: Room;
  name: string;
  alias: string;
};

type CandidateRoom = EligibleCandidateRoom & {
  agentWarning: boolean;
};

/**
 * Searchable, keyboard-navigable room picker for "Fork to room…". Lists joined non-archived rooms
 * sorted recent-first, excluding spaces, the source room, tombstoned/unwritable rooms,
 * `room`-thread-mode rooms, and unencrypted rooms when the source room is encrypted.
 */
export function ForkToRoomDialog({
  sourceRoom,
  onSelect,
  onClose,
}: {
  sourceRoom: Room;
  onSelect: (targetRoomId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const myUserId = mx.getSafeUserId();
  const navRoomIds = useAtomValue(navigationRoomsAtom);
  const recentRooms = useAtomValue(getRecentRoomsAtom(myUserId));
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const sourceRoomName = sourceRoom.name || sourceRoom.roomId;

  const [memberRevision, setMemberRevision] = useState(0);
  const loadedMemberRoomsRef = useRef(new WeakSet<Room>());

  const candidates = useMemo<EligibleCandidateRoom[]>(() => {
    const sourceEncrypted = !!sourceRoom.hasEncryptionStateEvent?.();
    const recentOrder = new Map<string, number>();
    recentRooms.forEach((entry, index) => recentOrder.set(entry.roomId, index));

    const eligible: EligibleCandidateRoom[] = [];
    for (const roomId of navRoomIds) {
      if (roomId === sourceRoom.roomId) continue;
      const room = mx.getRoom(roomId);
      if (!room || !isJoinedRoom(room) || room.isSpaceRoom()) continue;
      if (!canMessageInRoom(room, myUserId)) continue;
      if (getRoomThreadMode(room) === 'room') continue;
      if (sourceEncrypted && !room.hasEncryptionStateEvent?.()) continue;
      eligible.push({
        room,
        name: room.name || room.roomId,
        alias: room.getCanonicalAlias?.() ?? '',
      });
    }

    eligible.sort((left, right) => {
      const leftRecent = recentOrder.get(left.room.roomId);
      const rightRecent = recentOrder.get(right.room.roomId);
      if (leftRecent !== undefined && rightRecent !== undefined) return leftRecent - rightRecent;
      if (leftRecent !== undefined) return -1;
      if (rightRecent !== undefined) return 1;
      const tsDiff =
        (right.room.getLastActiveTimestamp?.() ?? 0) - (left.room.getLastActiveTimestamp?.() ?? 0);
      return tsDiff !== 0 ? tsDiff : left.name.localeCompare(right.name);
    });
    return eligible;
  }, [mx, myUserId, navRoomIds, recentRooms, sourceRoom]);

  const filteredCandidates = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return candidates;
    return candidates.filter(
      ({ name, alias }) =>
        name.toLowerCase().includes(trimmed) || alias.toLowerCase().includes(trimmed)
    );
  }, [candidates, query]);

  const clampedIndex =
    filteredCandidates.length > 0 ? Math.min(activeIndex, filteredCandidates.length - 1) : -1;

  // Lazy-load full membership for the source room and the top visible candidates (plus an active
  // candidate scrolled beyond the cap) so agent warnings reflect agents in unvisited rooms.
  const extraActiveRoom =
    clampedIndex >= MAX_MEMBER_LOAD_CANDIDATES ? filteredCandidates[clampedIndex]?.room : undefined;
  const roomsToLoad = useMemo(() => {
    const rooms: Room[] = [sourceRoom];
    const seen = new Set<string>([sourceRoom.roomId]);
    for (const candidate of filteredCandidates.slice(0, MAX_MEMBER_LOAD_CANDIDATES)) {
      if (!seen.has(candidate.room.roomId)) {
        seen.add(candidate.room.roomId);
        rooms.push(candidate.room);
      }
    }
    if (extraActiveRoom && !seen.has(extraActiveRoom.roomId)) {
      rooms.push(extraActiveRoom);
    }
    return rooms;
  }, [extraActiveRoom, filteredCandidates, sourceRoom]);

  useEffect(() => {
    let disposed = false;
    const loaded = loadedMemberRoomsRef.current;
    for (const room of roomsToLoad) {
      if (loaded.has(room) || room.membersLoaded?.()) continue;
      const loadMembers = room.loadMembersIfNeeded;
      if (typeof loadMembers !== 'function') continue;
      void (async () => {
        try {
          await loadMembers.call(room);
          if (disposed) return;
          loaded.add(room);
          setMemberRevision((count) => count + 1);
        } catch (error: unknown) {
          if (!disposed) {
            logger.warn('[ForkToRoomDialog] Failed to load room members', error);
          }
        }
      })();
    }
    return () => {
      disposed = true;
    };
  }, [roomsToLoad]);

  const filtered = useMemo<CandidateRoom[]>(() => {
    void memberRevision;
    const sourceMembers = sourceRoom.getMembers?.() ?? [];
    return filteredCandidates.map((candidate) => ({
      ...candidate,
      agentWarning: targetHasUnsharedAgents(sourceMembers, candidate.room.getMembers?.() ?? []),
    }));
  }, [filteredCandidates, memberRevision, sourceRoom]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const optionId = (index: number) => `${listId}-option-${index}`;
  const activeOptionId = clampedIndex >= 0 ? optionId(clampedIndex) : undefined;

  // The search input keeps focus, so the browser scrolls nothing on arrow/Home/End navigation:
  // bring the active option into view so Enter never picks a room scrolled out of sight.
  useLayoutEffect(() => {
    if (!activeOptionId) return;
    document.getElementById(activeOptionId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeOptionId]);

  const handleKeyDown = (evt: KeyboardEvent<HTMLInputElement>) => {
    if (filtered.length === 0) return;
    if (evt.key === 'ArrowDown') {
      evt.preventDefault();
      setActiveIndex((current) => (current + 1) % filtered.length);
    } else if (evt.key === 'ArrowUp') {
      evt.preventDefault();
      setActiveIndex((current) => (current - 1 + filtered.length) % filtered.length);
    } else if (evt.key === 'Home') {
      evt.preventDefault();
      setActiveIndex(0);
    } else if (evt.key === 'End') {
      evt.preventDefault();
      setActiveIndex(filtered.length - 1);
    } else if (evt.key === 'Enter') {
      const chosen = clampedIndex >= 0 ? filtered[clampedIndex] : undefined;
      if (!chosen) return;
      evt.preventDefault();
      onSelect(chosen.room.roomId);
    }
  };

  return (
    <ActionDialog
      label={t('threadFork.forkToRoomTitle')}
      onClose={onClose}
      busy={false}
      initialFocus={() => searchRef.current ?? false}
    >
      <input
        ref={searchRef}
        type="search"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={activeOptionId}
        aria-label={t('threadFork.forkToRoomSearchPlaceholder')}
        placeholder={t('threadFork.forkToRoomSearchPlaceholder')}
        className={css.SearchInput}
        data-fork-room-search=""
        value={query}
        onChange={(evt) => setQuery(evt.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div id={listId} role="listbox" className={css.List} data-fork-room-list="">
        {filtered.length === 0 ? (
          <Text size="T200" priority="300" className={css.EmptyState}>
            {t('threadFork.forkToRoomEmpty')}
          </Text>
        ) : (
          filtered.map((item, index) => {
            const active = index === clampedIndex;
            return (
              <button
                key={item.room.roomId}
                id={optionId(index)}
                type="button"
                role="option"
                aria-selected={active}
                data-fork-room-id={item.room.roomId}
                className={classNames(css.RoomRow, active && css.RoomRowActive)}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => onSelect(item.room.roomId)}
              >
                <span className={css.RoomTitle}>
                  <RoomIcon joinRule={item.room.getJoinRule?.()} size="100" />
                  <Text as="span" size="T300" truncate>
                    {item.name}
                  </Text>
                </span>
                {item.agentWarning && (
                  <span className={css.AgentWarning} data-fork-room-agent-warning="">
                    <Icon size="50" src={Icons.Warning} aria-hidden="true" />
                    <Text as="span" size="T200">
                      {t('threadFork.forkToRoomAgentWarning', { room: sourceRoomName })}
                    </Text>
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </ActionDialog>
  );
}
