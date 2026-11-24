import {
  isDeepTraceRecording,
  recordDeepTraceEvent,
  subscribeDeepTraceStatus,
  type DeepTraceData,
  type DeepTraceRuntimeStatus,
} from './deepTrace';
import { installMemoryHooks, readMediaMemory, readWasmMemoryMb } from './mediaMemory';

/**
 * Memory figures in the deep trace. The iOS app is killed for memory without a word in the web
 * view, so each `memory.sample` event records cheap counters (DOM and Shadow DOM nodes, the JS
 * heap where the engine reports it, rooms, events and threads in the client, open cache
 * transactions): a trace that ends in a reload shows what grew before it. A `memory.media` event
 * beside each sample counts what lives outside the JS heap (object URLs, decoded images, canvases;
 * mediaMemory.ts). Samples come every minute while the page is visible, once as it hides, at each
 * thread open, and when a plugin side panel opens or closes, and only while the deep trace records.
 */

export const MEMORY_SAMPLE_INTERVAL_MS = 60_000;

/** Why a sample was taken; recorded as a `reason_<reason>` flag, since trace data keeps no text. */
export type MemorySampleReason =
  'start' | 'interval' | 'hidden' | 'thread_open' | 'plugin_panel_open' | 'plugin_panel_close';

/** Reads one counter; undefined where it does not apply. It must not walk events or allocate much. */
export type MemoryGauge = () => number | undefined;

/** Reads several counters in one pass, by field name; same rules as a single gauge. */
export type MemoryGaugeGroup = () => Readonly<Record<string, number | undefined>>;

const BYTES_PER_MB = 1024 * 1024;

const roundTenth = (value: number): number => Math.round(value * 10) / 10;

type PerformanceWithMemory = Performance & { memory?: { usedJSHeapSize?: number } };

/** Only Chromium reports its heap; Safari and Firefox leave it out. */
const readJsHeapUsedMb = (): number | undefined => {
  const used = (performance as PerformanceWithMemory).memory?.usedJSHeapSize;
  return typeof used === 'number' ? roundTenth(used / BYTES_PER_MB) : undefined;
};

const countElements = (root: ParentNode, shadowQueue: ShadowRoot[]): number => {
  let count = 0;
  const stack: Element[] = [];
  let current: Element | null | undefined = root.firstElementChild;
  while (current) {
    count += 1;
    const shadow = current.shadowRoot;
    if (shadow) shadowQueue.push(shadow);
    if (current.nextElementSibling) stack.push(current.nextElementSibling);
    current = current.firstElementChild ?? stack.pop();
  }
  return count;
};

/** Counts light DOM elements, open shadow roots, and elements inside them in one iterative walk. */
const readDomGauges = (): Readonly<Record<string, number>> => {
  if (typeof document === 'undefined') return {};
  const shadowQueue: ShadowRoot[] = [];
  const domNodes = countElements(document, shadowQueue);
  let shadowRoots = 0;
  let shadowDomNodes = 0;
  for (let shadow = shadowQueue.pop(); shadow; shadow = shadowQueue.pop()) {
    shadowRoots += 1;
    shadowDomNodes += countElements(shadow, shadowQueue);
  }
  return {
    dom_nodes: domNodes,
    shadow_roots: shadowRoots,
    shadow_dom_nodes: shadowDomNodes,
  };
};

const BUILT_IN_GROUPS: readonly MemoryGaugeGroup[] = [
  readDomGauges,
  () => ({ js_heap_used_mb: readJsHeapUsedMb() }),
  () => ({ uptime_s: Math.round(performance.now() / 1000) }),
  () => ({ wasm_memory_mb: readWasmMemoryMb() }),
];

const groups = new Map<string, MemoryGaugeGroup>();

/**
 * Adds counters to every later sample, read together in one pass; each field name is a trace data
 * key (lowercase letters, digits and underscores). A later group under the same `name` takes its
 * place. Returns the function that removes it, which leaves a newer group of that name alone.
 */
export const registerMemoryGauges = (name: string, read: MemoryGaugeGroup): (() => void) => {
  groups.set(name, read);
  return () => {
    if (groups.get(name) === read) groups.delete(name);
  };
};

/** Adds one counter under `name`, with the same replace and remove rules as a group. */
export const registerMemoryGauge = (name: string, read: MemoryGauge): (() => void) =>
  registerMemoryGauges(name, () => ({ [name]: read() }));

const addValue = (data: DeepTraceData, name: string, value: number | undefined): void => {
  if (typeof value === 'number' && Number.isFinite(value)) data[name] = value;
};

const readGroup = (data: DeepTraceData, read: MemoryGaugeGroup): void => {
  try {
    Object.entries(read()).forEach(([name, value]) => addValue(data, name, value));
  } catch {
    // A group that cannot read leaves its fields out; the others still count.
  }
};

/** Records one `memory.sample` with every gauge's value; nothing while the deep trace is off. */
export const sampleMemory = (reason: MemorySampleReason): void => {
  if (!isDeepTraceRecording()) return;
  // The reason goes first: the trace keeps a limited number of fields per event.
  const data: DeepTraceData = { [`reason_${reason}`]: true };
  BUILT_IN_GROUPS.forEach((read) => readGroup(data, read));
  groups.forEach((read) => readGroup(data, read));
  // Thread opens and plugin panel transitions can precede an iOS WebContent kill, so write them at
  // once like hidden samples: a killed web view loses what was still queued.
  const flush =
    reason === 'hidden' ||
    reason === 'thread_open' ||
    reason === 'plugin_panel_open' ||
    reason === 'plugin_panel_close';
  // Its own event, as the sample would pass the field limit; queued first, so the sample's flush
  // writes it too.
  try {
    recordDeepTraceEvent(
      'memory.media',
      { [`reason_${reason}`]: true, ...readMediaMemory() },
      { flush: false }
    );
  } catch {
    // The media counters are left out; the sample still counts.
  }
  recordDeepTraceEvent('memory.sample', data, { flush });
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
  let uninstallHooks: (() => void) | undefined;
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
    uninstallHooks?.();
    uninstallHooks = undefined;
    if (next) {
      // Only while recording; at launch that is before the crypto module loads.
      uninstallHooks = installMemoryHooks();
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
    uninstallHooks?.();
    uninstallHooks = undefined;
    document.removeEventListener('visibilitychange', onVisibility);
    stopTimer();
  };
  stopSampler = stop;
  return stop;
};
