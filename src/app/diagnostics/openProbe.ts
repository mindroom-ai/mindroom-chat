// THROWAWAY PROBE (never merged): marks of one thread open, read by the perf spec.
type ProbeWindow = { __openProbe?: Record<string, unknown>[] };

export const openProbe = (name: string, data?: Record<string, unknown>): void => {
  if (typeof window === 'undefined') return;
  const target = window as unknown as ProbeWindow;
  if (!target.__openProbe) return;
  target.__openProbe.push({ t: Math.round(performance.now() * 10) / 10, name, ...data });
};
