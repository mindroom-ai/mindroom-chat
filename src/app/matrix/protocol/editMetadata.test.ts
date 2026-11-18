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

  it('does not carry a long-text marker into a later edit', () => {
    // The marker means "this event's file holds the message"; it is true only beside that file.
    const shortEdit: Record<string, unknown> = { msgtype: 'm.text', body: 'Short now' };

    copyResolvedEditMetadata(shortEdit, [
      {
        'm.new_content': {
          msgtype: 'm.file',
          body: 'The start of a long edit',
          url: 'mxc://example.org/sidecar',
          'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
        },
      },
    ]);

    expect(shortEdit).toEqual({ msgtype: 'm.text', body: 'Short now' });
  });

  it('never copies the time a borrowed stream status was sent without its status', () => {
    const latest: Record<string, unknown> = { body: 'Edited by hand' };

    copyResolvedEditMetadata(latest, [
      { 'm.new_content': { 'io.mindroom.stream_status_ts': 2000 } },
    ]);

    expect(latest).toEqual({ body: 'Edited by hand' });
  });

  it('never copies the widgets or a form answer, so an edit without them shows none', () => {
    const latest: Record<string, unknown> = { body: 'Now in prose' };
    const ui = { version: 1, widgets: [{ id: 'df4d729a5d', json: '{}' }] };
    const answer = { version: 1, event_id: '$form', widget: 'df4d729a5d' };

    copyResolvedEditMetadata(latest, [
      {
        'm.new_content': { 'io.mindroom.ui': ui, 'io.mindroom.ui_response': answer },
        'io.mindroom.ui': ui,
        'io.mindroom.ui_response': answer,
      },
    ]);

    expect(latest).toEqual({ body: 'Now in prose' });
  });
});
