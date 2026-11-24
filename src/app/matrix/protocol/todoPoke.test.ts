import { describe, expect, it } from 'vitest';
import { HOOK_SOURCE_KEY, readTodoPoke, TODO_POKE_CONTENT_KEY } from './todoPoke';

describe('readTodoPoke', () => {
  it('parses structured io.mindroom.todo_poke v1 for m.text, m.notice, and long-text m.file', () => {
    const items = [
      { id: 'f10c3a89', title: 'Fix session token refresh race', priority: 'critical' as const },
      {
        id: 'a4f19c20',
        title: 'Publish API changelog for v2.4 release',
        priority: 'medium' as const,
      },
    ];
    const payload = { version: 1, assigned_agent: 'maya', total_count: 7, items };
    const expected = { assignedAgent: 'maya', totalCount: 7, rawBody: 'fallback', items };

    expect(
      readTodoPoke({ msgtype: 'm.text', body: 'fallback', [TODO_POKE_CONTENT_KEY]: payload })
    ).toEqual(expected);
    expect(
      readTodoPoke({
        msgtype: 'm.notice',
        body: 'fallback',
        [TODO_POKE_CONTENT_KEY]: { version: 1, items },
      })
    ).toEqual({ items, totalCount: 2, rawBody: 'fallback' });
    expect(
      readTodoPoke({
        msgtype: 'm.file',
        body: 'preview',
        url: 'mxc://example.org/todo-sidecar',
        'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
        [TODO_POKE_CONTENT_KEY]: payload,
      })
    ).toEqual({ ...expected, rawBody: 'preview' });
  });

  it('defaults invalid total_count and rejects malformed structured payloads or ordinary m.file', () => {
    expect(
      readTodoPoke({
        msgtype: 'm.text',
        body: 'b',
        [TODO_POKE_CONTENT_KEY]: {
          version: 1,
          total_count: 0,
          assigned_agent: ' ',
          items: [{ id: 'a4f19c20', title: 'Draft release notes', priority: 'low' }],
        },
      })
    ).toEqual({
      items: [{ id: 'a4f19c20', title: 'Draft release notes', priority: 'low' }],
      totalCount: 1,
      rawBody: 'b',
    });

    const validItem = { id: 'a4f19c20', title: 'Task', priority: 'high' };
    for (const bad of [
      {
        msgtype: 'm.image',
        body: 'img',
        [TODO_POKE_CONTENT_KEY]: { version: 1, items: [validItem] },
      },
      {
        msgtype: 'm.file',
        body: 'f.json',
        url: 'mxc://x/y',
        [TODO_POKE_CONTENT_KEY]: { version: 1, items: [validItem] },
      },
      {
        msgtype: 'm.text',
        body: 'v2',
        [TODO_POKE_CONTENT_KEY]: { version: 2, items: [validItem] },
      },
      { msgtype: 'm.text', body: 'e', [TODO_POKE_CONTENT_KEY]: { version: 1, items: [] } },
      { msgtype: 'm.text', body: 'n', [TODO_POKE_CONTENT_KEY]: null },
      {
        msgtype: 'm.text',
        body: 'p',
        [TODO_POKE_CONTENT_KEY]: { version: 1, items: [{ ...validItem, priority: 'urgent' }] },
      },
      {
        msgtype: 'm.text',
        body: 't',
        [TODO_POKE_CONTENT_KEY]: { version: 1, items: [{ ...validItem, title: '  ' }] },
      },
    ]) {
      expect(readTodoPoke(bad)).toBeNull();
    }
  });

  it('parses legacy history messages gated strictly on com.mindroom.hook_source === todo_poke', () => {
    const body = [
      '@mindroom_maya:example.org Todo work is ready. Continue with these actionable items:',
      '- `a4f19c20` [medium] `Publish API changelog for v2.4 release`',
      '- ``b82e07d1`` [high] `` `sync` job for @\u200bteam ``',
      '- …and 3 more actionable item(s).',
    ].join('\r\n');

    expect(readTodoPoke({ msgtype: 'm.text', body })).toBeNull();
    expect(readTodoPoke({ msgtype: 'm.text', body, [HOOK_SOURCE_KEY]: 'other' })).toBeNull();
    expect(readTodoPoke({ msgtype: 'm.text', body, [HOOK_SOURCE_KEY]: 'todo_poke' })).toEqual({
      assignedAgent: 'maya',
      totalCount: 5,
      rawBody: body,
      items: [
        { id: 'a4f19c20', priority: 'medium', title: 'Publish API changelog for v2.4 release' },
        { id: 'b82e07d1', priority: 'high', title: '`sync` job for @team' },
      ],
    });
  });

  it('parses new clean Markdown fallback with escaped titles, priorities, and overflow', () => {
    const body = [
      '@Maya **7 todos ready** — continue with these actionable items:',
      '',
      '- Fix \\*race\\* in \\[auth\\] — v2 with \\\\* and \\`code\\` for @\u200bops — Critical · `f10c3a89`',
      '- Trim \\_unused\\_ \\~legacy\\~ \\<css\\> rules — low · `73c8a102`',
      '- ...and 5 more actionable item(s).',
    ].join('\n');

    expect(readTodoPoke({ msgtype: 'm.text', body, [HOOK_SOURCE_KEY]: 'todo_poke' })).toEqual({
      assignedAgent: 'Maya',
      totalCount: 7,
      rawBody: body,
      items: [
        {
          id: 'f10c3a89',
          priority: 'critical',
          title: 'Fix *race* in [auth] — v2 with \\* and `code` for @ops',
        },
        { id: '73c8a102', priority: 'low', title: 'Trim _unused_ ~legacy~ <css> rules' },
      ],
    });
  });

  it('returns null on corrupted or itemless hook_source todo_poke bodies', () => {
    const header =
      '@mindroom_maya:example.org Todo work is ready. Continue with these actionable items:';
    expect(
      readTodoPoke({
        msgtype: 'm.text',
        body: `${header}\n- \`a4f19c20\` [medium] \`Task\`\nUnexpected trailing prose`,
        [HOOK_SOURCE_KEY]: 'todo_poke',
      })
    ).toBeNull();
    expect(
      readTodoPoke({ msgtype: 'm.text', body: header, [HOOK_SOURCE_KEY]: 'todo_poke' })
    ).toBeNull();
  });
});
