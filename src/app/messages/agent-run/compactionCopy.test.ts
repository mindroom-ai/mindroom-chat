import { describe, expect, it } from 'vitest';
import type { ReplyCompaction } from '../../matrix/protocol/compactions';
import {
  formatSeconds,
  formatTokensShort,
  percentOf,
  seamPlace,
  seamState,
} from './compactionCopy';

const compaction = (fields: Partial<ReplyCompaction> = {}): ReplyCompaction => ({
  id: 'c1',
  phase: 'mid_turn',
  afterTool: 3,
  status: 'success',
  beforeTokens: 366804,
  ...fields,
});

describe('formatTokensShort', () => {
  it('rounds thousands to k', () => {
    expect(formatTokensShort(366804)).toBe('367k');
    expect(formatTokensShort(6336)).toBe('6k');
    expect(formatTokensShort(1000)).toBe('1k');
  });

  it('writes counts under a thousand whole', () => {
    expect(formatTokensShort(950)).toBe('950');
    expect(formatTokensShort(0)).toBe('0');
    expect(formatTokensShort(12.6)).toBe('13');
  });
});

describe('formatSeconds', () => {
  it('keeps a tenth under 10 s', () => {
    expect(formatSeconds(8400)).toBe('8.4 s');
    expect(formatSeconds(300)).toBe('0.3 s');
  });

  it('writes whole seconds from 10 s', () => {
    expect(formatSeconds(120000)).toBe('120 s');
    expect(formatSeconds(31200)).toBe('31 s');
    expect(formatSeconds(10000)).toBe('10 s');
  });
});

describe('percentOf', () => {
  it('rounds the share to a whole percent', () => {
    expect(percentOf(366804, 351792)).toBe(104);
    expect(percentOf(6336, 351792)).toBe(2);
    expect(percentOf(360468, 366804)).toBe(98);
  });

  it('is 0 of an empty budget', () => {
    expect(percentOf(10, 0)).toBe(0);
  });
});

describe('seamState', () => {
  it('is the status of a compaction', () => {
    expect(seamState(compaction())).toBe('success');
    expect(seamState(compaction({ status: 'failed' }))).toBe('failed');
    expect(seamState(compaction({ status: 'timeout' }))).toBe('timeout');
    expect(seamState(compaction({ status: 'running' }))).toBe('running');
  });

  it('is interrupted for a running one on a reply that ended', () => {
    expect(seamState(compaction({ status: 'running' }), true)).toBe('interrupted');
    expect(seamState(compaction({ status: 'success' }), true)).toBe('success');
    expect(seamState(compaction({ status: 'failed' }), true)).toBe('failed');
  });
});

describe('seamPlace', () => {
  it('is where the compaction ran', () => {
    expect(seamPlace(compaction())).toBe('midTurn');
    expect(seamPlace(compaction({ phase: 'pre_turn', afterTool: 0 }))).toBe('preTurn');
    expect(seamPlace(compaction({ phase: 'manual' }))).toBe('manual');
  });

  it('is mid-turn for a pre-turn one after earlier tool calls', () => {
    expect(seamPlace(compaction({ phase: 'pre_turn', afterTool: 2 }))).toBe('midTurn');
  });

  it('is an unknown spot for an old automatic notice', () => {
    expect(seamPlace(compaction({ phase: 'notice', afterTool: 0 }))).toBe('notice');
  });
});
