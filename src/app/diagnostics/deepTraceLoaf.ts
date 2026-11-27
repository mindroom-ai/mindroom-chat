const LOAF_DURATION_THRESHOLD_MS = 50;

export const LOAF_INVOKER_TYPES = new Set([
  'classic-script',
  'module-script',
  'event-listener',
  'user-callback',
  'resolve-promise',
  'reject-promise',
  'other',
]);

type LongAnimationFrameScript = {
  duration?: number;
  invokerType?: string;
  sourceCharPosition?: number;
};

type LongAnimationFrameEntry = PerformanceEntry & {
  blockingDuration?: number;
  renderStart?: number;
  styleAndLayoutStart?: number;
  scripts?: ReadonlyArray<LongAnimationFrameScript>;
};

export type LongAnimationFrameData = Record<string, number | string | null>;

const roundMetric = (value: number): number => Math.round(value * 10) / 10;

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const sanitizeInvokerType = (value: unknown): string =>
  typeof value === 'string' && LOAF_INVOKER_TYPES.has(value) ? value : 'other';

const extractLongAnimationFrameData = (
  entry: LongAnimationFrameEntry
): LongAnimationFrameData | undefined => {
  const duration = Math.max(0, finiteNumber(entry.duration) ?? 0);
  const blocking = Math.max(0, finiteNumber(entry.blockingDuration) ?? 0);
  if (duration < LOAF_DURATION_THRESHOLD_MS && blocking <= 0) return undefined;

  const startTime = finiteNumber(entry.startTime) ?? 0;
  const renderStart = finiteNumber(entry.renderStart) ?? 0;
  const styleStart = finiteNumber(entry.styleAndLayoutStart) ?? 0;
  const scripts = Array.isArray(entry.scripts) ? entry.scripts : [];
  let topScript: LongAnimationFrameScript | undefined;
  let topScriptDuration = -1;
  for (const script of scripts) {
    const scriptDuration = Math.max(0, finiteNumber(script?.duration) ?? 0);
    if (!topScript || scriptDuration > topScriptDuration) {
      topScript = script;
      topScriptDuration = scriptDuration;
    }
  }
  const topPos = topScript ? finiteNumber(topScript.sourceCharPosition) : undefined;

  return {
    duration_ms: roundMetric(duration),
    blocking_ms: roundMetric(blocking),
    ...(renderStart > 0
      ? { render_delay_ms: roundMetric(Math.max(0, renderStart - startTime)) }
      : {}),
    ...(styleStart > 0
      ? { style_layout_ms: roundMetric(Math.max(0, startTime + duration - styleStart)) }
      : {}),
    script_count: scripts.length,
    ...(topScript
      ? {
          top_script_ms: roundMetric(topScriptDuration),
          top_script_invoker_type: sanitizeInvokerType(topScript.invokerType),
          top_script_pos:
            topPos !== undefined && Number.isInteger(topPos) && topPos >= 0 ? topPos : null,
        }
      : {}),
  };
};

/**
 * Installs a Chromium Long Animation Frame observer when supported.
 * Only numeric timings and the fixed invoker-type enum are forwarded; script URLs
 * and function names are intentionally omitted so private paths or identifiers cannot leak.
 */
export const startLongAnimationFrameCapture = (
  onFrame: (data: LongAnimationFrameData) => void
): PerformanceObserver | undefined => {
  if (
    typeof PerformanceObserver !== 'function' ||
    !PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')
  ) {
    return undefined;
  }
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const data = extractLongAnimationFrameData(entry);
        if (data) onFrame(data);
      }
    });
    observer.observe({ type: 'long-animation-frame', buffered: false });
    return observer;
  } catch {
    return undefined;
  }
};
