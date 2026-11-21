// App phase names live in lib/ because it is the lowest layer every caller can import.
const PREFIX = 'mindroom.startup.';
type PagePhase = 'js.entry' | 'config.ready' | 'splash.shown' | `${'pages' | 'room'}.loaded`;
type ClientPhase =
  | `client.init.${'start' | 'parallel.start' | 'done'}`
  | 'crypto.store.probe'
  | 'store.startup.done'
  | 'streaming.restore.done'
  | 'crypto.init.done'
  | 'identity.check.done'
  | 'saved_sync.read.done'
  | `sync.${'started' | 'prepared.cache' | 'first_live'}`
  | 'atoms.seeding'
  | `shell.${'committed' | 'frame'}`;

const ENUMS = ['unavailable', 'present', 'missing'];
type Detail = Readonly<Record<string, number | boolean | string>>;
const isSafeDetail = ([, v]: [string, Detail[string]]): boolean =>
  typeof v === 'string' ? ENUMS.includes(v) : typeof v === 'boolean' || Number.isFinite(v);
export type MarkClientStartup = (phase: ClientPhase, detail?: Detail) => boolean;
type StartupMark = Readonly<{ name: string; atMs: number; detail: Detail | null }>;
const timeOrigin = globalThis.performance?.timeOrigin ?? null;
const marks: StartupMark[] = [];

const markOnce = (phase: PagePhase | ClientPhase, detail?: Detail): boolean => {
  const name = `${PREFIX}${phase}`;
  if (marks.some((mark) => mark.name === name)) return false;
  const atMs = globalThis.performance?.now();
  if (atMs === undefined || !Number.isFinite(atMs)) return false;
  const safeDetail = detail
    ? Object.fromEntries(Object.entries(detail).filter(isSafeDetail))
    : null;
  marks.push({ name, atMs, detail: safeDetail });
  try {
    performance.mark(name, { detail: safeDetail, startTime: atMs });
  } catch {
    // Missing User Timing support must not interrupt startup or prevent export.
  }
  return true;
};

export const markPageStartup = (phase: PagePhase): void => void markOnce(phase);
export const clientStartupMarks = new WeakMap<object, MarkClientStartup>();

let claimed = false;
/** Once an attempt claims the timeline, even a cancelled attempt cannot be replaced. */
export const claimClientStartup = (isActive: () => boolean): MarkClientStartup | undefined => {
  if (claimed) return undefined;
  claimed = true;
  return (phase, detail) => isActive() && markOnce(phase, detail);
};

/**
 * The first startup attempt only. Add atMs to timeOrigin (epoch ms) to align with native logs.
 * navigation gives document responseEnd and domInteractive relative to timeOrigin, or null.
 * js.entry follows static module evaluation; config.ready records acceptance, not a render.
 * Between crypto.store.probe (missing) and client.init.parallel.start, startup can check server keys.
 * Measure store.startup.done and crypto.init.done each from client.init.parallel.start; they overlap.
 * saved_sync.read.done times getSavedSync and counts the rooms and event array lengths it returns,
 * including both joined state arrays. cacheHit distinguishes no saved sync from zero rooms.
 * identity.check.done times the post-open identity check; about 10 s can mean a /keys/query timeout.
 * sync.started marks startClient resolving (after any /versions wait), before the first live sync.
 * pages.loaded and room.loaded mark the signed-in route and room imports resolving, possibly
 * before sync.prepared.cache; shell.committed can precede room.loaded while a room route waits.
 * atoms.seeding marks the layout effect before atom bindings seed the signed-in pages. A version
 * cache miss can also wait for /versions before the shell. splash.shown and shell.committed are
 * React commits; shell.frame is a frame opportunity, not proof of paint.
 */
export const readStartupTimeline = () => {
  const entry = globalThis.performance?.getEntriesByType?.('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined;
  const navigation = entry
    ? { responseEnd: entry.responseEnd, domInteractive: entry.domInteractive }
    : null;
  return { timeOrigin, navigation, marks: marks.slice() };
};
