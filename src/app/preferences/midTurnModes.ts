/**
 * What a message sent while an agent replies in its thread asks of that reply
 * (`matrix/protocol/midTurn.ts`): steer it, wait for it, or let the agent decide. Its own file, so
 * that `settings.ts` and `roamingSettings.ts` both read it without importing each other.
 */
export const MID_TURN_MODES = ['steer', 'queue', 'auto'] as const;
export type MidTurnMode = (typeof MID_TURN_MODES)[number];
export const isMidTurnMode = (value: unknown): value is MidTurnMode =>
  MID_TURN_MODES.includes(value as MidTurnMode);
