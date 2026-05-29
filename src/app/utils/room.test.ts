import { MatrixEvent, RelationType } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { getEditedEvent, getLatestEdit, getLatestMessageContent, roomHaveUnread } from './room';

const makeMessageEvent = (
  eventId: string,
  ts: number,
  sender = '@alice:example.org',
  body = 'original'
) =>
  new MatrixEvent({
    content: {
      body,
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

const makeEditEvent = (
  eventId: string,
  ts: number,
  targetEventId: string,
  sender = '@alice:example.org'
) =>
  new MatrixEvent({
    content: {
      body: `* ${eventId}`,
      'm.new_content': {
        body: `${eventId}`,
        msgtype: 'm.text',
      },
      'm.relates_to': {
        event_id: targetEventId,
        rel_type: 'm.replace',
      },
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

const makeThreadReplyEvent = (eventId: string, ts: number, sender = '@bob:example.org') =>
  new MatrixEvent({
    content: {
      'm.relates_to': {
        event_id: '$thread-root',
        'm.in_reply_to': {
          event_id: '$thread-root',
        },
        is_falling_back: true,
        rel_type: RelationType.Thread,
      },
      body: eventId,
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

const attachSerializedReplacement = ({
  targetEvent,
  replacementEventId,
  ts,
  sender = '@alice:example.org',
}: {
  targetEvent: MatrixEvent;
  replacementEventId: string;
  ts?: number;
  sender?: string;
}) => {
  targetEvent.event.unsigned = {
    'm.relations': {
      'm.replace': {
        content: {
          body: '* bundled',
          'm.new_content': {
            body: 'bundled',
            msgtype: 'm.text',
          },
          'm.relates_to': {
            event_id: targetEvent.getId(),
            rel_type: 'm.replace',
          },
          msgtype: 'm.text',
        },
        event_id: replacementEventId,
        ...(typeof ts === 'number' ? { origin_server_ts: ts } : {}),
        room_id: '!room:example.org',
        sender,
        type: 'm.room.message',
      },
    },
  };
};

describe('room edit helpers', () => {
  it('prefers the newest edit when the SDK replacement is newer than relation edits', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const sdkReplacement = makeEditEvent('$sdk-latest', 3000, '$target');
    const staleRelationEdit = makeEditEvent('$stale', 2000, '$target');

    targetEvent.makeReplaced(sdkReplacement);

    const getChildEventsForEvent = vi.fn().mockReturnValue({
      getRelations: () => [staleRelationEdit],
    });
    const timelineSet = {
      relations: {
        getChildEventsForEvent,
      },
    } as any;

    const editedEvent = getEditedEvent('$target', targetEvent, timelineSet);

    expect(editedEvent).toBe(sdkReplacement);
    expect(getChildEventsForEvent).toHaveBeenCalled();
  });

  it('prefers newer relation edits over a stale SDK replacement', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const staleSdkReplacement = makeEditEvent('$sdk-stale', 2000, '$target');
    const completedRelationEdit = makeEditEvent('$completed', 3000, '$target');

    targetEvent.makeReplaced(staleSdkReplacement);

    const timelineSet = {
      relations: {
        getChildEventsForEvent: vi.fn().mockReturnValue({
          getRelations: () => [completedRelationEdit],
        }),
      },
    } as any;

    const editedEvent = getEditedEvent('$target', targetEvent, timelineSet);

    expect(editedEvent).toBe(completedRelationEdit);
  });

  it('falls back to relation edits when SDK replacement is unavailable', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const olderEdit = makeEditEvent('$older', 2000, '$target');
    const newerEdit = makeEditEvent('$newer', 3000, '$target');
    const otherSenderEdit = makeEditEvent('$other', 4000, '$target', '@bob:example.org');

    const timelineSet = {
      relations: {
        getChildEventsForEvent: vi.fn().mockReturnValue({
          getRelations: () => [olderEdit, otherSenderEdit, newerEdit],
        }),
      },
    } as any;

    const editedEvent = getEditedEvent('$target', targetEvent, timelineSet);
    expect(editedEvent).toBe(newerEdit);
  });

  it('prefers a newer serialized replacement over stale sdk and relation edits', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const sdkReplacement = makeEditEvent('$sdk', 2000, '$target');
    const relationEdit = makeEditEvent('$relation', 3000, '$target');
    targetEvent.makeReplaced(sdkReplacement);
    attachSerializedReplacement({
      targetEvent,
      replacementEventId: '$serialized',
      ts: 4000,
    });

    const timelineSet = {
      relations: {
        getChildEventsForEvent: vi.fn().mockReturnValue({
          getRelations: () => [relationEdit],
        }),
      },
    } as any;

    const editedEvent = getEditedEvent('$target', targetEvent, timelineSet);

    expect(editedEvent?.getId()).toBe('$serialized');
  });

  it('prefers later relations when edits share the same timestamp', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const firstEdit = makeEditEvent('$edit-1', 2000, '$target');
    const secondEdit = makeEditEvent('$edit-2', 2000, '$target');

    const latest = getLatestEdit(targetEvent, [firstEdit, secondEdit]);
    expect(latest).toBe(secondEdit);
  });

  it('prefers the serialized replacement when it ties a relation edit on timestamp', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const relationEdit = makeEditEvent('$relation', 3000, '$target');
    attachSerializedReplacement({
      targetEvent,
      replacementEventId: '$serialized',
      ts: 3000,
    });

    const timelineSet = {
      relations: {
        getChildEventsForEvent: vi.fn().mockReturnValue({
          getRelations: () => [relationEdit],
        }),
      },
    } as any;

    const editedEvent = getEditedEvent('$target', targetEvent, timelineSet);

    expect(editedEvent?.getId()).toBe('$serialized');
  });

  it('ignores serialized replacements without origin_server_ts', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const relationEdit = makeEditEvent('$relation', 3000, '$target');
    attachSerializedReplacement({
      targetEvent,
      replacementEventId: '$serialized',
      ts: undefined,
    });

    const timelineSet = {
      relations: {
        getChildEventsForEvent: vi.fn().mockReturnValue({
          getRelations: () => [relationEdit],
        }),
      },
    } as any;

    const editedEvent = getEditedEvent('$target', targetEvent, timelineSet);

    expect(editedEvent).toBe(relationEdit);
  });

  it('rejects sender-mismatched serialized replacements before candidate selection', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const relationEdit = makeEditEvent('$relation', 3000, '$target');
    attachSerializedReplacement({
      targetEvent,
      replacementEventId: '$serialized',
      ts: 4000,
      sender: '@mallory:example.org',
    });

    const timelineSet = {
      relations: {
        getChildEventsForEvent: vi.fn().mockReturnValue({
          getRelations: () => [relationEdit],
        }),
      },
    } as any;

    const editedEvent = getEditedEvent('$target', targetEvent, timelineSet);

    expect(editedEvent).toBe(relationEdit);
  });

  it('preserves top-level MindRoom metadata from the replacement wrapper content', () => {
    const targetEvent = makeMessageEvent('$target', 1000, '@alice:example.org', 'Thinking...  ⋯');
    const replacementEvent = new MatrixEvent({
      content: {
        body: '* Final answer',
        'io.mindroom.ai_run': {
          version: 1,
          status: 'completed',
        },
        'io.mindroom.stream_status': 'completed',
        'm.new_content': {
          body: 'Final answer',
          msgtype: 'm.text',
        },
        'm.relates_to': {
          event_id: '$target',
          rel_type: 'm.replace',
        },
        msgtype: 'm.text',
      },
      event_id: '$edit-final',
      origin_server_ts: 2000,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
    });

    const resolvedContent = getLatestMessageContent(targetEvent, replacementEvent);

    expect(resolvedContent).toMatchObject({
      body: 'Final answer',
      msgtype: 'm.text',
      'io.mindroom.ai_run': {
        version: 1,
        status: 'completed',
      },
      'io.mindroom.stream_status': 'completed',
    });
  });

  it('preserves MindRoom message extras when replacement new_content omits them', () => {
    const extras = {
      version: 1,
      sections: [
        {
          title: 'Evidence',
          content_type: 'text/plain',
          content: 'extra payload',
        },
      ],
    };
    const targetEvent = makeMessageEvent('$target', 1000, '@alice:example.org', 'Thinking...  ⋯');
    const replacementEvent = new MatrixEvent({
      content: {
        body: '* Final answer',
        'com.mindroom.message_extras': extras,
        'm.new_content': {
          body: 'Final answer',
          msgtype: 'm.text',
        },
        'm.relates_to': {
          event_id: '$target',
          rel_type: 'm.replace',
        },
        msgtype: 'm.text',
      },
      event_id: '$edit-final',
      origin_server_ts: 2000,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
    });

    const resolvedContent = getLatestMessageContent(targetEvent, replacementEvent);

    expect(resolvedContent['com.mindroom.message_extras']).toEqual(extras);
  });

  it('uses newer replacement events as MindRoom metadata fallbacks for streaming edits', () => {
    const targetEvent = makeMessageEvent('$target', 1000, '@alice:example.org', 'Thinking...  ⋯');
    const traceMetadata = {
      version: 2,
      events: [
        {
          type: 'tool_call_completed',
          tool_name: 'run_shell_command',
          result_preview: 'Done',
        },
      ],
    };
    const priorReplacementEvent = new MatrixEvent({
      content: {
        body: '* Prior',
        'm.new_content': {
          body: 'Prior\n\n🔧 `run_shell_command` [1]',
          'io.mindroom.tool_trace': traceMetadata,
          msgtype: 'm.text',
        },
        'm.relates_to': {
          event_id: '$target',
          rel_type: 'm.replace',
        },
        msgtype: 'm.text',
      },
      event_id: '$edit-prior',
      origin_server_ts: 2000,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
    });
    const latestReplacementEvent = new MatrixEvent({
      content: {
        body: '* Latest',
        'm.new_content': {
          body: 'Latest\n\n🔧 `run_shell_command` [1]\n\n🔧 `run_shell_command` [2] ⏳',
          'io.mindroom.stream_status': 'streaming',
          msgtype: 'm.text',
        },
        'm.relates_to': {
          event_id: '$target',
          rel_type: 'm.replace',
        },
        msgtype: 'm.text',
      },
      event_id: '$edit-latest',
      origin_server_ts: 3000,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
    });

    const timelineSet = {
      relations: {
        getChildEventsForEvent: vi.fn().mockReturnValue({
          getRelations: () => [priorReplacementEvent, latestReplacementEvent],
        }),
      },
    } as any;

    const editedEvent = getEditedEvent('$target', targetEvent, timelineSet);
    const resolvedContent = getLatestMessageContent(targetEvent, editedEvent);

    expect(resolvedContent.body).toBe(
      'Latest\n\n🔧 `run_shell_command` [1]\n\n🔧 `run_shell_command` [2] ⏳'
    );
    expect(resolvedContent['io.mindroom.stream_status']).toBe('streaming');
    expect(resolvedContent['io.mindroom.tool_trace']).toEqual(traceMetadata);
  });
});

describe('roomHaveUnread', () => {
  it('ignores hidden thread-only activity when no visible main-timeline unread remains', () => {
    const threadReply = makeThreadReplyEvent('$thread-reply', 1000);
    const room = {
      findEventById: vi.fn(() => undefined),
      getEventReadUpTo: vi.fn(() => null),
      getLiveTimeline: vi.fn(() => ({
        getEvents: () => [threadReply],
      })),
    } as any;
    const mx = {
      getUserId: vi.fn(() => '@alice:example.org'),
    } as any;

    expect(roomHaveUnread(mx, room)).toBe(false);
  });

  it('keeps the unread fallback when the loaded main-timeline slice still contains visible activity', () => {
    const mainEvent = makeMessageEvent('$main', 1000, '@bob:example.org');
    const room = {
      findEventById: vi.fn(() => undefined),
      getEventReadUpTo: vi.fn(() => '$older'),
      getLiveTimeline: vi.fn(() => ({
        getEvents: () => [mainEvent],
      })),
    } as any;
    const mx = {
      getUserId: vi.fn(() => '@alice:example.org'),
    } as any;

    expect(roomHaveUnread(mx, room)).toBe(true);
  });
});
