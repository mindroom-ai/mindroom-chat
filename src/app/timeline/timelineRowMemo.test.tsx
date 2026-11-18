// @vitest-environment jsdom
import { act, create } from 'react-test-renderer';
import { MatrixEvent, type EventTimelineSet } from 'matrix-js-sdk';
import type { VirtualItem } from '@tanstack/react-virtual';
import { describe, expect, it, vi } from 'vitest';
import { renderTimelineTiles } from './roomTimelineRows';
import type { TimelineMessageData, TimelineMessageRow } from './message-rendering/types';

// The list renders on every scroll step and measurement. A row renders again only when what it
// is given changed: its own row, what the rows share, or one of the list's sources; and then it
// shows what its event holds by then.

const DAY = 24 * 60 * 60_000;
const START = new Date(2026, 10, 3, 12, 0).getTime();

const event = (id: string, ts: number, sender = '@maya:x', replyTo?: string) =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:x',
    sender,
    type: 'm.room.message',
    origin_server_ts: ts,
    content: {
      body: id,
      msgtype: 'm.text',
      ...(replyTo ? { 'm.relates_to': { 'm.in_reply_to': { event_id: replyTo } } } : {}),
    },
  });

const plans = () =>
  ({
    approvalTimeline: { hiddenEventIds: new Set<string>() },
    threadSummaryTimeline: { hiddenEventIds: new Set<string>() },
    secretRequestTimeline: { hiddenEventIds: new Set<string>() },
  } as unknown as TimelineMessageData);

type Options = Parameters<typeof renderTimelineTiles>[0];

const items = (events: MatrixEvent[]): VirtualItem[] =>
  events.map((rowEvent, index) => ({
    index,
    key: rowEvent.getId() ?? index,
    start: index * 40,
    size: 40,
    end: index * 40 + 40,
    lane: 0,
  }));

/** What the list is given of a room's rows. */
const roomRows = (events: MatrixEvent[]) => ({
  virtualItems: items(events),
  roomWindowRows: events,
  roomRowEntries: events.map((rowEvent, absoluteIndex) => ({ event: rowEvent, absoluteIndex })),
});

/** A list of `events` whose rows show their ID and the body their event holds at that render. */
const mountList = (events: MatrixEvent[], overrides: Partial<Options> = {}) => {
  const renderEvent = vi.fn((row: TimelineMessageRow) => {
    return (
      <p data-row={row.eventId}>
        {[String(row.event.getContent().body), ...(row.quietRun ?? []).map((run) => run.eventId)]
          .concat(row.collapse ? 'collapsed' : [], row.highlighted ? 'highlighted' : [])
          .join(' ')}
      </p>
    );
  });
  const watchRowEvents = vi.fn();
  const quiet = new Set<string>();
  const options: Options = {
    ...roomRows(events),
    threadId: undefined,
    threadEvents: [],
    windowStart: 0,
    readUptoAbsoluteIndex: undefined,
    ignoredUsersSet: new Set(),
    showHiddenEvents: true,
    timelineSet: {} as EventTimelineSet,
    focusItem: undefined,
    messageData: plans(),
    isHiddenByPlugin: () => false,
    isHiddenByPluginId: () => false,
    renderEvent,
    watchRowEvents,
    rowSources: ['timeline', 0],
    isQuietMarkerRow: (rowEvent) => quiet.has(rowEvent.getId() ?? ''),
    joinsQuietMarkerRun: (rowEvent) => quiet.has(rowEvent.getId() ?? ''),
    unreadMarkerRef: () => undefined,
    measureElement: () => undefined,
    ledgerPxAtRender: 0,
    ...overrides,
  };
  const Host = ({ current }: { current: Options }) => <div>{renderTimelineTiles(current)}</div>;
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Host current={options} />);
  });
  return {
    quiet,
    renderEvent,
    watchRowEvents,
    /** The IDs of the rows a render of the list with `next` renders again, in order. */
    again: (next: Partial<Options> = {}) => {
      const before = renderEvent.mock.calls.length;
      Object.assign(options, next);
      act(() => renderer.update(<Host current={{ ...options }} />));
      return renderEvent.mock.calls.slice(before).map(([row]) => row.eventId);
    },
    shown: (id: string) =>
      renderer.root
        .findAll((node) => node.props['data-row'] === id)
        .map((node) => node.children.join(''))
        .join('|'),
    separators: (id: string) =>
      renderer.root
        .findAll((node) => node.type === 'div' && typeof node.props['data-index'] === 'number')
        .filter((tile) => tile.findAll((node) => node.props['data-row'] === id).length > 0)
        .flatMap((tile) => tile.findAll((node) => node.props.role === 'separator')).length,
  };
};

const three = () => [
  event('$a', START),
  event('$b', START + 60_000, '@noor:x'),
  event('$c', START + 120_000),
];

/** Changes what the event holds, as an edit or a send that completes does, in place. */
const rewrite = (target: MatrixEvent, body: string) => {
  target.event.content = { ...target.event.content, body };
};

describe('a render of the list', () => {
  it('renders no row again when nothing a row is given changed, and still watches every row', () => {
    const events = three();
    const list = mountList(events);
    expect(list.renderEvent).toHaveBeenCalledTimes(3);
    list.watchRowEvents.mockClear();

    // Rows move as rows above them are measured: the tiles take another place, the rows stay.
    const moved = items(events).map((item) => ({ ...item, start: item.start + 7 }));
    expect(list.again({ virtualItems: moved, ledgerPxAtRender: 12 })).toEqual([]);
    // Their events still repaint the list when they decrypt.
    expect(
      list.watchRowEvents.mock.calls.map(([row]) => (row as TimelineMessageRow).eventId)
    ).toEqual(['$a', '$b', '$c']);
  });

  it.each([
    ['the first source', { rowSources: ['timeline again', 0] }],
    ['a later source', { rowSources: ['timeline', 1] }],
    ['one source more', { rowSources: ['timeline', 0, 0] }],
    ['the shared message data', { messageData: plans() }],
    ['the timeline set the rows read edits from', { timelineSet: {} as EventTimelineSet }],
  ] as [string, Partial<Options>][])(
    'renders every row again, with what its event holds by then, when %s changed',
    (_name, next) => {
      const events = three();
      const list = mountList(events);
      rewrite(events[1]!, 'edited');
      expect(list.again()).toEqual([]);
      expect(list.again(next)).toEqual(['$a', '$b', '$c']);
      expect(list.shown('$b')).toBe('edited');
    }
  );

  it('renders every row again when the function that renders them is another', () => {
    const events = three();
    const list = mountList(events);
    const renderEvent = vi.fn((row: TimelineMessageRow) => <p data-row={row.eventId}>new</p>);
    list.again({ renderEvent });
    expect(renderEvent.mock.calls.map(([row]) => row.eventId)).toEqual(['$a', '$b', '$c']);
    expect(list.shown('$c')).toBe('new');
  });

  it('renders only the row whose event is another', () => {
    const events = three();
    const list = mountList(events);
    const replaced = [events[0]!, event('$b', START + 60_000, '@noor:x'), events[2]!];
    rewrite(replaced[1]!, 'echoed');
    expect(list.again(roomRows(replaced))).toEqual(['$b']);
    expect(list.shown('$b')).toBe('echoed');
  });

  it('renders the rows whose place in the list changed', () => {
    const events = three();
    const list = mountList(events);
    const older = [event('$older', START - 60_000, '@noor:x'), ...events];
    expect(list.again(roomRows(older))).toEqual(['$older', '$a', '$b', '$c']);
  });

  it('renders the row a jump highlights, and it alone', () => {
    const list = mountList(three());
    expect(
      list.again({ focusItem: { eventId: '$b', index: 1, scrollTo: false, highlight: true } })
    ).toEqual(['$b']);
    expect(list.shown('$b')).toBe('$b highlighted');
    expect(list.again({ focusItem: undefined })).toEqual(['$b']);
    expect(list.shown('$b')).toBe('$b');
  });

  it('renders the row that starts or stops grouping with the row above it', () => {
    const events = [event('$a', START), event('$b', START + 1_000), event('$c', START + 2_000)];
    const list = mountList(events);
    expect(list.shown('$b')).toBe('$b collapsed');
    // The fork's first own row starts its group.
    expect(list.again({ forkDivider: { index: 1, node: null } })).toEqual(['$b']);
    expect(list.shown('$b')).toBe('$b');
  });

  it('renders the row that no longer follows the message it answers', () => {
    const events = [
      event('$a', START),
      event('$b', START + 60_000, '@noor:x', '$a'),
      event('$c', START + 120_000),
    ];
    const list = mountList(events);
    const [first] = list.renderEvent.mock.calls.filter(([row]) => row.eventId === '$b');
    expect(first![0].previousEventId).toBe('$a');
    // The answered message is hidden: the answer quotes it again.
    expect(list.again({ ignoredUsersSet: new Set(['@maya:x']) })).toEqual(['$b']);
    expect(list.renderEvent.mock.lastCall![0].previousEventId).toBeUndefined();
  });

  it('renders the rows that gain or lose the unread line or a date', () => {
    const events = [
      event('$a', START),
      event('$b', START + 60_000, '@noor:x'),
      event('$c', START + DAY),
    ];
    const list = mountList(events, { readUptoAbsoluteIndex: 0 });
    expect(['$a', '$b', '$c'].map(list.separators)).toEqual([0, 1, 1]);
    expect(list.again({ readUptoAbsoluteIndex: 1 })).toEqual(['$b', '$c']);
    expect(['$a', '$b', '$c'].map(list.separators)).toEqual([0, 0, 2]);

    const sameDay = [events[0]!, events[1]!, event('$c', START + 120_000)];
    expect(list.again(roomRows(sameDay))).toEqual(['$c']);
    expect(list.separators('$c')).toBe(1);
  });

  it("renders the row a fork's line or a fork draft's line belongs to when the line is another", () => {
    const list = mountList(three());
    expect(list.again({ forkDivider: { index: 2, node: <hr data-line="fork" /> } })).toEqual([
      '$c',
    ]);
    expect(list.again({ forkDivider: { index: 2, node: <hr data-line="fork" /> } })).toEqual([
      '$c',
    ]);
    expect(list.again({ forkingDivider: { index: 0, node: <hr data-line="forking" /> } })).toEqual([
      '$a',
    ]);
  });

  it('renders the row of a run of quiet markers again when another marker joins it', () => {
    const events = three();
    const list = mountList(events, { threadId: '$a', threadEvents: events });
    list.quiet.add('$b');
    list.again({ rowSources: ['timeline', 1] });
    expect(list.again()).toEqual([]);
    list.quiet.add('$c');
    list.watchRowEvents.mockClear();
    // The fold reads which rows are markers on every render; the run's first row shows both.
    expect(list.again()).toEqual(['$b']);
    expect(list.shown('$b')).toBe('$b $c');
    expect(
      (list.watchRowEvents.mock.calls as [TimelineMessageRow][]).map(([row]) => [
        row.eventId,
        ...(row.quietRun ?? []).map((run) => run.eventId),
      ])
    ).toEqual([['$a'], ['$b', '$c']]);
    // The same run, of other event objects.
    const echoed = [events[0]!, events[1]!, event('$c', START + 120_000)];
    expect(list.again({ virtualItems: items(echoed), threadEvents: echoed })).toEqual(['$b']);
  });
});
