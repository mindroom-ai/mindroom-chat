import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Icon, Icons, Text } from 'folds';
import { EventTimeline, KnownMembership, type Room, type RoomMember } from 'matrix-js-sdk';
import classNames from 'classnames';
import { RoomIcon } from '../../avatars/RoomAvatar';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { getPowersLevelFromMatrixEvent } from '../../matrix/hooks/usePowerLevels';
import { getRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { getRoomPermissionsAPI } from '../../matrix/hooks/useRoomPermissions';
import { isMindroomAgentUserId } from '../../matrix/protocol/agentIdentity';
import { getRoomThreadMode } from '../../matrix/protocol/roomThreadMode';
import { navigationRoomsAtom } from '../../matrix/state/archivedRooms';
import { StateEvent } from '../../matrix/types/room';
import { getRecentRoomsAtom } from '../../navigation/recentRooms';
import { isJoinedRoom } from '../../navigation/routeVisibility';
import { ActionDialog } from '../../ui/ActionDialog';
import * as css from './ForkToRoomDialog.css';

/**
 * Whether `targetMembers` includes at least one active (joined or invited) MindRoom agent and
 * none of those agents are joined to the source room.
 */
export const targetHasUnsharedAgents = (
  sourceMembers: readonly Pick<RoomMember, 'membership' | 'userId'>[],
  targetMembers: readonly Pick<RoomMember, 'membership' | 'userId'>[]
): boolean => {
  const targetAgents = targetMembers.filter(
    ({ membership, userId }) =>
      (membership === KnownMembership.Join || membership === KnownMembership.Invite) &&
      isMindroomAgentUserId(userId)
  );
  if (targetAgents.length === 0) return false;
  const sourceJoined = new Set(
    sourceMembers
      .filter(({ membership }) => membership === KnownMembership.Join)
      .map(({ userId }) => userId)
  );
  return !targetAgents.some(({ userId }) => sourceJoined.has(userId));
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

type CandidateRoom = {
  room: Room;
  name: string;
  alias: string;
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

  const candidates = useMemo<CandidateRoom[]>(() => {
    const sourceEncrypted = !!sourceRoom.hasEncryptionStateEvent?.();
    const sourceMembers = sourceRoom.getMembers?.() ?? [];
    const recentOrder = new Map<string, number>();
    recentRooms.forEach((entry, index) => recentOrder.set(entry.roomId, index));

    const eligible: CandidateRoom[] = [];
    for (const roomId of navRoomIds) {
      if (roomId === sourceRoom.roomId) continue;
      const room = mx.getRoom(roomId);
      if (!room || !isJoinedRoom(room) || room.isSpaceRoom()) continue;
      if (!canMessageInRoom(room, myUserId)) continue;
      if (getRoomThreadMode(room) === 'room') continue;
      if (sourceEncrypted && !room.hasEncryptionStateEvent?.()) continue;
      const targetMembers = room.getMembers?.() ?? [];
      eligible.push({
        room,
        name: room.name || room.roomId,
        alias: room.getCanonicalAlias?.() ?? '',
        agentWarning: targetHasUnsharedAgents(sourceMembers, targetMembers),
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

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return candidates;
    return candidates.filter(
      ({ name, alias }) =>
        name.toLowerCase().includes(trimmed) || alias.toLowerCase().includes(trimmed)
    );
  }, [candidates, query]);

  const clampedIndex = filtered.length > 0 ? Math.min(activeIndex, filtered.length - 1) : -1;

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const activeOptionId =
    clampedIndex >= 0 ? `${listId}-option-${clampedIndex}` : undefined;

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
                id={`${listId}-option-${index}`}
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
