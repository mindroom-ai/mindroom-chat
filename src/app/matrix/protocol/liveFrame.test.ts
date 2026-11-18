import { describe, expect, it } from 'vitest';
import fixture from '../../messages/live/__fixtures__/live-frames-v1.json';
import { applyLiveDelta, compareLiveOrder, parseLiveFrame, type LiveDocs } from './liveFrame';

const SID = '1761858000123-0a1b2c3d';
const docs: LiveDocs = {
  md: 'Hello',
  reasoning: '',
  tools: [],
  status: 'streaming',
  activity: '',
  segments: [],
};
const SEGMENTS = [
  { start: 0, after_tool: 0 },
  { start: 12, after_tool: 2 },
];
const COMPACTIONS = [
  { id: 'a', phase: 'pre_turn', after_tool: 0, status: 'success', before_tokens: 366804 },
  { id: 'b', phase: 'mid_turn', after_tool: 2, status: 'running', before_tokens: 12000 },
];
const frame = (body: Record<string, unknown>) => ({
  v: 1,
  reply: '$reply',
  sid: SID,
  seq: 1,
  ...body,
});

describe('live reply frames', () => {
  it.each(fixture.cases.map((testCase) => [testCase.name, testCase] as const))(
    'turns the documents before plus the frame into the documents after: %s',
    (_name, testCase) => {
      const parsed = parseLiveFrame(testCase.frame);
      expect(parsed).not.toBeNull();
      if (!parsed) return;

      const after =
        'snapshot' in parsed
          ? parsed.snapshot
          : applyLiveDelta({ segments: [], ...testCase.before } as LiveDocs, parsed.delta);

      // The backend's documents after a frame name no compactions unless the case is about them.
      const { compactions: _compactions, ...withoutCompactions } = after ?? {};
      expect('compactions' in testCase.after ? after : withoutCompactions).toEqual({
        segments: [],
        ...testCase.after,
      });
    }
  );

  it.each([
    ['no version', { reply: '$reply', sid: SID, seq: 0, delta: { activity: '' } }],
    ['another version', frame({ v: 2, delta: { activity: '' } })],
    ['both a snapshot and a delta', frame({ snapshot: docs, delta: { activity: '' } })],
    ['neither a snapshot nor a delta', frame({})],
    ['a negative seq', frame({ seq: -1, delta: { activity: '' } })],
    ['a fractional seq', frame({ seq: 1.5, delta: { activity: '' } })],
    ['a reply that is not a string', frame({ reply: 7, delta: { activity: '' } })],
    ['a malformed sid', frame({ sid: 'publisher', delta: { activity: '' } })],
    ['an empty delta', frame({ delta: {} })],
    ['a snapshot missing a document', frame({ snapshot: { ...docs, activity: undefined } })],
    ['an unknown status', frame({ delta: { status: 'completed' } })],
    ['a tool entry that is not an object', frame({ snapshot: { ...docs, tools: ['x'] } })],
    [
      'a splice starting after the new length',
      frame({ delta: { md: { at: 6, del: 0, ins: '', len: 5 } } }),
    ],
    [
      'a splice inserting past the new length',
      frame({ delta: { md: { at: 4, del: 0, ins: 'abc', len: 5 } } }),
    ],
    ['a negative splice offset', frame({ delta: { md: { at: -1, del: 0, ins: '', len: 5 } } })],
    ['a tool index past the list', frame({ delta: { tools: { len: 1, set: [[1, {}]] } } })],
    ['segments that are not a list', frame({ snapshot: { ...docs, segments: {} } })],
    [
      'a segment with a negative start',
      frame({ snapshot: { ...docs, segments: [{ start: -1, after_tool: 0 }] } }),
    ],
    [
      'a segment with a fractional tool count',
      frame({ delta: { segments: [{ start: 0, after_tool: 0.5 }] } }),
    ],
    ['a segment that is not an object', frame({ delta: { segments: [0] } })],
    ['compactions that are not a list', frame({ snapshot: { ...docs, compactions: {} } })],
    ['a compactions delta that is not a list', frame({ delta: { compactions: 'none' } })],
  ])('rejects a frame with %s', (_name, content) => {
    expect(parseLiveFrame(content)).toBeNull();
  });

  it('reads the reasoning segments of a snapshot', () => {
    const parsed = parseLiveFrame(frame({ snapshot: { ...docs, segments: SEGMENTS } }));

    expect(parsed).toEqual({
      reply: '$reply',
      sid: SID,
      seq: 1,
      snapshot: { ...docs, segments: SEGMENTS },
    });
  });

  it('reads a snapshot without segments, from an older backend, as having none', () => {
    const { segments: _segments, ...old } = docs;
    const parsed = parseLiveFrame(frame({ snapshot: old }));

    expect(parsed && 'snapshot' in parsed && parsed.snapshot.segments).toEqual([]);
  });

  it('replaces the segments with a delta that carries them and keeps them otherwise', () => {
    const before = { ...docs, segments: [{ start: 0, after_tool: 0 }] };
    const replacing = parseLiveFrame(frame({ delta: { segments: SEGMENTS } }));
    const keeping = parseLiveFrame(frame({ delta: { activity: 'x' } }));
    if (!replacing || !('delta' in replacing) || !keeping || !('delta' in keeping)) {
      throw new Error('Expected two deltas');
    }

    expect(applyLiveDelta(before, replacing.delta)).toEqual({ ...before, segments: SEGMENTS });
    expect(applyLiveDelta(before, keeping.delta)).toEqual({ ...before, activity: 'x' });
  });

  it('reads the compactions of a snapshot as sent', () => {
    const parsed = parseLiveFrame(frame({ snapshot: { ...docs, compactions: COMPACTIONS } }));

    expect(parsed).toEqual({
      reply: '$reply',
      sid: SID,
      seq: 1,
      snapshot: { ...docs, compactions: COMPACTIONS },
    });
  });

  it('reads a snapshot without compactions, from an older backend, as not saying', () => {
    const parsed = parseLiveFrame(frame({ snapshot: docs }));

    expect(parsed && 'snapshot' in parsed && parsed.snapshot).not.toHaveProperty('compactions');
  });

  it('replaces the whole compaction list with a delta that carries it and keeps it otherwise', () => {
    const before = { ...docs, compactions: [COMPACTIONS[0]] };
    const deltaOf = (body: Record<string, unknown>) => {
      const parsed = parseLiveFrame(frame({ delta: body }));
      if (!parsed || !('delta' in parsed)) throw new Error('Expected a delta');
      return parsed.delta;
    };

    expect(applyLiveDelta(before, deltaOf({ compactions: COMPACTIONS }))).toEqual({
      ...before,
      compactions: COMPACTIONS,
    });
    expect(applyLiveDelta(before, deltaOf({ compactions: [] }))).toEqual({
      ...before,
      compactions: [],
    });
    expect(applyLiveDelta(before, deltaOf({ activity: 'x' }))).toEqual({
      ...before,
      activity: 'x',
    });
  });

  it('sets the widgets with a delta, clears them with null, and keeps them in a snapshot', () => {
    const ui = { version: 1, widgets: [{ id: 'df4d729a5d', json: '{}' }] };
    const deltaOf = (body: Record<string, unknown>) => {
      const parsed = parseLiveFrame(frame({ delta: body }));
      if (!parsed || !('delta' in parsed)) throw new Error('Expected a delta');
      return parsed.delta;
    };

    expect(applyLiveDelta(docs, deltaOf({ ui }))).toEqual({ ...docs, ui });
    expect(applyLiveDelta({ ...docs, ui }, deltaOf({ activity: 'x' }))).toEqual({
      ...docs,
      activity: 'x',
      ui,
    });
    expect(applyLiveDelta({ ...docs, ui }, deltaOf({ ui: null }))).toEqual(docs);
    const parsed = parseLiveFrame(frame({ snapshot: { ...docs, ui } }));
    expect(parsed && 'snapshot' in parsed && parsed.snapshot).toEqual({ ...docs, ui });
    expect(parseLiveFrame(frame({ snapshot: docs }))).not.toHaveProperty('snapshot.ui');
  });

  it('rejects content that is not an object', () => {
    expect(parseLiveFrame(null)).toBeNull();
    expect(parseLiveFrame('frame')).toBeNull();
  });

  it('detects a splice that does not fit the document', () => {
    expect(applyLiveDelta(docs, { md: { at: 5, del: 0, ins: '!', len: 7 } })).toBeNull();
    expect(applyLiveDelta(docs, { md: { at: 4, del: 2, ins: '', len: 4 } })).toBeNull();
    expect(applyLiveDelta(docs, { md: { at: 5, del: 0, ins: '!', len: 6 } })).toEqual({
      ...docs,
      md: 'Hello!',
    });
  });

  it('detects a tool list extended without its new entries', () => {
    expect(applyLiveDelta(docs, { tools: { len: 2, set: [[0, {}]] } })).toBeNull();
  });

  it('orders frames by publisher generation, then by seq', () => {
    const older = { sid: '1761858000123-ffffffff', seq: 50 };
    const newer = { sid: '1761858000124-00000000', seq: 0 };

    expect(compareLiveOrder(older, newer)).toBeLessThan(0);
    expect(compareLiveOrder(newer, older)).toBeGreaterThan(0);
    expect(compareLiveOrder({ sid: SID, seq: 2 }, { sid: SID, seq: 10 })).toBeLessThan(0);
    expect(compareLiveOrder({ sid: SID, seq: 3 }, { sid: SID, seq: 3 })).toBe(0);
  });
});
