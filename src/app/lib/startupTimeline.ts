// App phase names live in lib/ because it is the lowest layer every caller can import.
const PREFIX = 'mindroom.startup.';
type PagePhase = 'js.entry' | 'config.ready' | 'splash.shown';
type ClientPhase =
  | `client.init.${'start' | 'parallel.start' | 'done'}`
  | `crypto.store.${'probe' | 'preflight.done'}`
  | 'store.startup.done'
  | 'streaming.restore.done'
  | 'crypto.init.done'
  | 'identity.check.done'
  | 'saved_sync.read.done'
  | `sync.${'prepared.cache' | 'first_live'}`
  | `shell.${'committed' | 'frame'}`;

const ENUMS = ['unavailable', 'present', 'missing', 'recorded', 'recorded_now', 'unrecorded'];
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
 * js.entry follows static module evaluation; config.ready records acceptance, not a render.
 * Measure store.startup.done and crypto.init.done each from client.init.parallel.start; they overlap.
 * saved_sync.read.done times getSavedSync. Its rooms, timelineEvents and stateEvents count what
 * the replay will process (array lengths, including both state arrays, not distinct events).
 * cacheHit distinguishes no saved sync from a saved sync with no rooms. identity.check.done times
 * the identity check and tells whether the key was recorded before, recorded now, or still absent.
 * splash.shown and shell.committed record React commits. shell.frame is a frame opportunity,
 * not proof of paint.
 */
export const readStartupTimeline = () => ({ timeOrigin, marks: marks.slice() });
