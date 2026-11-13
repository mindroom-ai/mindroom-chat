import { describe, expect, it } from 'vitest';
import { getContentToolTraceEvents, isToolTraceV2 } from './toolTrace';

describe('isToolTraceV2', () => {
  it('returns true only for version 2 traces', () => {
    expect(isToolTraceV2({})).toBe(false);
    expect(isToolTraceV2({ 'io.mindroom.tool_trace': { version: 1 } })).toBe(false);
    expect(isToolTraceV2({ 'io.mindroom.tool_trace': { version: 2 } })).toBe(true);
  });
});

describe('getContentToolTraceEvents', () => {
  it('returns structured events when present', () => {
    const events = getContentToolTraceEvents({
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          { type: 'tool_call_started', tool_name: 'search_web', args_preview: 'q=test' },
          { type: 'tool_call_completed', tool_name: 'search_web', result_preview: 'Done' },
        ],
      },
    });

    expect(events).toHaveLength(2);
    expect(events?.[0]).toMatchObject({ type: 'tool_call_started', tool_name: 'search_web' });
  });

  it('filters invalid event entries and returns undefined when empty', () => {
    expect(
      getContentToolTraceEvents({
        'io.mindroom.tool_trace': {
          version: 2,
          events: [null, 'bad', 123],
        },
      })
    ).toBeUndefined();
  });
});
