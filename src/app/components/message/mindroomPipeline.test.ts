import { describe, expect, it } from 'vitest';
import { resolveMindroomLongTextContent } from './mindroomLongText';

describe('MindRoom message pipeline', () => {
  it('clears v2 tool-ref preview html when fetched long text is plain text', () => {
    const previewContent = {
      body: 'preview',
      formatted_body: '<p>🔧 <code>search_web</code> [1]</p>',
      'io.mindroom.tool_trace': {
        version: 2,
        events: [{ type: 'tool_call_completed', tool_name: 'search_web', result_preview: 'Done' }],
      },
    };

    const resolved = resolveMindroomLongTextContent(previewContent, 'full plain text');

    expect(resolved.body).toBe('full plain text');
    expect(resolved.formatted_body).toBeUndefined();
  });

  it('replaces preview formatted_body when long text contains supported mindroom tags', () => {
    const previewContent = {
      body: 'preview',
      formatted_body: '<p>🔧 <code>search_web</code> [1]</p>',
    };

    const resolved = resolveMindroomLongTextContent(
      previewContent,
      '<analysis>Reasoned answer with sources</analysis>'
    );

    expect(resolved.formatted_body).toBe('<analysis>Reasoned answer with sources</analysis>');
  });
});
