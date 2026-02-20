import { describe, expect, it } from 'vitest';
import {
  buildMindroomToolTraceHtml,
  mergeMindroomToolTraceIntoCustomBody,
} from './mindroomToolTrace';

describe('buildMindroomToolTraceHtml', () => {
  it('builds pending tool html from tool_call_started', () => {
    const html = buildMindroomToolTraceHtml({
      'io.mindroom.tool_trace': {
        version: 1,
        events: [
          {
            type: 'tool_call_started',
            tool_name: 'search_web',
            args_preview: 'query=latest AI news',
          },
        ],
      },
    });

    expect(html).toBe('<tool>search_web(query=latest AI news)</tool>');
  });

  it('builds grouped html and resolves start/completed pairs', () => {
    const html = buildMindroomToolTraceHtml({
      'io.mindroom.tool_trace': {
        version: 1,
        events: [
          {
            type: 'tool_call_started',
            tool_name: 'search_web',
            args_preview: 'query=latest AI news',
          },
          {
            type: 'tool_call_completed',
            tool_name: 'search_web',
            result_preview: 'Results found: 5',
          },
          {
            type: 'tool_call_started',
            tool_name: 'read_file',
            args_preview: 'path=/tmp/data.json',
          },
        ],
      },
    });

    expect(html).toBe(
      '<tool-group>\n<tool>search_web(query=latest AI news)\nResults found: 5</tool>\n<tool>read_file(path=/tmp/data.json)</tool>\n</tool-group>'
    );
  });
});

describe('mergeMindroomToolTraceIntoCustomBody', () => {
  it('appends tool trace html when formatted_body has no tool tags', () => {
    const merged = mergeMindroomToolTraceIntoCustomBody({
      body: 'Hi there',
      formatted_body: '<p>Hi there</p>',
      'io.mindroom.tool_trace': {
        version: 1,
        events: [{ type: 'tool_call_started', tool_name: 'search_web', args_preview: 'q=test' }],
      },
    });

    expect(merged.formatted_body).toBe(
      '<p>Hi there</p><br/><tool>search_web(q=test)</tool>'
    );
  });

  it('does not modify formatted_body when tool tags already exist', () => {
    const merged = mergeMindroomToolTraceIntoCustomBody({
      body: 'Hi there',
      formatted_body: '<tool>search_web(q=test)</tool>',
      'io.mindroom.tool_trace': {
        version: 1,
        events: [{ type: 'tool_call_started', tool_name: 'search_web', args_preview: 'q=test' }],
      },
    });

    expect(merged.formatted_body).toBe('<tool>search_web(q=test)</tool>');
  });
});
