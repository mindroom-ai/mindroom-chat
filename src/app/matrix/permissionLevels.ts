import { type IPowerLevels, readPowerLevel } from './hooks/usePowerLevels';

/** Where in `m.room.power_levels` a permission keeps its level. */
export type LevelSlot =
  | { kind: 'event'; type: string }
  | { kind: 'state'; type: string }
  | { kind: 'action'; action: 'invite' | 'kick' | 'ban' | 'redact' }
  | { kind: 'notification'; key: string }
  | { kind: 'field'; field: 'events_default' | 'state_default' | 'users_default' };

/** The level a slot asks for, with the Matrix specification's defaults where the room sets none. */
export const levelIn = (levels: IPowerLevels, slot: LevelSlot): number => {
  switch (slot.kind) {
    case 'event':
      return readPowerLevel.event(levels, slot.type);
    case 'state':
      return readPowerLevel.state(levels, slot.type);
    case 'action':
      return readPowerLevel.action(levels, slot.action);
    case 'notification':
      return readPowerLevel.notification(levels, slot.key);
    default:
      return levels[slot.field] ?? (slot.field === 'state_default' ? 50 : 0);
  }
};

/** The power levels content with one slot moved to `level`, keeping everything else as stored. */
export const withLevel = (content: Record<string, unknown>, slot: LevelSlot, level: number) => {
  const next: Record<string, unknown> = { ...content };
  const nested = (key: 'events' | 'notifications', name: string) => {
    const map = next[key];
    next[key] = { ...(map && typeof map === 'object' ? map : {}), [name]: level };
  };
  if (slot.kind === 'event' || slot.kind === 'state') nested('events', slot.type);
  else if (slot.kind === 'notification') nested('notifications', slot.key);
  else if (slot.kind === 'action') next[slot.action] = level;
  else next[slot.field] = level;
  return next;
};
