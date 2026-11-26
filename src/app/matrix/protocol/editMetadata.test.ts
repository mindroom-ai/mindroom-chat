import { describe, expect, it } from 'vitest';

import { copyResolvedEditMetadata } from './editMetadata';

describe('copyResolvedEditMetadata', () => {
  it('copies only missing MindRoom metadata from edit wrapper sources in priority order', () => {
    const resolvedContent: Record<string, unknown> = {
      body: 'Final answer',
      msgtype: 'm.text',
      'io.mindroom.ai_run': { version: 1, status: 'streaming' },
    };

    copyResolvedEditMetadata(resolvedContent, [
      {
        'm.new_content': {
          'io.mindroom.tool_trace': {
            version: 2,
            events: [{ type: 'tool_call_completed', tool_name: 'run_shell_command' }],
          },
        },
        'io.mindroom.ai_run': { version: 1, status: 'completed' },
        'io.mindroom.stream_status': 'completed',
        'm.mentions': { user_ids: ['@alice:example.org'] },
        'org.example.unrelated': true,
      },
      {
        'com.mindroom.skip_mentions': true,
        'io.mindroom.stream_status': 'streaming',
      },
    ]);

    expect(resolvedContent).toEqual({
      body: 'Final answer',
      msgtype: 'm.text',
      'io.mindroom.ai_run': { version: 1, status: 'streaming' },
      'io.mindroom.tool_trace': {
        version: 2,
        events: [{ type: 'tool_call_completed', tool_name: 'run_shell_command' }],
      },
      'io.mindroom.stream_status': 'completed',
      'com.mindroom.skip_mentions': true,
    });
  });

  it.each<[string, Record<string, unknown>]>([
    [
      'a long-text marker',
      {
        'm.new_content': {
          msgtype: 'm.file',
          body: 'The start of a long edit',
          url: 'mxc://example.org/sidecar',
          'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
        },
      },
    ],
    ['a borrowed stream_status_ts', { 'm.new_content': { 'io.mindroom.stream_status_ts': 2000 } }],
    [
      'io.mindroom.inline_media from an edit or outer fallback',
      {
        'm.new_content': {
          'io.mindroom.inline_media': { 'mxc://example.org/a': { url: 'mxc://example.org/a' } },
        },
        'io.mindroom.inline_media': { 'mxc://example.org/b': { url: 'mxc://example.org/b' } },
      },
    ],
  ])('never carries %s into a later edit', (_label, source) => {
    const latest: Record<string, unknown> = { msgtype: 'm.text', body: 'Short now' };
    copyResolvedEditMetadata(latest, [source]);
    expect(latest).toEqual({ msgtype: 'm.text', body: 'Short now' });
  });
});
