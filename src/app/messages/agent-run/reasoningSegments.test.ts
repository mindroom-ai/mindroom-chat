import { describe, expect, it } from 'vitest';
import {
  lastRecordedReasoningSegment,
  placeReasoningSegments,
  readReasoningSegments,
} from './reasoningSegments';

const texts = (text: string, segments: unknown) =>
  readReasoningSegments(text, segments).map((segment) => segment.text);

describe('readReasoningSegments', () => {
  it('splits the text at each start and trims the separator', () => {
    expect(
      readReasoningSegments('first\n\nsecond', [
        { start: 0, after_tool: 0, duration_ms: 4 },
        { start: 7, after_tool: 2, duration_ms: 5 },
      ])
    ).toEqual([
      { text: 'first', afterTool: 0, durationMs: 4 },
      { text: 'second', afterTool: 2, durationMs: 5 },
    ]);
  });

  it('trims both ends of each segment', () => {
    expect(
      texts('  first \n\n\n\n second  ', [
        { start: 0, after_tool: 0 },
        { start: 10, after_tool: 1 },
      ])
    ).toEqual(['first', 'second']);
  });

  it('drops a blank segment and keeps where its neighbours go', () => {
    // OpenAI summary parts arrive as "\n\n", which the backend records as a segment of its own.
    expect(
      readReasoningSegments('a\n\n\n\nb', [
        { start: 0, after_tool: 0, duration_ms: 1 },
        { start: 1, after_tool: 1, duration_ms: 2 },
        { start: 5, after_tool: 3, duration_ms: 3 },
      ])
    ).toEqual([
      { text: 'a', afterTool: 0, durationMs: 1 },
      { text: 'b', afterTool: 3, durationMs: 3 },
    ]);
  });

  it('counts starts in UTF-16 code units, as the backend does', () => {
    expect(
      texts('🙂 a\n\nb', [
        { start: 0, after_tool: 0 },
        { start: 6, after_tool: 1 },
      ])
    ).toEqual(['🙂 a', 'b']);
  });

  it('reads live segments, which carry no duration', () => {
    expect(
      readReasoningSegments('one\n\ntwo', [
        { start: 0, after_tool: 0 },
        { start: 5, after_tool: 1 },
      ])
    ).toEqual([
      { text: 'one', afterTool: 0 },
      { text: 'two', afterTool: 1 },
    ]);
  });

  it('ignores a duration that is not a non-negative number', () => {
    expect(
      readReasoningSegments('one\n\ntwo', [
        { start: 0, after_tool: 0, duration_ms: -1 },
        { start: 5, after_tool: 1, duration_ms: 'soon' },
      ])
    ).toEqual([
      { text: 'one', afterTool: 0 },
      { text: 'two', afterTool: 1 },
    ]);
  });

  it.each([
    ['missing', undefined],
    ['not a list', { start: 0, after_tool: 0 }],
    ['empty', []],
    ['an entry that is not an object', [{ start: 0, after_tool: 0 }, 5]],
    [
      'starts that do not increase',
      [
        { start: 0, after_tool: 0 },
        { start: 0, after_tool: 1 },
      ],
    ],
    ['a first start other than 0', [{ start: 2, after_tool: 0 }]],
    [
      'a start past the end',
      [
        { start: 0, after_tool: 0 },
        { start: 40, after_tool: 1 },
      ],
    ],
    [
      'a start at the end',
      [
        { start: 0, after_tool: 0 },
        { start: 10, after_tool: 1 },
      ],
    ],
    [
      'a negative after_tool',
      [
        { start: 0, after_tool: 0 },
        { start: 5, after_tool: -1 },
      ],
    ],
    [
      'a fractional start',
      [
        { start: 0, after_tool: 0 },
        { start: 4.5, after_tool: 1 },
      ],
    ],
    ['a missing after_tool', [{ start: 0 }]],
  ])('falls back to one segment at the top when segments are %s', (_case, segments) => {
    expect(readReasoningSegments(' one\n\ntwo\n', segments)).toEqual([
      { text: 'one\n\ntwo', afterTool: 0 },
    ]);
  });

  it('gives no segments for empty or blank text', () => {
    expect(readReasoningSegments('', undefined)).toEqual([]);
    expect(readReasoningSegments(' \n\n ', undefined)).toEqual([]);
    expect(readReasoningSegments(' \n\n ', [{ start: 0, after_tool: 0 }])).toEqual([]);
    expect(readReasoningSegments('', [{ start: 0, after_tool: 0 }])).toEqual([]);
  });
});

describe('lastRecordedReasoningSegment', () => {
  // The second segment starts inside the separator, as one whose first piece is blank does.
  const segments = [
    { start: 0, after_tool: 0 },
    { start: 6, after_tool: 2 },
  ];

  it('is blank while the last segment has begun without text', () => {
    expect(lastRecordedReasoningSegment('first\n\n', segments)).toEqual({
      start: 6,
      afterTool: 2,
      blank: true,
    });
    expect(lastRecordedReasoningSegment('first\n\n \n', segments)?.blank).toBe(true);
  });

  it('is not blank once the last segment has text, and keeps the calls before it', () => {
    expect(lastRecordedReasoningSegment('first\n\ns', segments)).toEqual({
      start: 6,
      afterTool: 2,
      blank: false,
    });
    expect(lastRecordedReasoningSegment('first', [{ start: 0, after_tool: 0 }])).toEqual({
      start: 0,
      afterTool: 0,
      blank: false,
    });
  });

  it('is undefined without segments, or with ones the reader does not follow', () => {
    expect(lastRecordedReasoningSegment('first\n\n', undefined)).toBeUndefined();
    // A start at the end of the text: the whole text shows as one segment.
    expect(
      lastRecordedReasoningSegment('first\n\n', [
        { start: 0, after_tool: 0 },
        { start: 7, after_tool: 1 },
      ])
    ).toBeUndefined();
  });
});

describe('placeReasoningSegments', () => {
  const segments = (...afterTools: number[]) =>
    afterTools.map((afterTool, index) => ({ text: `s${index}`, afterTool }));

  it('places each segment after its own marker', () => {
    expect(placeReasoningSegments(segments(0, 3, 4), [1, 2, 3, 4])).toEqual(
      new Map([
        [0, [0]],
        [3, [1]],
        [4, [2]],
      ])
    );
  });

  it('places every segment at the top without markers', () => {
    expect(placeReasoningSegments(segments(0, 1, 2), [])).toEqual(new Map([[0, [0, 1, 2]]]));
  });

  it('places a segment after the last rendered marker before it', () => {
    expect(placeReasoningSegments(segments(5), [1, 2])).toEqual(new Map([[2, [0]]]));
  });

  it('places a segment at the top when no rendered marker comes before it', () => {
    expect(placeReasoningSegments(segments(1), [2])).toEqual(new Map([[0, [0]]]));
  });

  it('keeps the order of segments that share an anchor', () => {
    expect(placeReasoningSegments(segments(2, 3, 6), [4, 2])).toEqual(
      new Map([
        [2, [0, 1]],
        [4, [2]],
      ])
    );
  });
});
