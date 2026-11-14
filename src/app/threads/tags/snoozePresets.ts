export type SnoozePresetId = 'inOneHour' | 'inThreeHours' | 'tomorrow' | 'nextMonday';

const HOUR_MS = 60 * 60 * 1000;
const MONDAY = 1;
const WAKE_HOUR = 9;

/**
 * The picker's preset times from `now`, in local time. The two 09:00 presets are built from the
 * calendar fields, so a daylight-saving change between now and then keeps them at 09:00.
 */
export const snoozePresets = (now: Date): { id: SnoozePresetId; until: Date }[] => {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  // Days to the next Monday; a Monday goes to the one after.
  const toMonday = (MONDAY - now.getDay() + 7) % 7 || 7;
  return [
    { id: 'inOneHour', until: new Date(now.getTime() + HOUR_MS) },
    { id: 'inThreeHours', until: new Date(now.getTime() + 3 * HOUR_MS) },
    { id: 'tomorrow', until: new Date(year, month, day + 1, WAKE_HOUR) },
    { id: 'nextMonday', until: new Date(year, month, day + toMonday, WAKE_HOUR) },
  ];
};

const pad = (value: number) => String(value).padStart(2, '0');

/** A local time as a `datetime-local` input value, to the minute: `YYYY-MM-DDTHH:mm`. */
export const toDateTimeLocalValue = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;

const DATE_TIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** The local time a `datetime-local` input value names; undefined for an empty or invalid one. */
export const parseDateTimeLocalValue = (value: string): Date | undefined => {
  const match = DATE_TIME_LOCAL.exec(value);
  if (!match) return undefined;
  const [year = 0, month = 1, day = 1, hours = 0, minutes = 0, seconds = 0] = match
    .slice(1)
    .map((part) => Number(part ?? 0));
  const date = new Date(year, month - 1, day, hours, minutes, seconds);
  return Number.isFinite(date.getTime()) ? date : undefined;
};
