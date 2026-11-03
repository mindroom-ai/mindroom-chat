/** Removes every leading slash. */
export const trimLeadingSlash = (value: string): string => value.replace(/^\/+/, '');

/** Removes every trailing slash. */
export const trimTrailingSlash = (value: string): string => {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
};

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** A byte count for people, in powers of 1024 with up to one decimal ("1.5 MB"). */
export const bytesToSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), SIZE_UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  const rounded = exponent === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${SIZE_UNITS[exponent]}`;
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

/** Runs `fn` at most once per `wait` milliseconds, with the latest arguments. */
export const throttle = <A extends unknown[]>(fn: (...args: A) => void, wait: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: A | undefined;
  return (...args: A) => {
    latest = args;
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (latest) fn(...latest);
    }, wait);
  };
};

export const suffixRename = (name: string, taken: (candidate: string) => boolean): string => {
  let index = 1;
  let candidate = name;
  while (taken(candidate)) {
    index += 1;
    candidate = `${name}${index}`;
  }
  return candidate;
};

export const binarySearch = <T>(items: T[], compare: (item: T) => -1 | 0 | 1): T | undefined => {
  let low = 0;
  let high = items.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const order = compare(items[middle]);
    if (order === 0) return items[middle];
    if (order > 0) high = middle - 1;
    else low = middle + 1;
  }
  return undefined;
};
