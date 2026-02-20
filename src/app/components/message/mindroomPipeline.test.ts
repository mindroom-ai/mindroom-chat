import { describe, expect, it } from 'vitest';
import { mergeMindroomToolTraceIntoCustomBody } from './mindroomToolTrace';
import { resolveMindroomLongTextContent } from './mindroomLongText';

describe('MindRoom message pipeline', () => {
  it('clears tool-trace formatted preview when full text is plain text', () => {
    const withToolTrace = mergeMindroomToolTraceIntoCustomBody({
      body: 'preview',
      'io.mindroom.tool_trace': {
        version: 1,
        events: [{ type: 'tool_call_started', tool_name: 'search_web', args_preview: 'q=test' }],
      },
    });
    const resolved = resolveMindroomLongTextContent(withToolTrace, 'full plain text');

    expect(typeof withToolTrace.formatted_body).toBe('string');
    expect((withToolTrace.formatted_body as string).includes('<tool>')).toBe(true);
    expect((resolved.formatted_body as string).includes('<tool>')).toBe(true);
    expect(resolved.body).toBe('full plain text');
    expect(resolved.formatted_body).toBeUndefined();
  });

  it('replaces preview tool-trace html when long text includes definitive mindroom tags', () => {
    const withToolTrace = mergeMindroomToolTraceIntoCustomBody({
      body: 'preview',
      'io.mindroom.tool_trace': {
        version: 1,
        events: [{ type: 'tool_call_started', tool_name: 'search_web', args_preview: 'q=test' }],
      },
    });
    const resolved = resolveMindroomLongTextContent(
      withToolTrace,
      '<tool-group><tool>search_web(q=test)\nDone</tool></tool-group>'
    );

    expect(resolved.formatted_body).toBe(
      '<tool-group><tool>search_web(q=test)\nDone</tool></tool-group>'
    );
  });
});
