import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  buildCompactThreadRootData,
  getCompactCachedThreadRootPreviewInfo,
  pickPreferredThreadRootPreviewText,
} from './compactThreadRootData';

const makeEvent = (
  eventId: string,
  body: string,
  editedBody?: string,
  relation?: { event_id: string; rel_type: string; ['m.in_reply_to']?: { event_id: string } }
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
    getType: () => 'm.room.message',
    getSender: () => '@bot:mindroom.chat',
    getTs: () => 1,
    getUnsigned: () => undefined,
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
});
