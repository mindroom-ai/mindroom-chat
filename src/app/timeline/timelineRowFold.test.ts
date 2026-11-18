import { describe, expect, it } from 'vitest';
import type { MatrixEvent } from 'matrix-js-sdk';
import { foldTimelineRowContexts, genuineReplyEventId } from './timelineRowFold';

const MINUTE = 60_000;
const START = Date.UTC(2026, 10, 3, 9, 0);

type Row = {
  id: string;
  sender: string;
  type: string;
  minute: number;
  stateKey?: string;
  /** The event it replies to, a genuine reply unless `fallback` (an MSC3440 thread fallback). */
  replyTo?: string;
  fallback?: boolean;
  /** The event it edits; an edit has no row of its own. */
  edits?: string;
  /** Renders as a quiet marker line, such as a thread's title. */
  quiet?: boolean;
};

const toEvent = ({ id, sender, type, minute, stateKey, replyTo, fallback, edits }: Row) => {
  const relation = edits
    ? { rel_type: 'm.replace', event_id: edits }
    : replyTo && {
        rel_type: 'm.thread',
        event_id: '$root',
        is_falling_back: fallback ?? false,
        'm.in_reply_to': { event_id: replyTo },
      };
  return {
    getId: () => id,
    getSender: () => sender,
    getType: () => type,
    getTs: () => START + minute * MINUTE,
    getStateKey: () => stateKey,
    getRelation: () => relation || null,
    getWireContent: () => (relation ? { 'm.relates_to': relation } : {}),
    replyEventId: edits ? undefined : replyTo,
    isRedaction: () => false,
  } as unknown as MatrixEvent;
};

const fold = (rows: Row[], groupStartIndex?: number) => {
  const events = rows.map(toEvent);
  const contexts = foldTimelineRowContexts({
    indexes: events.map((_, index) => index),
    getEvent: (index) => events[index],
    isSkipped: () => false,
    groupStartIndex,
  });
  return rows.map((row, index) => [row.id, contexts.get(index)?.collapse]);
};

describe('foldTimelineRowContexts', () => {
  it("starts a fork's root under its own author line after the parent's last row", () => {
    // Forked from the sender's own message and written a minute later.
    const rows = [
      { id: '$parent', sender: '@maya:x', type: 'm.room.message', minute: 0 },
      { id: '$fork', sender: '@maya:x', type: 'm.room.message', minute: 1 },
      { id: '$more', sender: '@maya:x', type: 'm.room.message', minute: 1 },
    ];
    expect(fold(rows, 1)).toEqual([
      ['$parent', false],
      ['$fork', false],
      ['$more', true],
    ]);
  });

  it('keeps an agent reply, its approval card and its summary notice under one author line', () => {
    expect(
      fold([
        { id: '$ask', sender: '@maya:x', type: 'm.room.message', minute: 0 },
        { id: '$reply', sender: '@code:x', type: 'm.room.message', minute: 1 },
        { id: '$approval', sender: '@code:x', type: 'io.mindroom.tool_approval', minute: 1 },
        { id: '$summary', sender: '@code:x', type: 'm.room.message', minute: 2 },
      ])
    ).toEqual([
      ['$ask', false],
      ['$reply', false],
      ['$approval', true],
      ['$summary', true],
    ]);
  });

  it('starts a new author line for another sender, a long pause, or a state event', () => {
    expect(
      fold([
        { id: '$a', sender: '@code:x', type: 'm.room.message', minute: 0 },
        { id: '$b', sender: '@maya:x', type: 'io.mindroom.tool_approval', minute: 0 },
        { id: '$c', sender: '@maya:x', type: 'm.room.message', minute: 5 },
        { id: '$d', sender: '@maya:x', type: 'm.room.name', minute: 5, stateKey: '' },
        { id: '$e', sender: '@maya:x', type: 'm.room.name', minute: 5, stateKey: '' },
        { id: '$f', sender: '@maya:x', type: 'm.room.message', minute: 5 },
      ])
    ).toEqual([
      ['$a', false],
      ['$b', false],
      ['$c', false],
      ['$d', false],
      ['$e', true],
      ['$f', false],
    ]);
  });

  describe('the unread divider at the first row of a window that starts after the read marker', () => {
    // The room's rows by their place in the loaded timeline; the window mounts the last three.
    const loaded = [10, 20, 30, 40, 50];
    const windowStart = 2;
    const unreadAt = (readUptoAbsoluteIndex: number) => {
      const events = loaded.map((absolute) =>
        toEvent({ id: `$${absolute}`, sender: '@maya:x', type: 'm.room.message', minute: 0 })
      );
      const contexts = foldTimelineRowContexts({
        indexes: [0, 1, 2],
        getEvent: (index) => events[windowStart + index],
        isSkipped: () => false,
        getAbsoluteIndex: (index) => loaded[windowStart + index],
        readUptoAbsoluteIndex,
      });
      return [0, 1, 2].filter((index) => contexts.get(index)?.unreadDivider);
    };

    it('goes nowhere while the first unread row is above the window', () => {
      expect(unreadAt(10)).toEqual([]);
    });

    it('goes above the first row when the read marker is the row just before the window', () => {
      expect(unreadAt(20)).toEqual([0]);
    });

    it('goes above the first unread row inside the window', () => {
      expect(unreadAt(30)).toEqual([1]);
    });
  });

  it('puts the unread divider above the first unread row past rows that render nothing, wherever the window starts', () => {
    // A read row, twenty rows the timeline skips (settled approvals, say), then an unread answer.
    const events = [
      toEvent({ id: '$read', sender: '@maya:x', type: 'm.room.message', minute: 0 }),
      ...Array.from({ length: 20 }, (_, n) =>
        toEvent({ id: `$hidden${n}`, sender: '@maya:x', type: 'm.room.message', minute: 0 })
      ),
      toEvent({ id: '$answer', sender: '@maya:x', type: 'm.room.message', minute: 1 }),
    ];
    const answer = events.length - 1;
    const contextOfAnswer = (firstIndex: number) =>
      foldTimelineRowContexts({
        indexes: Array.from({ length: events.length - firstIndex }, (_, n) => firstIndex + n),
        getEvent: (index) => events[index],
        isSkipped: (event) => event.getId()?.startsWith('$hidden') ?? false,
        getAbsoluteIndex: (index) => index,
        readUptoAbsoluteIndex: 0,
      }).get(answer);
    for (const firstIndex of [0, 10, answer]) {
      expect([firstIndex, contextOfAnswer(firstIndex)]).toEqual([
        firstIndex,
        expect.objectContaining({ unreadDivider: true, collapse: false }),
      ]);
    }
  });

  it('gives each row the same context wherever the window starts', () => {
    const day = 24 * 60;
    const rows: Row[] = [
      { id: '$a', sender: '@maya:x', type: 'm.room.message', minute: 0 },
      { id: '$a-edit', sender: '@maya:x', type: 'm.room.message', minute: day, edits: '$a' },
      { id: '$b', sender: '@maya:x', type: 'm.room.message', minute: day, replyTo: '$a' },
      {
        id: '$levels',
        sender: '@maya:x',
        type: 'm.room.power_levels',
        minute: 2 * day,
        stateKey: '',
      },
      { id: '$poll', sender: '@maya:x', type: 'org.example.poll', minute: 2 * day },
      { id: '$c', sender: '@maya:x', type: 'm.room.message', minute: 2 * day, replyTo: '$b' },
      { id: '$d', sender: '@maya:x', type: 'm.room.message', minute: 2 * day + 1 },
      { id: '$poll2', sender: '@code:x', type: 'org.example.poll', minute: 3 * day },
      { id: '$e', sender: '@code:x', type: 'm.room.message', minute: 3 * day },
    ];
    const events = rows.map(toEvent);
    const contextsFrom = (firstIndex: number, readUptoAbsoluteIndex: number) => {
      const contexts = foldTimelineRowContexts({
        indexes: Array.from({ length: events.length - firstIndex }, (_, n) => firstIndex + n),
        getEvent: (index) => events[index],
        isSkipped: () => false,
        getAbsoluteIndex: (index) => index,
        readUptoAbsoluteIndex,
      });
      return rows
        .slice(firstIndex)
        .map((row, n) => [row.id, contexts.get(firstIndex + n)] as const);
    };
    for (let readUpto = 0; readUpto < rows.length; readUpto += 1) {
      const whole = contextsFrom(0, readUpto);
      for (let firstIndex = 1; firstIndex < rows.length; firstIndex += 1) {
        expect(contextsFrom(firstIndex, readUpto)).toEqual(whole.slice(firstIndex));
      }
    }
    // The dividers skip the events that render nothing.
    const withDivider = (divider: 'dayDivider' | 'unreadDivider', readUpto: number) =>
      contextsFrom(0, readUpto).flatMap(([id, context]) => (context?.[divider] ? [id] : []));
    expect(withDivider('dayDivider', 0)).toEqual(['$b', '$c', '$e']);
    expect(withDivider('unreadDivider', 3)).toEqual(['$c']);
    expect(withDivider('unreadDivider', 6)).toEqual(['$e']);
  });

  describe('reply quotes', () => {
    const message = (id: string, sender: string, minute: number, more: Partial<Row> = {}): Row => ({
      id,
      sender,
      type: 'm.room.message',
      minute,
      ...more,
    });
    /** The rows that quote what they reply to, as the message renderer decides it. */
    const quoting = (rows: Row[], indexes = rows.map((_, index) => index)) => {
      const events = rows.map(toEvent);
      const quiet = new Set(rows.flatMap((row) => (row.quiet ? [row.id] : [])));
      const contexts = foldTimelineRowContexts({
        indexes,
        getEvent: (index) => events[index],
        isSkipped: () => false,
        isQuietMarker: (event) => quiet.has(event.getId() ?? ''),
      });
      return indexes.flatMap((index) => {
        const event = events[index];
        const target = event && genuineReplyEventId(event);
        return target && target !== contexts.get(index)?.inPlaceReplyEventId ? [event.getId()] : [];
      });
    };

    // A voice message, the router's transcript of it, and the agent's answer: the backend sends
    // both the transcript and the answer as replies to the voice message.
    const voice = [
      message('$root', '@alice:x', 0),
      message('$voice', '@alice:x', 1, { replyTo: '$root', fallback: true }),
      message('$transcript', '@mindroom_router:x', 1, { replyTo: '$voice' }),
      message('$transcript-edit', '@mindroom_router:x', 1, { edits: '$transcript' }),
      message('$answer', '@mindroom_helper:x', 2, { replyTo: '$voice' }),
    ];

    it('leave out the message that the rows between it and the reply all answer', () => {
      expect(quoting(voice)).toEqual([]);
    });

    it('leave it out the same way when the window starts at the reply', () => {
      expect(quoting(voice, [4])).toEqual([]);
      expect(quoting(voice, [3, 4])).toEqual([]);
    });

    it('leave out the message two agents both answer', () => {
      expect(
        quoting([
          message('$ask', '@alice:x', 0),
          message('$first', '@mindroom_helper:x', 1, { replyTo: '$ask' }),
          message('$second', '@mindroom_coder:x', 1, { replyTo: '$ask' }),
        ])
      ).toEqual([]);
    });

    it('leave out the message right above when only a reaction or an edit sits between', () => {
      expect(
        quoting([
          message('$ask', '@alice:x', 0),
          message('$ask-edit', '@alice:x', 0, { edits: '$ask' }),
          message('$answer', '@mindroom_helper:x', 1, { replyTo: '$ask' }),
        ])
      ).toEqual([]);
    });

    /** `quoting` from every window start agrees with the whole fold. */
    const quotingFromEveryStart = (rows: Row[]) =>
      rows.map((_, first) => quoting(rows, rows.map((__, index) => index).slice(first)));
    const fromEveryStart = (rows: Row[], quoted: string[]) =>
      rows.map((_, first) =>
        quoted.filter((id) => rows.findIndex((row) => row.id === id) >= first)
      );

    // An agent's question, its thread's title and skill review notices, then its answer to the
    // option the reader picked by reaction.
    const marker = (id: string, minute: number, replyTo: string): Row =>
      message(id, '@mindroom_helper:x', minute, { replyTo, fallback: true, quiet: true });
    const answered = [
      message('$question', '@mindroom_helper:x', 0),
      marker('$title', 1, '$question'),
      marker('$review', 1, '$title'),
      message('$answer', '@mindroom_helper:x', 3, { replyTo: '$question' }),
    ];

    it('leave out the message right above when only quiet marker rows sit between', () => {
      expect(quotingFromEveryStart(answered)).toEqual(fromEveryStart(answered, []));
    });

    it('show it past the same notices where they render as full rows, as in a room', () => {
      const rows = answered.map((row) => ({ ...row, quiet: false }));
      expect(quotingFromEveryStart(rows)).toEqual(fromEveryStart(rows, ['$answer']));
    });

    it('leave out a quiet marker that replies target, right above them past other markers', () => {
      const rows = [
        message('$ask', '@alice:x', 0),
        marker('$title', 1, '$ask'),
        message('$first', '@alice:x', 2, { replyTo: '$title' }),
        message('$second', '@bob:x', 2, { replyTo: '$title' }),
        marker('$review', 3, '$second'),
        message('$third', '@alice:x', 4, { replyTo: '$title' }),
        message('$fourth', '@alice:x', 5, { replyTo: '$ask' }),
      ];
      expect(quotingFromEveryStart(rows)).toEqual(fromEveryStart(rows, ['$fourth']));
    });

    it('show an older message when another message sits between it and the reply', () => {
      expect(
        quoting([
          message('$old', '@alice:x', 0),
          message('$later', '@bob:x', 1, { replyTo: '$old', fallback: true }),
          message('$more', '@bob:x', 2, { replyTo: '$later', fallback: true }),
          message('$reply', '@alice:x', 3, { replyTo: '$old' }),
        ])
      ).toEqual(['$reply']);
    });

    it('show it once an unrelated message breaks the run of replies to it', () => {
      const rows = [
        message('$old', '@alice:x', 0),
        message('$first', '@mindroom_helper:x', 1, { replyTo: '$old' }),
        message('$aside', '@bob:x', 2, { replyTo: '$first', fallback: true }),
        message('$second', '@mindroom_coder:x', 3, { replyTo: '$old' }),
      ];
      expect(quoting(rows)).toEqual(['$second']);
      expect(quoting(rows, [3])).toEqual(['$second']);
    });
  });

  describe('quiet marker runs', () => {
    const row = (id: string, minute: number, more: Partial<Row> = {}): Row => ({
      id,
      sender: '@mindroom_helper:x',
      type: 'm.room.message',
      minute,
      ...more,
    });
    const marker = (id: string, minute: number) => row(id, minute, { quiet: true });
    /**
     * What each row of the window shows: '' for a marker folded into the row of its run, the run's
     * markers joined by '+' on that row (its first), else the row's own ID.
     */
    const shown = (
      rows: Row[],
      {
        indexes = rows.map((_, index) => index),
        groupStartIndex,
        readUptoAbsoluteIndex,
        quietRunEndIndex,
        alone = [],
      }: {
        indexes?: number[];
        groupStartIndex?: number;
        readUptoAbsoluteIndex?: number;
        quietRunEndIndex?: number;
        /** Markers that never join a run, as a snooze ending. */
        alone?: string[];
      } = {}
    ) => {
      const events = rows.map(toEvent);
      const quiet = new Set(rows.flatMap((each) => (each.quiet ? [each.id] : [])));
      const contexts = foldTimelineRowContexts({
        indexes,
        getEvent: (index) => events[index],
        isSkipped: () => false,
        getAbsoluteIndex: (index) => index,
        readUptoAbsoluteIndex,
        groupStartIndex,
        quietRunEndIndex,
        isQuietMarker: (event) => quiet.has(event.getId() ?? ''),
        joinsQuietRun: (event) => !alone.includes(event.getId() ?? ''),
      });
      return indexes.map((index) => {
        const context = contexts.get(index);
        if (context?.inQuietRun) return '';
        const run = context?.quietRunIndexes;
        return run ? [index, ...run].map((each) => rows[each]?.id).join('+') : rows[index]?.id;
      });
    };

    it('show two or three markers in a row as one row, on the first of them', () => {
      expect(shown([row('$reply', 0), marker('$title', 1), marker('$review', 1)])).toEqual([
        '$reply',
        '$title+$review',
        '',
      ]);
      expect(
        shown([row('$reply', 0), marker('$title', 1), marker('$review', 1), marker('$other', 2)])
      ).toEqual(['$reply', '$title+$review+$other', '', '']);
    });

    it('leave a lone marker as it is', () => {
      expect(shown([marker('$title', 0), row('$reply', 1)])).toEqual(['$title', '$reply']);
    });

    it('leave a marker that never joins a run on its own row, between runs', () => {
      const rows = [marker('$title', 0), marker('$snooze', 1), marker('$a', 2), marker('$b', 2)];
      expect(shown(rows, { alone: ['$snooze'] })).toEqual(['$title', '$snooze', '$a+$b', '']);
    });

    it('start a new run after a message between markers', () => {
      expect(shown([marker('$a', 0), row('$reply', 1), marker('$b', 2), marker('$c', 2)])).toEqual([
        '$a',
        '$reply',
        '$b+$c',
        '',
      ]);
    });

    it('join markers past an edit, which has no row', () => {
      expect(shown([marker('$a', 0), row('$a-edit', 0, { edits: '$a' }), marker('$b', 1)])).toEqual(
        ['$a+$b', '$a-edit', '']
      );
    });

    it('break a run at a day divider, an unread divider or a group start', () => {
      const rows = [marker('$a', 0), marker('$b', 24 * 60)];
      expect(shown(rows)).toEqual(['$a', '$b']);
      const sameDay = [marker('$a', 0), marker('$b', 1), marker('$c', 2)];
      expect(shown(sameDay, { readUptoAbsoluteIndex: 0 })).toEqual(['$a', '$b+$c', '']);
      expect(shown(sameDay, { readUptoAbsoluteIndex: 1 })).toEqual(['$a+$b', '', '$c']);
      expect(shown(sameDay, { groupStartIndex: 1 })).toEqual(['$a', '$b+$c', '']);
    });

    it("end a run at a fork draft's line under one of its markers", () => {
      const rows = [marker('$a', 0), marker('$b', 1), marker('$c', 2)];
      expect(shown(rows, { quietRunEndIndex: 1 })).toEqual(['$a+$b', '', '$c']);
    });

    it('show each row the same wherever the window starts or ends', () => {
      const rows = [
        row('$ask', 0),
        marker('$a', 1),
        row('$a-edit', 1, { edits: '$a' }),
        marker('$b', 1),
        marker('$c', 2),
        row('$reply', 3),
        marker('$d', 4),
        marker('$e', 4),
      ];
      const whole = shown(rows);
      expect(whole).toEqual(['$ask', '$a+$b+$c', '$a-edit', '', '', '$reply', '$d+$e', '']);
      for (let first = 0; first < rows.length; first += 1) {
        for (let last = first; last < rows.length; last += 1) {
          const indexes = rows.map((_, index) => index).slice(first, last + 1);
          expect(shown(rows, { indexes })).toEqual(whole.slice(first, last + 1));
        }
      }
    });
  });
});
