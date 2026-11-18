import { describe, expect, it } from 'vitest';
import {
  COMPACTION_NOTICE_CONTENT_KEY,
  COMPACTIONS_CONTENT_KEY,
  readCompactionNotice,
  readReplyCompactions,
} from './compactions';

// The spec's example entry, with the keys a running entry and a finished one carry together.
const ENTRY = {
  id: '3f9c',
  phase: 'pre_turn',
  mode: 'auto',
  after_tool: 0,
  status: 'running',
  started_at: 1794940102256,
  duration_ms: 8400,
  summary_model: 'haiku',
  before_tokens: 366804,
  after_tokens: 6336,
  history_budget_tokens: 351792,
  runs_before: 24,
  compacted_run_count: 24,
  runs_remaining: 15,
  failure_reason: 'The model timed out.',
};

const ORIGIN_TS = 1794940100000;

const notice = (metadata: unknown) => ({
  msgtype: 'm.notice',
  body: 'Compacting history...',
  [COMPACTION_NOTICE_CONTENT_KEY]: metadata,
});

describe('compaction content keys', () => {
  it('names the reply list and the old notice', () => {
    expect(COMPACTIONS_CONTENT_KEY).toBe('io.mindroom.compactions');
    expect(COMPACTION_NOTICE_CONTENT_KEY).toBe('io.mindroom.compaction');
  });
});

describe('readReplyCompactions', () => {
  it('reads the example entry in camelCase', () => {
    expect(readReplyCompactions([ENTRY])).toEqual([
      {
        id: '3f9c',
        phase: 'pre_turn',
        afterTool: 0,
        status: 'running',
        startedAt: 1794940102256,
        durationMs: 8400,
        summaryModel: 'haiku',
        beforeTokens: 366804,
        afterTokens: 6336,
        historyBudgetTokens: 351792,
        runsBefore: 24,
        compactedRunCount: 24,
        runsRemaining: 15,
        failureReason: 'The model timed out.',
      },
    ]);
  });

  it('reads an entry with only the required keys, leaving the optional ones out', () => {
    const entry = {
      id: 'a',
      phase: 'mid_turn',
      after_tool: 3,
      status: 'success',
      before_tokens: 10,
    };

    expect(readReplyCompactions([entry])).toEqual([
      { id: 'a', phase: 'mid_turn', afterTool: 3, status: 'success', beforeTokens: 10 },
    ]);
  });

  it('ignores unknown keys', () => {
    const [read] = readReplyCompactions([{ ...ENTRY, scope: 'thread', extra: { x: 1 } }]);

    expect(read).not.toHaveProperty('scope');
    expect(read).not.toHaveProperty('extra');
    expect(read).not.toHaveProperty('mode');
  });

  it.each([
    ['no id', { ...ENTRY, id: undefined }],
    ['an id that is not a string', { ...ENTRY, id: 7 }],
    ['an empty id', { ...ENTRY, id: '' }],
    ['an unknown status', { ...ENTRY, status: 'done' }],
    ['no status', { ...ENTRY, status: undefined }],
    ['a negative after_tool', { ...ENTRY, after_tool: -1 }],
    ['a fractional after_tool', { ...ENTRY, after_tool: 1.5 }],
    ['no after_tool', { ...ENTRY, after_tool: undefined }],
    ['a before_tokens that is not a number', { ...ENTRY, before_tokens: '366804' }],
    ['no before_tokens', { ...ENTRY, before_tokens: undefined }],
    ['a phase the reply list does not carry', { ...ENTRY, phase: 'manual' }],
    ['an unknown phase', { ...ENTRY, phase: 'post_turn' }],
    ['an entry that is not an object', 'entry'],
  ])('drops an entry with %s and keeps its valid neighbours', (_name, entry) => {
    const before = { ...ENTRY, id: 'before' };
    const after = { ...ENTRY, id: 'after', after_tool: 2 };

    expect(readReplyCompactions([before, entry, after]).map(({ id }) => id)).toEqual([
      'before',
      'after',
    ]);
  });

  it('leaves out an optional key of the wrong type and keeps the entry', () => {
    const [read] = readReplyCompactions([
      { ...ENTRY, summary_model: 4, after_tokens: 'many', runs_remaining: -2, started_at: null },
    ]);

    expect(read).toMatchObject({ id: '3f9c', beforeTokens: 366804 });
    expect(read).not.toHaveProperty('summaryModel');
    expect(read).not.toHaveProperty('afterTokens');
    expect(read).not.toHaveProperty('runsRemaining');
    expect(read).not.toHaveProperty('startedAt');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an object', { 0: ENTRY }],
    ['a string', 'compactions'],
  ])('reads %s as no compactions', (_name, value) => {
    expect(readReplyCompactions(value)).toEqual([]);
  });

  it.each([
    ['past the latest date', 8.64e15 + 1],
    ['negative', -1],
    ['infinite', Infinity],
  ])('leaves out a start time and a duration %s, keeping the entry', (_name, value) => {
    const [read] = readReplyCompactions([{ ...ENTRY, started_at: value, duration_ms: value }]);

    expect(read).toMatchObject({ id: '3f9c', beforeTokens: 366804 });
    expect(read).not.toHaveProperty('startedAt');
    expect(read).not.toHaveProperty('durationMs');
  });

  it('keeps a start time and a duration at the latest date', () => {
    const [read] = readReplyCompactions([{ ...ENTRY, started_at: 8.64e15, duration_ms: 8.64e15 }]);

    expect(read).toMatchObject({ startedAt: 8.64e15, durationMs: 8.64e15 });
  });

  it('cuts a long failure reason to 300 characters with an ellipsis', () => {
    const long = 'x'.repeat(2000);
    const [read] = readReplyCompactions([{ ...ENTRY, failure_reason: long }]);

    expect(read!.failureReason).toBe(`${'x'.repeat(299)}…`);
    expect(read!.failureReason).toHaveLength(300);
    const [short] = readReplyCompactions([{ ...ENTRY, failure_reason: 'y'.repeat(300) }]);
    expect(short!.failureReason).toBe('y'.repeat(300));
  });

  it('keeps only the first entry of an id that repeats', () => {
    const first = { ...ENTRY, id: 'same', after_tool: 1, phase: 'mid_turn' };
    const other = { ...ENTRY, id: 'other', after_tool: 2, phase: 'mid_turn' };
    const again = { ...ENTRY, id: 'same', after_tool: 3, phase: 'mid_turn' };

    expect(
      readReplyCompactions([first, other, again]).map(({ id, afterTool }) => [id, afterTool])
    ).toEqual([
      ['same', 1],
      ['other', 2],
    ]);
  });

  it('keeps the start order', () => {
    const first = { ...ENTRY, id: 'first', phase: 'pre_turn', after_tool: 0 };
    const second = { ...ENTRY, id: 'second', phase: 'mid_turn', after_tool: 4 };

    expect(readReplyCompactions([first, second]).map(({ id }) => id)).toEqual(['first', 'second']);
  });
});

describe('readCompactionNotice', () => {
  const SUCCESS = {
    version: 3,
    status: 'success',
    mode: 'auto',
    session_id: 'session',
    scope: 'thread',
    summary_model: 'haiku',
    before_tokens: 366804,
    after_tokens: 6336,
    window_tokens: 400000,
    runs_before: 39,
    runs_after: 15,
    compacted_run_count: 24,
    compacted_at: '2026-11-17T10:00:00Z',
    history_budget_tokens: 351792,
    duration_ms: 8400,
  };

  it('reads a v3 success notice, started at the event time', () => {
    expect(readCompactionNotice(notice(SUCCESS), ORIGIN_TS)).toEqual({
      id: 'notice',
      phase: 'notice',
      afterTool: 0,
      status: 'success',
      startedAt: ORIGIN_TS,
      durationMs: 8400,
      summaryModel: 'haiku',
      beforeTokens: 366804,
      afterTokens: 6336,
      historyBudgetTokens: 351792,
      runsBefore: 39,
      compactedRunCount: 24,
    });
  });

  it('reads a manual notice as a manual compaction', () => {
    expect(readCompactionNotice(notice({ ...SUCCESS, mode: 'manual' }), ORIGIN_TS)).toMatchObject({
      phase: 'manual',
      afterTool: 0,
    });
  });

  it('reads a running notice as running', () => {
    const running = {
      version: 3,
      status: 'running',
      mode: 'auto',
      session_id: 'session',
      scope: 'thread',
      summary_model: 'haiku',
      before_tokens: 366804,
      history_budget_tokens: null,
      runs_before: 24,
    };

    const read = readCompactionNotice(notice(running), ORIGIN_TS);

    expect(read).toEqual({
      id: 'notice',
      phase: 'notice',
      afterTool: 0,
      status: 'running',
      startedAt: ORIGIN_TS,
      summaryModel: 'haiku',
      beforeTokens: 366804,
      runsBefore: 24,
    });
  });

  it('reads a failure notice, which carries no token count, with its reason', () => {
    const failed = {
      version: 3,
      status: 'timeout',
      mode: 'auto',
      session_id: 'session',
      scope: 'thread',
      summary_model: 'haiku',
      duration_ms: 120000,
      failure_reason: 'Timed out after 120 s.',
      history_budget_tokens: 351792,
    };

    expect(readCompactionNotice(notice(failed), ORIGIN_TS)).toEqual({
      id: 'notice',
      phase: 'notice',
      afterTool: 0,
      status: 'timeout',
      startedAt: ORIGIN_TS,
      durationMs: 120000,
      summaryModel: 'haiku',
      failureReason: 'Timed out after 120 s.',
      historyBudgetTokens: 351792,
    });
  });

  it('reads an automatic notice as a notice, whose turn phase is unknown', () => {
    expect(readCompactionNotice(notice({ ...SUCCESS, mode: 'auto' }), ORIGIN_TS)).toMatchObject({
      phase: 'notice',
    });
    expect(readCompactionNotice(notice({ ...SUCCESS, mode: undefined }), ORIGIN_TS)).toMatchObject({
      phase: 'notice',
    });
  });

  it('reads an older notice without a status, sent only after success, as a success', () => {
    const { status: _status, ...v2 } = { ...SUCCESS, version: 2 };

    expect(readCompactionNotice(notice(v2), ORIGIN_TS)).toMatchObject({ status: 'success' });
  });

  it.each([
    ['no compaction key', { msgtype: 'm.notice', body: 'Hello' }],
    ['metadata that is not an object', notice('compacted')],
    ['an unknown status', notice({ ...SUCCESS, status: 'done' })],
    ['a success without a token count', notice({ ...SUCCESS, before_tokens: undefined })],
  ])('reads a notice with %s as none', (_name, content) => {
    expect(readCompactionNotice(content, ORIGIN_TS)).toBeUndefined();
  });
});
