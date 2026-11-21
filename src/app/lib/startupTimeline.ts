const PREFIX = 'mindroom.startup.';
const PAGE_PHASES = ['js.entry', 'config.ready', 'splash.shown'] as const;
const CLIENT_PHASES = [
  'client.init.start',
  'crypto.store.probe',
  'crypto.store.preflight.done',
  'store.startup.done',
  'streaming.restore.done',
  'crypto.init.done',
  'identity.check.done',
  'client.init.done',
  'saved_sync.read.done',
  'sync.prepared.cache',
  'shell.shown',
  'sync.first_live',
] as const;
type PagePhase = (typeof PAGE_PHASES)[number];
type ClientPhase = (typeof CLIENT_PHASES)[number];
type Detail = Record<string, number | boolean | string>;
export type MarkClientStartup = (phase: ClientPhase, detail?: Detail) => void;

const names = new Set([...PAGE_PHASES, ...CLIENT_PHASES].map((phase) => `${PREFIX}${phase}`));
export const isStartupMarkName = (name: string): boolean => names.has(name);

export type StartupMarks = Readonly<{ timeOrigin: number; atMs: Readonly<Record<string, number>> }>;
let startupMarks: StartupMarks | undefined;
export const getStartupMarks = () => startupMarks;

const pending = new Set(names);
const markOnce = (phase: PagePhase | ClientPhase, detail?: Detail, startTime?: number): void => {
  const name = `${PREFIX}${phase}`;
  if (!pending.delete(name)) return;
  try {
    const { startTime: atMs } = performance.mark(name, { detail, startTime });
    const { timeOrigin } = performance;
    if (!Number.isFinite(timeOrigin)) return;
    startupMarks = Object.freeze({
      timeOrigin,
      atMs: Object.freeze({ ...startupMarks?.atMs, [name]: atMs }),
    });
  } catch {
    // Missing User Timing support must not interrupt startup.
  }
};

export const markPageStartup = (phase: PagePhase, startTime?: number): void =>
  markOnce(phase, undefined, startTime);
export const clientStartupMarks = new WeakMap<object, MarkClientStartup>();

let claimed = false;
/** Once an attempt claims the timeline, even a cancelled attempt cannot be replaced. */
export const claimClientStartup = (isActive: () => boolean): MarkClientStartup | undefined => {
  if (claimed) return undefined;
  claimed = true;
  return (phase, detail) => {
    if (isActive()) markOnce(phase, detail);
  };
};

export const readStartupTimeline = () => {
  const marks = (globalThis.performance?.getEntriesByType?.('mark') ?? [])
    .filter(({ name }) => name.startsWith(PREFIX))
    .map((entry) => ({
      name: entry.name,
      atMs: entry.startTime,
      detail: ((entry as PerformanceMark).detail ?? null) as unknown,
    }));
  return {
    timeOrigin: globalThis.performance?.timeOrigin ?? null,
    marks,
    phases: marks.flatMap((mark, index) => {
      const previous = marks[index - 1];
      return previous
        ? [{ from: previous.name, to: mark.name, durationMs: mark.atMs - previous.atMs }]
        : [];
    }),
  };
};
