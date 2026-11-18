import { isRecord } from '../../lib/isRecord';

export type ChartWidget = {
  type: 'chart';
  kind: 'bar' | 'line' | 'area' | 'pie';
  title: string;
  labels: string[];
  series: { name: string; data: number[] }[];
  x?: string;
  y?: string;
};

const MAX_JSON_BYTES = 16384;
const MAX_SERIES = 8;
const MAX_POINTS = 200;
const KINDS = new Set(['bar', 'line', 'area', 'pie']);
const CHART_KEYS = new Set(['type', 'kind', 'title', 'labels', 'series', 'x', 'y']);
const SERIES_KEYS = new Set(['name', 'data']);

const hasOnlyKeys = (value: Record<string, unknown>, keys: Set<string>): boolean =>
  Object.keys(value).every((key) => keys.has(key));

const LONE_SURROGATE = /\p{Cs}/u;

/** A well-formed string of 1 to `max` code points. */
const isText = (value: unknown, max: number): value is string => {
  if (typeof value !== 'string' || LONE_SURROGATE.test(value)) return false;
  const length = [...value].length;
  return length >= 1 && length <= max;
};

const isOptionalText = (value: unknown, max: number): boolean =>
  value === undefined || isText(value, max);

const readSeries = (value: unknown, points: number): ChartWidget['series'][number] | undefined => {
  if (!isRecord(value) || !hasOnlyKeys(value, SERIES_KEYS)) return undefined;
  const { name, data } = value;
  if (!isText(name, 40) || !Array.isArray(data) || data.length !== points) return undefined;
  const numbers: unknown[] = data;
  if (!numbers.every((n): n is number => typeof n === 'number' && Number.isFinite(n))) {
    return undefined;
  }
  return { name, data: numbers };
};

const readChart = (value: unknown): ChartWidget | undefined => {
  if (!isRecord(value) || !hasOnlyKeys(value, CHART_KEYS) || value.type !== 'chart') {
    return undefined;
  }
  const { kind, title, labels, series, x, y } = value;
  if (typeof kind !== 'string' || !KINDS.has(kind) || !isText(title, 80)) return undefined;
  if (!isOptionalText(x, 40) || !isOptionalText(y, 40)) return undefined;
  if (!Array.isArray(labels) || labels.length === 0 || labels.length > MAX_POINTS) return undefined;
  const labelList: unknown[] = labels;
  if (!labelList.every((label): label is string => isText(label, 40))) return undefined;
  if (!Array.isArray(series) || series.length === 0 || series.length > MAX_SERIES) return undefined;
  const seriesList: unknown[] = series;
  const read = seriesList.map((entry) => readSeries(entry, labelList.length));
  if (!read.every((entry): entry is ChartWidget['series'][number] => !!entry)) return undefined;
  if (new Set(read.map((entry) => entry.name)).size !== read.length) return undefined;
  if (kind === 'pie') {
    const data = read.length === 1 ? read[0]?.data : undefined;
    if (!data || data.some((n) => n < 0) || !(data.reduce((a, b) => a + b, 0) > 0)) {
      return undefined;
    }
  }
  return {
    type: 'chart',
    kind: kind as ChartWidget['kind'],
    title,
    labels: labelList,
    series: read,
    ...(x !== undefined && { x: x as string }),
    ...(y !== undefined && { y: y as string }),
  };
};

/**
 * The chart in a widget's canonical JSON text, or undefined for anything else: another `type`, a
 * key the schema does not know, a bound of the spec exceeded, a label that is not a string, an
 * optional key written as null, or a number that is not finite. Never throws.
 */
export const parseChartWidget = (json: string): ChartWidget | undefined => {
  if (new TextEncoder().encode(json).length > MAX_JSON_BYTES) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return undefined;
  }
  return readChart(value);
};
