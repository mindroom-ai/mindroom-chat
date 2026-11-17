import type { ReplyCompaction } from '../../matrix/protocol/compactions';

/** What a seam shows: the compaction's status, or `interrupted` when its reply ended first. */
export type SeamState = 'running' | 'success' | 'failed' | 'timeout' | 'interrupted';

/**
 * Where the compaction ran, which picks its wording: before the reply's first model request,
 * between two of them, on the compact command, or (an old automatic notice) unknown.
 */
export type SeamPlace = 'preTurn' | 'midTurn' | 'manual' | 'notice';

/** A token count at rest: thousands rounded to `k` ("367k", "6k"), smaller counts whole. */
export const formatTokensShort = (n: number): string =>
  n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n));

/** A duration: a tenth of a second under 10 s ("8.4 s"), whole seconds from there ("120 s"). */
export const formatSeconds = (ms: number): string =>
  ms < 10000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`;

/** `n` as a whole percent of `budget`; 0 of an empty budget. */
export const percentOf = (n: number, budget: number): number =>
  budget > 0 ? Math.round((n / budget) * 100) : 0;

/** A compaction still running on a reply that ended (`interrupted`) never finishes. */
export const seamState = (compaction: ReplyCompaction, interrupted = false): SeamState =>
  interrupted && compaction.status === 'running' ? 'interrupted' : compaction.status;

/**
 * A `pre_turn` compaction after earlier tool calls is a continuation attempt prepared again, so
 * it did not happen before the reply's first request and reads as mid-turn.
 */
export const seamPlace = ({ phase, afterTool }: ReplyCompaction): SeamPlace => {
  if (phase === 'pre_turn') return afterTool > 0 ? 'midTurn' : 'preTurn';
  if (phase === 'mid_turn') return 'midTurn';
  return phase;
};
