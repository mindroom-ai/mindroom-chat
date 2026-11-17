import { describe, expect, it } from 'vitest';
import { getContentToolTraceEvents, isToolTraceV2, runningToolCalls } from './toolTrace';

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

describe('runningToolCalls', () => {
  const started = (name: string) => ({ type: 'tool_call_started', tool_name: name });
  const completed = (name: string) => ({ type: 'tool_call_completed', tool_name: name });

  it('counts the calls a streaming reply started and has not completed, with their names', () => {
    expect(
      runningToolCalls([completed('read_file'), started('shell'), started('grep')], true)
    ).toEqual({ count: 2, names: ['shell', 'grep'] });
  });

  it('names each tool once and counts a call without a name', () => {
    expect(
      runningToolCalls([started('shell'), started('shell'), { type: 'tool_call_started' }], true)
    ).toEqual({ count: 3, names: ['shell'] });
  });

  it('counts none when every call completed or there is no trace', () => {
    expect(runningToolCalls([completed('shell')], true)).toEqual({ count: 0, names: [] });
    expect(runningToolCalls(undefined, true)).toEqual({ count: 0, names: [] });
  });

  it('counts none once the reply stopped streaming, even without the completed event', () => {
    expect(runningToolCalls([started('shell')], false)).toEqual({ count: 0, names: [] });
  });
});
