import { useMemo, type ReactNode } from 'react';
import { parseChartWidget } from './chartSchema';

/** A widget from its canonical JSON text, or `fallback` when this build cannot draw it. */
export default function UiWidget({ json, fallback }: { json: string; fallback: ReactNode }) {
  const chart = useMemo(() => parseChartWidget(json), [json]);
  return chart ? <figure>{chart.title}</figure> : <>{fallback}</>;
}
