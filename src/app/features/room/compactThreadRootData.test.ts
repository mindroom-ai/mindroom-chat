import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  buildCompactZeroReplyRootData,
  buildCompactThreadRootData,
  COMPACT_ZERO_REPLY_RECENCY_THRESHOLD_MS,
  getCompactCachedThreadActivityTs,
  getCompactCachedThreadRootPreviewInfo,
  isZeroReplyStandaloneThreadRootEvent,
  mergeCompactThreadRootData,
  pickPreferredThreadRootPreviewText,
} from './compactThreadRootData';

const makeEvent = (
  eventId: string,
  body: string,
  editedBody?: string,
  relation?: { event_id: string; rel_type: string; ['m.in_reply_to']?: { event_id: string } },
  options?: {
    ts?: number;
    type?: string;
    isRedacted?: boolean;
    threadRootId?: string;
  }
) =>
  ({
    event: { event_id: eventId },
    getContent: () =>
      editedBody
        ? {
            body,
            ...(relation ? { 'm.relates_to': relation } : {}),
            'm.new_content': {
              body: editedBody,
            },
          }
        : {
            body,
            ...(relation ? { 'm.relates_to': relation } : {}),
          },
    getId: () => eventId,
    getRelation: () => relation,
    getType: () => options?.type ?? 'm.room.message',
    getSender: () => '@bot:mindroom.chat',
    getTs: () => options?.ts ?? 1,
    getUnsigned: () => undefined,
    isRedacted: () => options?.isRedacted ?? false,
    threadRootId: options?.threadRootId,
    replacingEvent: () =>
      editedBody
        ? ({
            getId: () => `${eventId}-edit`,
            getTs: () => 2,
            getSender: () => '@bot:mindroom.chat',
            getUnsigned: () => undefined,
            getContent: () => ({
              body: `* ${editedBody}`,
              'm.new_content': {
                body: editedBody,
              },
            }),
          } as never)
        : undefined,
  }) as never;

const makeThread = (id: string, rootEvent?: ReturnType<typeof makeEvent>) =>
  ({
    id,
    rootEvent,
  }) as never;

describe('buildCompactThreadRootData', () => {
  const makeRoom = (eventsById?: Record<string, ReturnType<typeof makeEvent>>) =>
    ({
      findEventById: (eventId: string) => eventsById?.[eventId],
      getUnfilteredTimelineSet: () =>
        ({
          relations: {
            getChildEventsForEvent: () => undefined,
          },
        }) as never,
    }) as never;

  it('keeps room-surface thread roots first and appends unseen thread-list roots', () => {
    const data = buildCompactThreadRootData({
      room: makeRoom(),
      visibleIds: ['$visible-a', '$visible-b'],
      visibleIndexMap: new Map([
        ['$visible-a', 2],
        ['$visible-b', 5],
      ]),
      visibleBodyMap: new Map([['$visible-a', 'Visible A']]),
      threads: [
        makeThread('$visible-b'),
        { id: '$thread-c', length: 2 } as never,
        { id: '$thread-d', length: 1 } as never,
      ],
    });

    expect(data.ids).toEqual(['$visible-a', '$visible-b', '$thread-c', '$thread-d']);
    expect(data.indexMap.get('$thread-c')).toBe(6);
    expect(data.indexMap.get('$thread-d')).toBe(7);
  });

  it('hydrates missing body previews from thread root events and prefers edited bodies', () => {
    const data = buildCompactThreadRootData({
      room: makeRoom(),
      visibleIds: [],
      visibleIndexMap: new Map(),
      visibleBodyMap: new Map(),
      threads: [
        {
          id: '$thread-a',
          rootEvent: makeEvent('$thread-a', 'Original root', 'Edited root'),
          length: 1,
        } as never,
        {
          id: '$thread-b',
          rootEvent: makeEvent(
            '$thread-b',
            '> <@bot:mindroom.chat> reply quote\n> continued\n\nVisible body'
          ),
          length: 1,
        } as never,
      ],
    });

    expect(data.bodyMap.get('$thread-a')).toBe('Edited root');
    expect(data.bodyMap.get('$thread-b')).toBe('Visible body');
  });

  it('does not append server thread-list roots that have no actual reply activity', () => {
    const data = buildCompactThreadRootData({
      room: makeRoom(),
      visibleIds: ['$visible-a'],
      visibleIndexMap: new Map([['$visible-a', 0]]),
      visibleBodyMap: new Map(),
      threads: [
        makeThread('$no-replies', makeEvent('$no-replies', 'Thinking...')),
        {
          id: '$has-replies',
          rootEvent: makeEvent('$has-replies', 'Real thread'),
          length: 3,
        } as never,
      ],
    });

    expect(data.ids).toEqual(['$visible-a', '$has-replies']);
    expect(data.ids).not.toContain('$no-replies');
  });

  it('does not append nested thread replies from the server thread list as compact roots', () => {
    const nestedThreadRoot = makeEvent('$nested-thread-root', 'Thinking... ⋯', undefined, {
      event_id: '$parent-thread-root',
      rel_type: 'm.thread',
      'm.in_reply_to': {
        event_id: '$reply-inside-parent-thread',
      },
    });

    const data = buildCompactThreadRootData({
      room: makeRoom({ '$nested-thread-root': nestedThreadRoot }),
      visibleIds: ['$visible-a'],
      visibleIndexMap: new Map([['$visible-a', 0]]),
      visibleBodyMap: new Map(),
      threads: [
        {
          id: '$nested-thread-root',
          rootEvent: nestedThreadRoot,
          length: 1,
        } as never,
      ],
    });

    expect(data.ids).toEqual(['$visible-a']);
    expect(data.ids).not.toContain('$nested-thread-root');
  });

  it('prefers the edited room event over the stale thread-list root event', () => {
    const staleThreadRoot = makeEvent('$thread-a', 'Thinking...  ⋯');
    const roomRootEvent = makeEvent(
      '$thread-a',
      'Thinking...  ⋯',
      'Let me do three things: finish the origin tagging, file CINNY-010, and spawn a sub-agent.'
    );

    const data = buildCompactThreadRootData({
      room: makeRoom({ '$thread-a': roomRootEvent }),
      visibleIds: [],
      visibleIndexMap: new Map(),
      visibleBodyMap: new Map(),
      threads: [
        {
          id: '$thread-a',
          rootEvent: staleThreadRoot,
          length: 1,
        } as never,
      ],
    });

    expect(data.bodyMap.get('$thread-a')).toContain('Let me do three things');
    expect(data.bodyMap.get('$thread-a')).not.toContain('Thinking...');
  });

  it('prefers fresher root previews over stale streaming placeholders', () => {
    expect(
      pickPreferredThreadRootPreviewText({
        preferredPreviewText: 'Final edited body',
        fallbackPreviewText: 'Thinking...  ⋯',
      })
    ).toBe('Final edited body');

    expect(
      pickPreferredThreadRootPreviewText({
        preferredPreviewText: 'Thinking...  ⋯',
        fallbackPreviewText: 'Recovered from cache',
      })
    ).toBe('Recovered from cache');
  });

  it('collects only recent standalone room messages as zero-reply compact roots', () => {
    const now = COMPACT_ZERO_REPLY_RECENCY_THRESHOLD_MS + 10_000;
    const recentMessage = makeEvent('$recent', 'Recent standalone root', undefined, undefined, {
      ts: now - 1_000,
    });
    const oldMessage = makeEvent('$old', 'Older standalone root', undefined, undefined, {
      ts: now - COMPACT_ZERO_REPLY_RECENCY_THRESHOLD_MS - 1_000,
    });
    const knownThreadRoot = makeEvent('$known-thread', 'Known thread root', undefined, undefined, {
      ts: now - 1_000,
    });
    const editEvent = makeEvent(
      '$edit',
      '* edited',
      undefined,
      {
        event_id: '$recent',
        rel_type: 'm.replace',
      },
      { ts: now - 1_000 }
    );
    const nestedReply = makeEvent(
      '$nested-reply',
      'Nested reply',
      undefined,
      {
        event_id: '$parent-root',
        rel_type: 'm.thread',
        'm.in_reply_to': { event_id: '$parent-reply' },
      },
      { ts: now - 1_000, threadRootId: '$parent-root' }
    );
    const redactedMessage = makeEvent('$redacted', 'Redacted root', undefined, undefined, {
      ts: now - 1_000,
      isRedacted: true,
    });

    const data = buildCompactZeroReplyRootData({
      room: makeRoom(),
      roomSurfaceEntries: [
        { event: knownThreadRoot, absoluteIndex: 0 },
        { event: recentMessage, absoluteIndex: 1 },
        { event: oldMessage, absoluteIndex: 2 },
        { event: editEvent, absoluteIndex: 3 },
        { event: nestedReply, absoluteIndex: 4 },
        { event: redactedMessage, absoluteIndex: 5 },
      ],
      knownThreadRootIds: ['$known-thread'],
      now,
    });

    expect(data.ids).toEqual(['$recent']);
    expect(data.indexMap.get('$recent')).toBe(1);
    expect(data.bodyMap.get('$recent')).toBe('Recent standalone root');
  });

  it('recognizes recent standalone room messages as zero-reply thread roots', () => {
    const now = COMPACT_ZERO_REPLY_RECENCY_THRESHOLD_MS + 10_000;

    expect(
      isZeroReplyStandaloneThreadRootEvent(
        makeEvent('$recent', 'Recent standalone root', undefined, undefined, {
          ts: now - 1_000,
        }),
        now
      )
    ).toBe(true);
    expect(
      isZeroReplyStandaloneThreadRootEvent(
        makeEvent('$old', 'Older standalone root', undefined, undefined, {
          ts: now - COMPACT_ZERO_REPLY_RECENCY_THRESHOLD_MS - 1_000,
        }),
        now
      )
    ).toBe(false);
    expect(
      isZeroReplyStandaloneThreadRootEvent(
        makeEvent(
          '$edit',
          '* edited',
          undefined,
          {
            event_id: '$recent',
            rel_type: 'm.replace',
          },
          {
            ts: now - 1_000,
          }
        ),
        now
      )
    ).toBe(false);
  });

  it('merges zero-reply compact roots back into absolute timeline order', () => {
    const merged = mergeCompactThreadRootData(
      {
        ids: ['$thread-root', '$sdk-thread'],
        indexMap: new Map([
          ['$thread-root', 4],
          ['$sdk-thread', 12],
        ]),
        bodyMap: new Map([['$thread-root', 'Existing thread']]),
      },
      {
        ids: ['$zero-reply'],
        indexMap: new Map([['$zero-reply', 8]]),
        bodyMap: new Map([['$zero-reply', 'New standalone message']]),
      }
    );

    expect(merged.ids).toEqual(['$thread-root', '$zero-reply', '$sdk-thread']);
    expect(merged.bodyMap.get('$zero-reply')).toBe('New standalone message');
  });

  it('hydrates edited compact root previews from cached thread pages', () => {
    const preview = getCompactCachedThreadRootPreviewInfo({
      threadId: '$thread-a',
      cachedPage: {
        rootEvent: {
          event_id: '$thread-a',
          origin_server_ts: 1,
          sender: '@bot:mindroom.chat',
          type: 'm.room.message',
          content: {
            body: 'Thinking...  ⋯',
            msgtype: 'm.text',
          },
        },
        events: [
          {
            event_id: '$thread-a-edit',
            origin_server_ts: 2,
            sender: '@bot:mindroom.chat',
            type: 'm.room.message',
            content: {
              body: '* Edited root',
              msgtype: 'm.text',
              'm.new_content': {
                body: 'Edited root',
                msgtype: 'm.text',
              },
              'm.relates_to': {
                event_id: '$thread-a',
                rel_type: 'm.replace',
              },
            },
          },
          {
            event_id: '$thread-a-reply',
            origin_server_ts: 3,
            sender: '@bot:mindroom.chat',
            type: 'm.room.message',
            content: {
              body: '✅ Generation stopped',
              msgtype: 'm.text',
              'm.relates_to': {
                event_id: '$thread-a',
                rel_type: 'm.thread',
                'm.in_reply_to': {
                  event_id: '$thread-a',
                },
              },
            },
          },
        ],
      },
      mapper: (rawEvent) => new MatrixEvent(rawEvent),
    });

    expect(preview).toEqual({
      previewText: 'Edited root',
      sourceTs: 2,
    });
  });

  it('hydrates latest activity timestamps from cached thread pages', () => {
    const activityTs = getCompactCachedThreadActivityTs({
      threadId: '$thread-a',
      cachedPage: {
        rootEvent: {
          event_id: '$thread-a',
          origin_server_ts: 1,
          sender: '@bot:mindroom.chat',
          type: 'm.room.message',
          content: {
            body: 'Original root',
            msgtype: 'm.text',
          },
        },
        events: [
          {
            event_id: '$thread-a-reply',
            origin_server_ts: 3,
            sender: '@bot:mindroom.chat',
            type: 'm.room.message',
            content: {
              body: 'Reply',
              msgtype: 'm.text',
              'm.relates_to': {
                event_id: '$thread-a',
                rel_type: 'm.thread',
                'm.in_reply_to': {
                  event_id: '$thread-a',
                },
              },
            },
          },
          {
            event_id: '$thread-a-reply-edit',
            origin_server_ts: 6,
            sender: '@bot:mindroom.chat',
            type: 'm.room.message',
            content: {
              body: '* Reply edited',
              msgtype: 'm.text',
              'm.new_content': {
                body: 'Reply edited',
                msgtype: 'm.text',
              },
              'm.relates_to': {
                event_id: '$thread-a-reply',
                rel_type: 'm.replace',
              },
            },
          },
          {
            event_id: '$thread-a-reaction',
            origin_server_ts: 9,
            sender: '@bot:mindroom.chat',
            type: 'm.reaction',
            content: {
              'm.relates_to': {
                event_id: '$thread-a-reply',
                rel_type: 'm.annotation',
                key: '👍',
              },
            },
          },
        ],
      },
      mapper: (rawEvent) => new MatrixEvent(rawEvent),
    });

    expect(activityTs).toBe(6);
  });
});
