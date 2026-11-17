import {
  isDeepTraceRecording,
  recordDeepTraceEvent,
  subscribeDeepTraceStatus,
  type DeepTraceData,
  type DeepTraceRuntimeStatus,
} from './deepTrace';

/**
 * Memory figures in the deep trace. The iOS app is killed for memory without a word in the web
 * view, so each `memory.sample` event records cheap counters (DOM nodes, the JS heap where the
 * engine reports it, rooms, events and threads in the client, open cache transactions): a trace
 * that ends in a reload shows what grew before it. Samples come every minute while the page is
 * visible, once as it hides, and at each thread open, and only while the deep trace records.
 */

export const MEMORY_SAMPLE_INTERVAL_MS = 60_000;

/** Why a sample was taken; recorded as a `reason_<reason>` flag, since trace data keeps no text. */
export type MemorySampleReason = 'start' | 'interval' | 'hidden' | 'thread_open';

/** Reads one counter; undefined where it does not apply. It must not walk events or allocate much. */
export type MemoryGauge = () => number | undefined;

const BYTES_PER_MB = 1024 * 1024;

const roundTenth = (value: number): number => Math.round(value * 10) / 10;

type PerformanceWithMemory = Performance & { memory?: { usedJSHeapSize?: number } };

/** Only Chromium reports its heap; Safari and Firefox leave it out. */
const readJsHeapUsedMb = (): number | undefined => {
  const used = (performance as PerformanceWithMemory).memory?.usedJSHeapSize;
  return typeof used === 'number' ? roundTenth(used / BYTES_PER_MB) : undefined;
};

const BUILT_IN_GAUGES: ReadonlyArray<readonly [string, MemoryGauge]> = [
  ['dom_nodes', () => document.getElementsByTagName('*').length],
  ['js_heap_used_mb', readJsHeapUsedMb],
  ['uptime_s', () => Math.round(performance.now() / 1000)],
];

const gauges = new Map<string, MemoryGauge>();

/**
 * Adds a counter to every later sample under `name` (a trace data key: lowercase letters, digits
 * and underscores). A later gauge of the same name takes its place. Returns the function that
 * removes it, which leaves a newer gauge of that name alone.
 */
export const registerMemoryGauge = (name: string, read: MemoryGauge): (() => void) => {
  gauges.set(name, read);
  return () => {
    if (gauges.get(name) === read) gauges.delete(name);
  };
};

/** Records one `memory.sample` with every gauge's value; nothing while the deep trace is off. */
export const sampleMemory = (reason: MemorySampleReason): void => {
  if (!isDeepTraceRecording()) return;
  // The reason goes first: the trace keeps a limited number of fields per event.
  const data: DeepTraceData = { [`reason_${reason}`]: true };
  for (const [name, read] of [...BUILT_IN_GAUGES, ...gauges]) {
    try {
      const value = read();
      if (typeof value === 'number' && Number.isFinite(value)) data[name] = value;
    } catch {
      // A gauge that cannot read leaves its field out; the others still count.
    }
  }
  recordDeepTraceEvent('memory.sample', data, { flush: reason === 'hidden' });
};

const isRecordingStatus = (status: DeepTraceRuntimeStatus): boolean =>
  status === 'recording' || status === 'memory-only' || status === 'starting';

let stopSampler: (() => void) | undefined;

/**
 * Samples every minute while the page is visible and once as it hides, for as long as the deep
 * trace records; while it is off no timer or listener runs. Calling it again returns the running
 * sampler's stop function.
 */
export const startMemorySampler = (): (() => void) => {
  if (stopSampler) return stopSampler;
  let recording = false;
  let timer: number | undefined;

  const stopTimer = () => {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
  };
  const startTimer = () => {
    if (timer !== undefined || document.visibilityState !== 'visible') return;
    timer = window.setInterval(() => sampleMemory('interval'), MEMORY_SAMPLE_INTERVAL_MS);
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      startTimer();
      return;
    }
    sampleMemory('hidden');
    stopTimer();
  };

  const unsubscribe = subscribeDeepTraceStatus((status) => {
    const next = isRecordingStatus(status);
    if (next === recording) return;
    recording = next;
    if (next) {
      document.addEventListener('visibilitychange', onVisibility);
      sampleMemory('start');
      startTimer();
      return;
    }
    document.removeEventListener('visibilitychange', onVisibility);
    stopTimer();
  });

  const stop = () => {
    if (stopSampler !== stop) return;
    stopSampler = undefined;
    unsubscribe();
    document.removeEventListener('visibilitychange', onVisibility);
    stopTimer();
  };
  stopSampler = stop;
  return stop;
};
