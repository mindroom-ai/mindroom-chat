import { describe, expect, it } from 'vitest';

import {
  expandMindroomToolMarkerLines,
  getMessageCopyTextSource,
  hasMindroomToolMarkerLines,
  isCopyTextMessageContent,
  stripMindroomToolMarkerLines,
} from './messageCopyText';

const TOOL_TRACE_KEY = 'io.mindroom.tool_trace';

const getMessageCopyTextBody = (
  ...args: Parameters<typeof getMessageCopyTextSource>
): string | undefined => getMessageCopyTextSource(...args)?.body;

describe('getMessageCopyTextSource body selection', () => {
  it('prefers the edited wrapper body when present', () => {
    expect(
      getMessageCopyTextBody(
        {
          body: 'edited plain text',
          'm.new_content': {
            formatted_body: '<strong>edited</strong>',
          },
        },
        { body: 'original text' }
      )
    ).toBe('edited plain text');
  });

  it('falls back to m.new_content.body when wrapper body is absent', () => {
    expect(
      getMessageCopyTextBody(
        {
          'm.new_content': {
            body: 'edited plain text',
          },
        },
        { body: 'original text' }
      )
    ).toBe('edited plain text');
  });

  it('falls back to the original event body when edited content has no plain text body', () => {
    expect(
      getMessageCopyTextBody(
        {
          'm.new_content': {
            formatted_body: '<strong>edited</strong>',
          },
        },
        { body: 'original text' }
      )
    ).toBe('original text');
  });

  describe('overflow long-text resolution', () => {
    it('prefers the resolved long-text body over the wrapper placeholder', () => {
      expect(
        getMessageCopyTextBody(
          {
            msgtype: 'm.file',
            body: 'Long text overflow...',
            url: 'mxc://mindroom/overflow',
            'io.mindroom.long_text': {
              version: 2,
              encoding: 'matrix_event_content_json',
            },
          },
          { body: 'original placeholder' },
          {
            msgtype: 'm.text',
            body: 'Actual long response',
          }
        )
      ).toBe('Actual long response');
    });

    it('falls back to resolved m.new_content.body when the resolved wrapper body is absent', () => {
      expect(
        getMessageCopyTextBody(
          {
            msgtype: 'm.file',
            body: 'Long text overflow...',
          },
          { body: 'original placeholder' },
          {
            msgtype: 'm.text',
            'm.new_content': {
              msgtype: 'm.text',
              body: 'Edited resolved body',
            },
          }
        )
      ).toBe('Edited resolved body');
    });

    it('falls back to the existing envelope chain when no resolved long-text content is provided', () => {
      expect(
        getMessageCopyTextBody(
          {
            msgtype: 'm.file',
            body: 'Long text overflow...',
          },
          { body: 'original placeholder' }
        )
      ).toBe('Long text overflow...');
    });

    it('falls through when neither the resolved content nor the envelope has a plain body', () => {
      expect(
        getMessageCopyTextBody(
          {
            msgtype: 'm.file',
            'm.new_content': {
              formatted_body: '<p>formatted only</p>',
            },
          },
          {
            formatted_body: '<p>still formatted only</p>',
          },
          {
            msgtype: 'm.text',
            body: '',
            'm.new_content': {
              msgtype: 'm.text',
              body: '',
            },
          }
        )
      ).toBeUndefined();
    });
  });
});

describe('isCopyTextMessageContent', () => {
  it('allows text-like msgtypes', () => {
    expect(isCopyTextMessageContent({ msgtype: 'm.text' })).toBe(true);
    expect(isCopyTextMessageContent({ msgtype: 'm.notice' })).toBe(true);
    expect(isCopyTextMessageContent({ msgtype: 'm.emote' })).toBe(true);
  });

  it('rejects non-text msgtypes', () => {
    expect(isCopyTextMessageContent({ msgtype: 'm.image' })).toBe(false);
    expect(isCopyTextMessageContent({ msgtype: 'm.file' })).toBe(false);
    expect(isCopyTextMessageContent({})).toBe(false);
  });
});

describe('getMessageCopyTextSource', () => {
  const trace = (toolName: string) => ({
    version: 2,
    events: [{ type: 'tool_call_completed', tool_name: toolName }],
  });

  it('reads tool trace events from the resolved long-text content that supplied the body', () => {
    const source = getMessageCopyTextSource(
      {
        msgtype: 'm.file',
        body: 'Long text overflow...',
        [TOOL_TRACE_KEY]: trace('envelope_tool'),
      },
      { body: 'original placeholder' },
      {
        msgtype: 'm.text',
        body: 'Actual long response',
        [TOOL_TRACE_KEY]: trace('resolved_tool'),
      }
    );

    expect(source?.body).toBe('Actual long response');
    expect(source?.toolTraceEvents?.[0]?.tool_name).toBe('resolved_tool');
  });

  it('keeps hydrated long text on its own trace like the renderer', () => {
    const source = getMessageCopyTextSource(
      {
        body: 'wrapper body',
        [TOOL_TRACE_KEY]: trace('wrapper_tool'),
      },
      { body: 'original body' },
      {
        msgtype: 'm.text',
        body: 'resolved body',
      }
    );

    expect(source?.body).toBe('resolved body');
    expect(source?.toolTraceEvents).toBeUndefined();
  });

  it('falls back to the edit wrapper trace when the body comes from m.new_content', () => {
    const source = getMessageCopyTextSource(
      {
        'm.new_content': { body: 'edited body' },
        [TOOL_TRACE_KEY]: trace('wrapper_tool'),
      },
      { body: 'original body' }
    );

    expect(source?.body).toBe('edited body');
    expect(source?.toolTraceEvents?.[0]?.tool_name).toBe('wrapper_tool');
  });

  it('ignores traces that are not version 2', () => {
    const source = getMessageCopyTextSource(
      {
        body: 'body',
        [TOOL_TRACE_KEY]: { version: 1, events: [{ tool_name: 'legacy' }] },
      },
      {}
    );

    expect(source?.body).toBe('body');
    expect(source?.toolTraceEvents).toBeUndefined();
  });

  it('returns undefined when no plain body exists', () => {
    expect(getMessageCopyTextSource({ formatted_body: '<p>x</p>' }, {})).toBeUndefined();
  });
});

describe('hasMindroomToolMarkerLines', () => {
  it('detects standalone markers outside code fences only', () => {
    expect(hasMindroomToolMarkerLines('Text\n\n🔧 `search_web` [1]\n\nMore')).toBe(true);
    expect(hasMindroomToolMarkerLines('Text\n\n🔧 `shell` [2] ⏳')).toBe(true);
    expect(hasMindroomToolMarkerLines('Use 🔧 `search_web` [1] inline')).toBe(false);
    expect(hasMindroomToolMarkerLines('```\n🔧 `search_web` [1]\n```')).toBe(false);
    expect(hasMindroomToolMarkerLines('plain text')).toBe(false);
  });
});

describe('stripMindroomToolMarkerLines', () => {
  it('returns bodies without markers unchanged', () => {
    const body = 'Line one\r\n\r\n\r\nLine two  \n';
    expect(stripMindroomToolMarkerLines(body)).toBe(body);
  });

  it('removes marker lines together with their spacing', () => {
    expect(
      stripMindroomToolMarkerLines(
        'Let me check.\n\n🔧 `search_web` [1]\n\n🔧 `read_file` [2] ⏳\n\nIt is sunny.'
      )
    ).toBe('Let me check.\n\nIt is sunny.');
  });

  it('removes leading and trailing markers', () => {
    expect(stripMindroomToolMarkerLines('🔧 `a` [1]\n\nAnswer\n\n🔧 `b` [2]\n')).toBe('Answer');
  });

  it('keeps a paragraph break where an unspaced marker separated text', () => {
    expect(stripMindroomToolMarkerLines('text\n🔧 `a` [1]\nmore')).toBe('text\n\nmore');
  });

  it('keeps marker-looking lines inside fenced code blocks', () => {
    expect(
      stripMindroomToolMarkerLines(
        [
          'Example:',
          '',
          '~~~~',
          '```',
          '🔧 `inside_tilde` [1]',
          '~~~~',
          '',
          '```md',
          '🔧 `inside_backtick` [1]',
          '```',
          '',
          '🔧 `search_web` [1]',
          '',
          'Done.',
        ].join('\n')
      )
    ).toBe(
      [
        'Example:',
        '',
        '~~~~',
        '```',
        '🔧 `inside_tilde` [1]',
        '~~~~',
        '',
        '```md',
        '🔧 `inside_backtick` [1]',
        '```',
        '',
        'Done.',
      ].join('\n')
    );
  });

  it('keeps inline marker mentions and LaTeX untouched', () => {
    expect(
      stripMindroomToolMarkerLines(
        '$$\nE = mc^2\n$$\n\n🔧 `calculator` [1]\n\nUse 🔧 `x` [1] with $x^2$.'
      )
    ).toBe('$$\nE = mc^2\n$$\n\nUse 🔧 `x` [1] with $x^2$.');
  });

  it('normalizes CRLF bodies that contain markers', () => {
    expect(stripMindroomToolMarkerLines('A\r\n\r\n🔧 `a` [1]\r\n\r\nB\r\n')).toBe('A\n\nB');
  });

  it('tracks fences that open inside list items and block quotes', () => {
    expect(
      stripMindroomToolMarkerLines(
        [
          '- ```',
          '  🔧 `inside_list` [1]',
          '  ```',
          '',
          '> ```',
          '> 🔧 `inside_quote` [1]',
          '> ```',
          '',
          '🔧 `real` [2]',
          '',
          'B',
        ].join('\n')
      )
    ).toBe(
      [
        '- ```',
        '  🔧 `inside_list` [1]',
        '  ```',
        '',
        '> ```',
        '> 🔧 `inside_quote` [1]',
        '> ```',
        '',
        'B',
      ].join('\n')
    );
  });

  it('keeps markers in indented code blocks', () => {
    const body = 'Code:\n\n    🔧 `a` [1]\n  \t🔧 `b` [2]';
    expect(stripMindroomToolMarkerLines(body)).toBe(body);
  });

  it('returns an empty string for marker-only bodies', () => {
    expect(stripMindroomToolMarkerLines('🔧 `a` [1] ⏳\n\n🔧 `b` [2]')).toBe('');
  });
});

describe('expandMindroomToolMarkerLines', () => {
  it('replaces markers with the structured tool trace', () => {
    expect(
      expandMindroomToolMarkerLines('Let me check.\n\n🔧 `search_web` [1]\n\nIt is sunny.', [
        {
          type: 'tool_call_completed',
          tool_name: 'search_web',
          args_preview: 'query=weather Amsterdam',
          result_preview: 'Sunny, 21°C\nLight wind',
        },
      ])
    ).toBe(
      [
        'Let me check.',
        '',
        '**🔧 Tool call 1**',
        '',
        '```',
        'search_web(query=weather Amsterdam)',
        '```',
        '',
        'Result:',
        '',
        '```',
        'Sunny, 21°C',
        'Light wind',
        '```',
        '',
        'It is sunny.',
      ].join('\n')
    );
  });

  it('marks running, truncated, and unavailable tool calls', () => {
    expect(
      expandMindroomToolMarkerLines('🔧 `shell` [1] ⏳\n🔧 `read_file` [2]\n\n🔧 `lost` [3]', [
        { type: 'tool_call_started', tool_name: 'shell' },
        {
          type: 'tool_call_completed',
          tool_name: 'read_file',
          args_preview: 'path=a.md',
          truncated: true,
        },
      ])
    ).toBe(
      [
        '**🔧 Tool call 1 (running)**',
        '',
        '```',
        'shell',
        '```',
        '',
        '**🔧 Tool call 2 (preview truncated)**',
        '',
        '```',
        'read_file(path=a.md)',
        '```',
        '',
        '**🔧 Tool call 3 (details unavailable)**',
        '',
        '```',
        'lost',
        '```',
      ].join('\n')
    );
  });

  it('keeps pending markers without trace data marked as running', () => {
    expect(
      expandMindroomToolMarkerLines('🔧 `read_file` [1] ⏳\n\n🔧 `shell` [2] ⏳', [
        { tool_name: 'read_file' },
      ])
    ).toBe(
      [
        '**🔧 Tool call 1 (running)**',
        '',
        '```',
        'read_file',
        '```',
        '',
        '**🔧 Tool call 2 (running, details unavailable)**',
        '',
        '```',
        'shell',
        '```',
      ].join('\n')
    );
  });

  it('preserves result indentation and normalizes result line endings', () => {
    expect(
      expandMindroomToolMarkerLines('🔧 `read_file` [1]', [
        {
          type: 'tool_call_completed',
          tool_name: 'read_file',
          result_preview: '\r\n    indented\r\n  second  \r\n\r\n',
        },
      ])
    ).toBe(
      [
        '**🔧 Tool call 1**',
        '',
        '```',
        'read_file',
        '```',
        '',
        'Result:',
        '',
        '```',
        '    indented',
        '  second',
        '```',
      ].join('\n')
    );
  });

  it('uses fences longer than any backtick run in the tool data', () => {
    expect(
      expandMindroomToolMarkerLines('🔧 `read_file` [1]', [
        {
          type: 'tool_call_completed',
          tool_name: 'read_file',
          result_preview: '```js\nconst x = 1;\n```',
        },
      ])
    ).toBe(
      [
        '**🔧 Tool call 1**',
        '',
        '```',
        'read_file',
        '```',
        '',
        'Result:',
        '',
        '````',
        '```js',
        'const x = 1;',
        '```',
        '````',
      ].join('\n')
    );
  });

  it('leaves marker-looking lines inside fenced code and bodies without markers unchanged', () => {
    const body = '```\n🔧 `search_web` [1]\n```';
    expect(expandMindroomToolMarkerLines(body, [{ tool_name: 'search_web' }])).toBe(body);
  });
});
