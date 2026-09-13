import { describe, expect, it } from 'vitest';

import { copyMindroomResolvedEditMetadata } from './editMetadata';

describe('copyMindroomResolvedEditMetadata', () => {
  it('copies only missing MindRoom metadata from edit wrapper sources in priority order', () => {
    const resolvedContent: Record<string, unknown> = {
      body: 'Final answer',
      msgtype: 'm.text',
      'io.mindroom.ai_run': { version: 1, status: 'streaming' },
    };

    copyMindroomResolvedEditMetadata(resolvedContent, [
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
});
