const PREFIX = 'mindroom.startup.';
const PAGE_PHASES = ['js.entry', 'config.ready', 'splash.shown'] as const;
const CLIENT_PHASES = [
  'client.init.start',
  'crypto.store.probe',
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

const seen = new Set<PagePhase | ClientPhase>();
const markOnce = (phase: PagePhase | ClientPhase, detail?: Detail): void => {
  if (seen.has(phase)) return;
  seen.add(phase);
  try {
    performance.mark(`${PREFIX}${phase}`, { detail });
  } catch {
    // Missing User Timing support must not interrupt startup.
  }
};

export const markPageStartup = (phase: PagePhase): void => markOnce(phase);

let claimed = false;
/** Once an attempt claims the timeline, even a cancelled attempt cannot be replaced. */
export const claimClientStartup = () => {
  if (claimed) return undefined;
  claimed = true;
  let active = true;
  const mark: MarkClientStartup = (phase, detail) => {
    if (active) markOnce(phase, detail);
  };
  return {
    mark,
    cancel: () => {
      active = false;
    },
  };
};

export const readStartupMarks = () =>
  (globalThis.performance?.getEntriesByType?.('mark') ?? [])
    .filter(({ name }) => name.startsWith(PREFIX))
    .map((entry) => ({
      name: entry.name,
      atMs: entry.startTime,
      detail: ((entry as PerformanceMark).detail ?? null) as unknown,
    }));

export const readStartupTimeline = () => {
  const marks = readStartupMarks();
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
