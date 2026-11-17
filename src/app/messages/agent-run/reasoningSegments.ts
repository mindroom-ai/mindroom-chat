import { isRecord } from '../../lib/isRecord';

/** One reasoning segment: its text, the visible tool calls started before it, and its own time. */
export type ReasoningSegment = { text: string; afterTool: number; durationMs?: number };

type RawSegment = { start: number; afterTool: number; durationMs?: number };

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * The entries of `io.mindroom.reasoning.segments` (or the live list), or `undefined` unless every
 * entry has a whole `start` and `after_tool`, the first start is 0, the starts strictly increase,
 * and each one falls inside a text of `length` UTF-16 code units.
 */
const parseSegments = (segments: unknown, length: number): RawSegment[] | undefined => {
  if (!Array.isArray(segments) || segments.length === 0) return undefined;
  const parsed: RawSegment[] = [];
  for (const entry of segments as unknown[]) {
    if (!isRecord(entry)) return undefined;
    const { start, after_tool: afterTool, duration_ms: durationMs } = entry;
    if (!isCount(start) || !isCount(afterTool) || start >= length) return undefined;
    const previous = parsed[parsed.length - 1];
    if (previous ? start <= previous.start : start !== 0) return undefined;
    const valid = typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0;
    parsed.push(valid ? { start, afterTool, durationMs } : { start, afterTool });
  }
  return parsed;
};

/** The whole reasoning as one segment at the top, as replies without segments show it. */
const oneSegment = (text: string): ReasoningSegment[] => {
  const trimmed = text.trim();
  return trimmed ? [{ text: trimmed, afterTool: 0 }] : [];
};

/**
 * The reasoning `text` cut into the `segments` the backend recorded: each runs from its `start`
 * (UTF-16, as JS strings index) to the next one's, trimmed at both ends, and a segment blank after
 * trimming is dropped. Segments missing or malformed give the whole text as one segment at the top.
 */
export const readReasoningSegments = (text: string, segments: unknown): ReasoningSegment[] => {
  const parsed = parseSegments(segments, text.length);
  if (!parsed) return oneSegment(text);
  const pieces: ReasoningSegment[] = [];
  parsed.forEach(({ start, afterTool, durationMs }, index) => {
    const piece = text.slice(start, parsed[index + 1]?.start).trim();
    if (!piece) return;
    pieces.push(
      durationMs === undefined ? { text: piece, afterTool } : { text: piece, afterTool, durationMs }
    );
  });
  return pieces.length > 0 ? pieces : oneSegment(text);
};

/**
 * Whether the last recorded segment has no text yet: the model began it, and
 * `readReasoningSegments` leaves it out until its text comes. False for segments the reader does
 * not follow.
 */
export const isLastReasoningSegmentBlank = (text: string, segments: unknown): boolean => {
  const last = parseSegments(segments, text.length)?.at(-1);
  return last !== undefined && text.slice(last.start).trim() === '';
};

/**
 * Where each segment renders: a map from an anchor (a rendered tool marker index, or 0 for the top
 * of the reply) to the indices of the segments placed there, in order. A segment goes after the
 * greatest rendered marker index at most its `afterTool`, or to the top when there is none.
 */
export const placeReasoningSegments = (
  segments: readonly ReasoningSegment[],
  renderedMarkerIndices: readonly number[]
): Map<number, number[]> => {
  const placement = new Map<number, number[]>();
  segments.forEach(({ afterTool }, index) => {
    const anchor = renderedMarkerIndices.reduce(
      (best, marker) => (marker <= afterTool && marker > best ? marker : best),
      0
    );
    placement.set(anchor, [...(placement.get(anchor) ?? []), index]);
  });
  return placement;
};
