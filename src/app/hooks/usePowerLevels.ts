import { createContext, useCallback, useContext, useMemo } from 'react';
import { EventTimeline, MatrixEvent, Room } from 'matrix-js-sdk';
import { StateEvent } from '../../types/matrix/room';
import { useStateEventCallback } from './useStateEventCallback';
import { useForceUpdate } from './useForceUpdate';
import { matchesEnum } from '../utils/matchesEnum';

/** Levels keyed by event type, user ID or notification key. */
type LevelMap = Record<string, number>;

/** `m.room.power_levels` content; absent fields take the defaults of the Matrix specification. */
export type IPowerLevels = {
  users_default?: number;
  events_default?: number;
  state_default?: number;
  ban?: number;
  kick?: number;
  redact?: number;
  invite?: number;
  /** Per event type levels for sending message and state events. */
  events?: LevelMap;
  /** Per user levels; everyone else has `users_default`. */
  users?: LevelMap;
  /** Levels for notification keys such as `room` (the `@room` mention). */
  notifications?: LevelMap;
};

/** The top-level power levels that gate an action on other users or their events. */
export type PowerLevelAction = 'ban' | 'invite' | 'kick' | 'redact';

// Matrix spec, client-server API, `m.room.power_levels`: most levels default to 50 when the
// event leaves them out; `invite` defaults to 0.
const MODERATOR_LEVEL = 50;

const DEFAULT_ACTION_LEVEL: Record<PowerLevelAction, number> = {
  invite: 0,
  ban: MODERATOR_LEVEL,
  kick: MODERATOR_LEVEL,
  redact: MODERATOR_LEVEL,
};

const DEFAULT_NOTIFICATION_LEVEL: LevelMap = { room: MODERATOR_LEVEL };

const isLevel = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const readLevelMap = (value: unknown): LevelMap | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, number] =>
      isLevel(entry[1])
    )
  );
};

/**
 * Reads power levels from an `m.room.power_levels` event. Without the event every level is 0
 * except moderation actions; with it, unset state events default to 50 as the specification says.
 */
export const getPowersLevelFromMatrixEvent = (event?: MatrixEvent | null): IPowerLevels => {
  if (!event) return { users_default: 0, events_default: 0, state_default: 0 };
  const content = event.getContent();
  const levels: IPowerLevels = {};
  (
    ['users_default', 'events_default', 'state_default', 'ban', 'kick', 'redact', 'invite'] as const
  ).forEach((key) => {
    if (isLevel(content[key])) levels[key] = content[key];
  });
  levels.events = readLevelMap(content.events);
  levels.users = readLevelMap(content.users);
  levels.notifications = readLevelMap(content.notifications);
  return levels;
};

export const readPowerLevel = {
  user: (powerLevels: IPowerLevels | undefined, userId: string | undefined): number => {
    const userLevel = userId ? powerLevels?.users?.[userId] : undefined;
    return userLevel ?? powerLevels?.users_default ?? 0;
  },
  event: (powerLevels: IPowerLevels | undefined, eventType: string | undefined): number => {
    const eventLevel = eventType ? powerLevels?.events?.[eventType] : undefined;
    return eventLevel ?? powerLevels?.events_default ?? 0;
  },
  state: (powerLevels: IPowerLevels | undefined, eventType: string | undefined): number => {
    const eventLevel = eventType ? powerLevels?.events?.[eventType] : undefined;
    return eventLevel ?? powerLevels?.state_default ?? MODERATOR_LEVEL;
  },
  action: (powerLevels: IPowerLevels | undefined, action: PowerLevelAction): number =>
    powerLevels?.[action] ?? DEFAULT_ACTION_LEVEL[action],
  notification: (powerLevels: IPowerLevels | undefined, key: string): number =>
    powerLevels?.notifications?.[key] ?? DEFAULT_NOTIFICATION_LEVEL[key] ?? MODERATOR_LEVEL,
};

const getPowerLevelsEvent = (room: Room): MatrixEvent | undefined =>
  room
    .getLiveTimeline()
    .getState(EventTimeline.FORWARDS)
    ?.getStateEvents(StateEvent.RoomPowerLevels, '') ?? undefined;

/** The room's power levels, following `m.room.power_levels` changes. */
export const usePowerLevels = (room: Room): IPowerLevels => {
  const [version, refresh] = useForceUpdate();
  const onPowerLevelsChange = useCallback(
    (event: MatrixEvent) => {
      if (
        event.getRoomId() === room.roomId &&
        matchesEnum(event.getType(), StateEvent.RoomPowerLevels)
      ) {
        refresh();
      }
    },
    [room.roomId, refresh]
  );
  useStateEventCallback(room.client, onPowerLevelsChange);

  return useMemo(() => {
    void version;
    return getPowersLevelFromMatrixEvent(getPowerLevelsEvent(room));
  }, [room, version]);
};

const PowerLevelsContext = createContext<IPowerLevels | undefined>(undefined);

/** Shares one room's power levels with everything rendered inside that room. */
export const PowerLevelsContextProvider = PowerLevelsContext.Provider;

/** The power levels of the surrounding `PowerLevelsContextProvider`. */
export const usePowerLevelsContext = (): IPowerLevels => {
  const powerLevels = useContext(PowerLevelsContext);
  if (!powerLevels) throw new Error('Power levels are not provided!');
  return powerLevels;
};
