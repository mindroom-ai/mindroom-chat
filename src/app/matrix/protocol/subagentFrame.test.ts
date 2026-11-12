import { describe, expect, it } from 'vitest';
import fixture from '../../messages/live/__fixtures__/subagent-frames-v1.json';
import type { LiveDocs } from './liveFrame';
import { applyLiveDelta } from './liveFrame';
import {
  isActiveSubagentStatus,
  parseSubagentFrame,
  SUBAGENT_FRAME_EVENT_TYPE,
  type SubagentStatus,
} from './subagentFrame';

const SID = '1762790000123-0a1b2c3d';
const meta = {
  agent: 'researcher',
  caller: 'lead',
  root: 'lead',
  parent: null,
  thread_id: '$thread:example.org',
  source: 'delegate',
  status: 'running',
  started_at: 1762790000.1,
  ended_at: null,
};
const docs: LiveDocs = { md: 'Hi', reasoning: '', tools: [], status: 'streaming', activity: '' };
const frame = (body: Record<string, unknown>) => ({
  v: 1,
  run: 'del-1',
  sid: SID,
  seq: 0,
  meta,
  snapshot: docs,
  ...body,
});

describe('sub-agent frames', () => {
  it('uses the MindRoom event type', () => {
    expect(SUBAGENT_FRAME_EVENT_TYPE).toBe('io.mindroom.subagents');
  });

  it.each(fixture.cases.map((testCase) => [testCase.name, testCase] as const))(
    'parses the fixture frame and turns its documents before into after: %s',
    (_name, testCase) => {
      const parsed = parseSubagentFrame(testCase.frame);
      expect(parsed).not.toBeNull();
      if (!parsed) return;
      expect(parsed.run).toBe(testCase.frame.run);

      const after =
        'snapshot' in parsed
          ? parsed.snapshot
          : applyLiveDelta(testCase.before as LiveDocs, parsed.delta);
      expect(after).toEqual(testCase.after);
    }
  );

  it('maps meta to camelCase', () => {
    const first = fixture.cases.find((testCase) => testCase.name.startsWith('snapshot'))?.frame;
    expect(parseSubagentFrame(first)?.meta).toEqual({
      agent: 'researcher',
      subagent: 'del-1',
      caller: 'lead',
      root: 'lead',
      parent: null,
      threadId: '$thread:example.org',
      source: 'delegate',
      status: 'running',
      startedAt: 1762790000.1,
      endedAt: null,
      task: 'Find when version 2 shipped.',
    });
  });

  it('takes a frame without a sub-agent as a turn of a sub-agent of its own', () => {
    expect(parseSubagentFrame(frame({}))?.meta.subagent).toBe('del-1');
    expect(parseSubagentFrame(frame({ meta: { ...meta, subagent: 'first' } }))?.meta.subagent).toBe(
      'first'
    );
    expect(parseSubagentFrame(frame({ meta: { ...meta, subagent: 7 } }))).toBeNull();
  });

  it('treats a null result as absent and keeps a text result', () => {
    const ended = { ...meta, status: 'completed', ended_at: 1762790005 };
    expect(
      parseSubagentFrame(frame({ meta: { ...ended, result: null } }))?.meta
    ).not.toHaveProperty('result');
    expect(parseSubagentFrame(frame({ meta: { ...ended, result: 'Done.' } }))?.meta.result).toBe(
      'Done.'
    );
  });

  it('tolerates unknown keys on the frame and on meta', () => {
    const parsed = parseSubagentFrame(frame({ extra: 1, meta: { ...meta, future: 'x' } }));
    expect(parsed).not.toBeNull();
    expect(parsed?.meta).not.toHaveProperty('future');
  });

  it('accepts a gap in seq', () => {
    expect(parseSubagentFrame(frame({ seq: 9 }))?.seq).toBe(9);
  });

  it.each([
    ['no run', { run: undefined }],
    ['an empty run', { run: '' }],
    ['a non-object meta', { meta: 'running' }],
    ['no meta', { meta: undefined }],
    ['an unknown status', { meta: { ...meta, status: 'streaming' } }],
    ['an unknown source', { meta: { ...meta, source: 'other' } }],
    ['a missing agent', { meta: { ...meta, agent: undefined } }],
    ['a non-numeric start', { meta: { ...meta, started_at: '1' } }],
    ['an undefined end', { meta: { ...meta, ended_at: undefined } }],
    ['a numeric parent', { meta: { ...meta, parent: 3 } }],
    ['a bad live frame', { sid: 'x' }],
  ])('rejects a frame with %s', (_name, body) => {
    expect(parseSubagentFrame(frame(body))).toBeNull();
  });

  it('rejects content that is not an object', () => {
    expect(parseSubagentFrame(null)).toBeNull();
    expect(parseSubagentFrame([])).toBeNull();
  });

  it('tells active statuses from ended ones', () => {
    const active: SubagentStatus[] = ['running', 'awaiting_approval', 'paused'];
    const ended: SubagentStatus[] = ['completed', 'failed', 'cancelled', 'denied'];
    expect(active.every(isActiveSubagentStatus)).toBe(true);
    expect(ended.some(isActiveSubagentStatus)).toBe(false);
  });
});
