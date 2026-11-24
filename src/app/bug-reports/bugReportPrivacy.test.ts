import { describe, expect, it } from 'vitest';
import type { BugReport, BugReportEvent } from './bugReportPayload';
import { withoutMessageText } from './bugReportPrivacy';

const item = (event: Record<string, unknown>, latestEdit: Record<string, unknown> | null = null) =>
  ({
    eventId: (event.event_id as string) ?? null,
    status: null,
    decryptionFailure: false,
    event,
    latestEdit,
  } satisfies BugReportEvent);

const report = (events: BugReportEvent[]) =>
  ({
    type: 'io.mindroom.bug_report',
    target: { eventId: '$reply' },
    events,
  } as unknown as BugReport);

describe('withoutMessageText', () => {
  it('keeps each message event but only its msgtype and relation', () => {
    const relation = { rel_type: 'm.thread', event_id: '$root' };
    const result = withoutMessageText(
      report([
        item(
          {
            event_id: '$reply',
            type: 'm.room.message',
            sender: '@reporter:example.org',
            origin_server_ts: 5,
            content: {
              msgtype: 'm.file',
              body: 'secret plan.pdf',
              formatted_body: '<b>secret</b>',
              file: { url: 'mxc://example.org/file', key: { k: 'decryption key' } },
              'io.mindroom.tool_calls': [{ name: 'shell', arguments: 'cat secret' }],
              'm.relates_to': relation,
            },
            unsigned: {
              'm.relations': { 'm.thread': { latest_event: { content: { body: 'x' } } } },
            },
          },
          {
            event_id: '$edit',
            type: 'm.room.message',
            content: {
              msgtype: 'm.text',
              body: '* secret edit',
              'm.new_content': { msgtype: 'm.text', body: 'secret edit' },
              'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
            },
          }
        ),
        item({ event_id: '$like', type: 'm.reaction', content: { 'm.relates_to': relation } }),
      ])
    );

    expect(result.messageTextOmitted).toBe(true);
    expect(result.target.eventId).toBe('$reply');
    expect(result.events[0]?.event).toEqual({
      event_id: '$reply',
      type: 'm.room.message',
      sender: '@reporter:example.org',
      origin_server_ts: 5,
      content: { msgtype: 'm.file', 'm.relates_to': relation },
    });
    expect(result.events[0]?.latestEdit).toEqual({
      event_id: '$edit',
      type: 'm.room.message',
      content: { msgtype: 'm.text', 'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' } },
    });
    expect(result.events[1]?.event.content).toEqual({ 'm.relates_to': relation });
    expect(JSON.stringify(result)).not.toMatch(/secret|decryption key/);
  });

  it('keeps state events, which end-to-end encryption does not cover, whole', () => {
    const name = {
      event_id: '$name',
      type: 'm.room.name',
      state_key: '',
      content: { name: 'Harbor' },
    };
    expect(withoutMessageText(report([item(name)])).events[0]?.event).toEqual(name);
  });
});
