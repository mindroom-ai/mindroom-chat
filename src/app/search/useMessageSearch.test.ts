import { IResultContext, ISearchResult } from 'matrix-js-sdk';
import { beforeAll, describe, expect, it } from 'vitest';
import { trustAgentsOfViewer } from '../matrix/protocol/untrustedContent';
import {
  collapseThreadTitleHits,
  deduplicateResults,
  dropEditedAwayResults,
  type MessageSearchPage,
  type ResultItem,
} from './useMessageSearch';

type SearchResultOptions = {
  eventId: string;
  roomId?: string;
  ts: number;
  editTargetId?: string;
  content?: Record<string, unknown>;
  sender?: string;
};

const makeSearchResult = ({
  eventId,
  roomId = '!room:example.org',
  ts,
  editTargetId,
  content,
  sender = '@alice:example.org',
}: SearchResultOptions): ISearchResult => ({
  rank: ts,
  result: {
    content: content ?? {
      ...(editTargetId
        ? {
            'm.new_content': {
              body: `${eventId} body`,
              msgtype: 'm.text',
            },
            'm.relates_to': {
              event_id: editTargetId,
              rel_type: 'm.replace',
            },
          }
        : {}),
      body: `${eventId} body`,
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: roomId,
    sender,
    type: 'm.room.message',
  },
  context: {} as IResultContext,
});

const getEventIds = (results: ISearchResult[]): string[] =>
  results.map((result) => result.result.event_id);

describe('deduplicateResults', () => {
  it('passes through results without edits', () => {
    const results = [
      makeSearchResult({ eventId: '$one', ts: 100 }),
      makeSearchResult({ eventId: '$two', ts: 200 }),
    ];

    expect(getEventIds(deduplicateResults(results))).toEqual(['$one', '$two']);
  });

  it('keeps the edit instead of the original when both match', () => {
    const results = [
      makeSearchResult({ eventId: '$original', ts: 100 }),
      makeSearchResult({ eventId: '$edit', ts: 200, editTargetId: '$original' }),
    ];

    expect(getEventIds(deduplicateResults(results))).toEqual(['$edit']);
  });

  it('keeps only the latest edit when multiple edits match the same message', () => {
    const results = [
      makeSearchResult({ eventId: '$original', ts: 100 }),
      makeSearchResult({ eventId: '$edit-1', ts: 200, editTargetId: '$original' }),
      makeSearchResult({ eventId: '$edit-2', ts: 300, editTargetId: '$original' }),
      makeSearchResult({ eventId: '$edit-3', ts: 400, editTargetId: '$original' }),
    ];

    expect(getEventIds(deduplicateResults(results))).toEqual(['$edit-3']);
  });

  it('merges an edit into the original only when the same sender sent both', () => {
    const original = makeSearchResult({ eventId: '$original', ts: 100 });
    const otherSenderEdit = makeSearchResult({
      eventId: '$other-sender-edit',
      ts: 200,
      editTargetId: '$original',
      sender: '@bob:example.org',
    });
    const ownEdit = makeSearchResult({ eventId: '$own-edit', ts: 300, editTargetId: '$original' });

    expect(getEventIds(deduplicateResults([original, otherSenderEdit]))).toEqual([
      '$original',
      '$other-sender-edit',
    ]);
    expect(getEventIds(deduplicateResults([original, otherSenderEdit, ownEdit]))).toEqual([
      '$other-sender-edit',
      '$own-edit',
    ]);
  });

  it('keeps an edit-only match when the original is not present', () => {
    const results = [makeSearchResult({ eventId: '$edit', ts: 200, editTargetId: '$original' })];

    expect(getEventIds(deduplicateResults(results))).toEqual(['$edit']);
  });

  it('does not collapse results from different rooms', () => {
    const results = [
      makeSearchResult({ eventId: '$shared', roomId: '!one:example.org', ts: 100 }),
      makeSearchResult({ eventId: '$shared', roomId: '!two:example.org', ts: 200 }),
    ];

    expect(getEventIds(deduplicateResults(results))).toEqual(['$shared', '$shared']);
    expect(deduplicateResults(results).map((result) => result.result.room_id)).toEqual([
      '!one:example.org',
      '!two:example.org',
    ]);
  });

  it('does not collapse a redacted edit with the original', () => {
    const results = [
      makeSearchResult({ eventId: '$original', ts: 100 }),
      makeSearchResult({
        eventId: '$redacted-edit',
        ts: 200,
        content: {},
      }),
    ];

    expect(getEventIds(deduplicateResults(results))).toEqual(['$original', '$redacted-edit']);
  });

  it('preserves server ordering after removing losing duplicates', () => {
    const results = [
      makeSearchResult({ eventId: '$original', ts: 100 }),
      makeSearchResult({ eventId: '$other', roomId: '!two:example.org', ts: 150 }),
      makeSearchResult({ eventId: '$edit', ts: 200, editTargetId: '$original' }),
      makeSearchResult({ eventId: '$last', roomId: '!three:example.org', ts: 250 }),
    ];

    expect(getEventIds(deduplicateResults(results))).toEqual(['$other', '$edit', '$last']);
  });
});

/** An original as servers return it with its latest edit bundled (spec v1.7 and later). */
const withLatestEdit = (
  result: ISearchResult,
  editId: string,
  body: string,
  sender = result.result.sender
): ISearchResult => ({
  ...result,
  result: {
    ...result.result,
    unsigned: {
      'm.relations': {
        'm.replace': {
          event_id: editId,
          sender,
          content: {
            body: `* ${body}`,
            msgtype: 'm.text',
            'm.new_content': { body, msgtype: 'm.text' },
            'm.relates_to': { rel_type: 'm.replace', event_id: result.result.event_id },
          },
        },
      },
    },
  },
});

describe('deduplicateResults with a bundled latest edit', () => {
  it('keeps the original that carries the latest edit over an older edit that matched', () => {
    const original = withLatestEdit(
      makeSearchResult({ eventId: '$original', ts: 100 }),
      '$edit-2',
      'final text'
    );
    const olderEdit = makeSearchResult({ eventId: '$edit-1', ts: 200, editTargetId: '$original' });

    expect(getEventIds(deduplicateResults([olderEdit, original]))).toEqual(['$original']);
  });

  it('keeps the sender’s edit over an original that carries another sender’s bundled edit', () => {
    const original = withLatestEdit(
      makeSearchResult({ eventId: '$original', ts: 100 }),
      '$other-edit',
      'other text',
      '@bob:example.org'
    );
    const ownEdit = makeSearchResult({ eventId: '$edit-1', ts: 200, editTargetId: '$original' });

    expect(getEventIds(deduplicateResults([ownEdit, original]))).toEqual(['$edit-1']);
  });
});

describe('dropEditedAwayResults', () => {
  beforeAll(() => trustAgentsOfViewer('@reader:example.org'));

  const placeholder = (eventId: string, latest: string) =>
    withLatestEdit(
      makeSearchResult({ eventId, ts: 100, content: { body: 'Thinking...', msgtype: 'm.text' } }),
      `${eventId}-edit`,
      latest
    );

  it('drops a hit whose latest edit no longer has the searched word', () => {
    const results = [
      placeholder('$answered', 'Hello from **Helper**. The plan has three steps.'),
      placeholder('$still', 'I was thinking about the launch plan.'),
      makeSearchResult({ eventId: '$plain', ts: 300, content: { body: 'Thinking about lunch' } }),
    ];

    expect(getEventIds(dropEditedAwayResults(results, 'Thinking'))).toEqual(['$still', '$plain']);
  });

  it('drops a hit whose latest edit has the searched word only inside a longer word', () => {
    const results = [
      withLatestEdit(
        makeSearchResult({ eventId: '$hit', ts: 100, content: { body: 'Gamma will be ready.' } }),
        '$hit-edit',
        'The beta build is out.'
      ),
    ];

    expect(getEventIds(dropEditedAwayResults(results, 'be'))).toEqual([]);
  });

  it('keeps a hit whose bundled edit another sender made', () => {
    const results = [
      withLatestEdit(
        makeSearchResult({ eventId: '$hit', ts: 100, content: { body: 'Thinking...' } }),
        '$other-edit',
        'Hello from **Helper**.',
        '@bob:example.org'
      ),
    ];

    expect(getEventIds(dropEditedAwayResults(results, 'Thinking'))).toEqual(['$hit']);
  });

  it("keeps an agent's hit whose tool call is on its latest edit, out of its text", () => {
    // A reply's first text has its call's marker; its finished edit has the call's place instead.
    const working = (eventId: string, sender: string): ISearchResult => {
      const hit = withLatestEdit(
        makeSearchResult({
          eventId,
          ts: 100,
          sender,
          content: { body: '🔧 `walrus_count` [1] ⏳', msgtype: 'm.text' },
        }),
        `${eventId}-edit`,
        'Seven.'
      );
      const edit = hit.result.unsigned?.['m.relations']?.['m.replace'] as {
        content: { 'm.new_content': Record<string, unknown> };
      };
      edit.content['m.new_content']['io.mindroom.tool_trace'] = {
        version: 3,
        events: [{ type: 'tool_call_completed', tool_name: 'walrus_count', body_line: 0, at: 0 }],
      };
      return hit;
    };
    const results = [
      working('$agent', '@mindroom_helper:example.org'),
      working('$person', '@alice:example.org'),
    ];

    expect(getEventIds(dropEditedAwayResults(results, 'walrus_count'))).toEqual(['$agent']);
  });

  it('keeps hits it cannot compare: edits, unedited messages and stemmed matches', () => {
    const results = [
      makeSearchResult({ eventId: '$edit', ts: 200, editTargetId: '$original' }),
      makeSearchResult({ eventId: '$unedited', ts: 300, content: { body: 'Thinking...' } }),
      // The server matched "think" in "thought"; neither text has the word as typed.
      withLatestEdit(
        makeSearchResult({ eventId: '$stemmed', ts: 400, content: { body: 'I thought so' } }),
        '$stemmed-edit',
        'Never mind'
      ),
    ];

    expect(getEventIds(dropEditedAwayResults(results, 'think'))).toEqual([
      '$edit',
      '$unedited',
      '$stemmed',
    ]);
    expect(getEventIds(dropEditedAwayResults(results, '  '))).toHaveLength(3);
  });
});

describe('collapseThreadTitleHits', () => {
  const inThread = (rootId: string) => ({
    'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
  });
  const title = (eventId: string, rootId: string, roomId = '!a:example.org'): ResultItem => {
    const { result, rank, context } = makeSearchResult({
      eventId,
      roomId,
      ts: 1,
      sender: '@mindroom_helper:example.org',
      content: {
        msgtype: 'm.notice',
        body: 'Roadmap for the beta',
        'io.mindroom.thread_summary': { version: 1, summary: 'Roadmap for the beta' },
        ...inThread(rootId),
      },
    });
    return { event: result, rank, context };
  };
  const message = (eventId: string, roomId = '!a:example.org', content?: object): ResultItem => {
    const { result, rank, context } = makeSearchResult({
      eventId,
      roomId,
      ts: 1,
      content: { msgtype: 'm.text', body: 'Roadmap for the beta', ...content },
    });
    return { event: result, rank, context };
  };
  const page = (items: ResultItem[]): MessageSearchPage => ({
    highlights: ['roadmap'],
    // As the server's order groups them: a new group whenever the room changes.
    groups: items.reduce<MessageSearchPage['groups']>((groups, item) => {
      const last = groups.at(-1);
      if (last?.roomId === item.event.room_id) last.items.push(item);
      else groups.push({ roomId: item.event.room_id, items: [item] });
      return groups;
    }, []),
    hidden: 0,
  });
  const collapse = (...pages: MessageSearchPage[]) =>
    collapseThreadTitleHits({ pages, pageParams: pages.map(() => undefined) }).pages.map(
      ({ groups, hidden }) => ({
        groups: groups.map((group) => [group.roomId, group.items.map((i) => i.event.event_id)]),
        hidden,
      })
    );

  it('keeps one title per thread over every page, and every message people and agents wrote', () => {
    expect(
      collapse(
        page([title('$t3', '$root'), message('$said', '!a:example.org', inThread('$root'))]),
        page([message('$same'), title('$t2', '$root'), title('$t1', '$root'), message('$next')]),
        page([title('$other', '$root', '!b:example.org'), title('$t4', '$another')])
      )
    ).toEqual([
      { groups: [['!a:example.org', ['$t3', '$said']]], hidden: 0 },
      { groups: [['!a:example.org', ['$same', '$next']]], hidden: 2 },
      // The same root id in another room is another thread.
      {
        groups: [
          ['!b:example.org', ['$other']],
          ['!a:example.org', ['$t4']],
        ],
        hidden: 0,
      },
    ]);
  });
});
