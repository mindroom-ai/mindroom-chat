/** Removes every leading slash. */
export const trimLeadingSlash = (value: string): string => value.replace(/^\/+/, '');

/** Removes every trailing slash. */
export const trimTrailingSlash = (value: string): string => {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
};

const SIZE_UNITS = ['KB', 'MB', 'GB', 'TB'];

/** A byte count for people in powers of 1000, at least in KB, with one decimal ("2.4 KB"). */
export const bytesToSize = (bytes: number): string => {
  const value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const exponent =
    value > 0
      ? Math.min(Math.max(Math.floor(Math.log10(value) / 3) - 1, 0), SIZE_UNITS.length - 1)
      : 0;
  return `${(value / 1000 ** (exponent + 1)).toFixed(1)} ${SIZE_UNITS[exponent]}`;
};

/** `m:ss` for a duration in whole seconds; fractions round down. */
export const secondsToMinutesAndSeconds = (seconds: number): string => {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
};

export const millisecondsToMinutesAndSeconds = (milliseconds: number): string =>
  secondsToMinutesAndSeconds(milliseconds / 1000);

/** Up to `count` initials of a display name, for avatar fallbacks. */
export const nameInitials = (name: string | null | undefined, count = 1): string => {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const initials = words.slice(0, count).map((word) => Array.from(word)[0] ?? '');
  return initials.join('').toUpperCase();
};
