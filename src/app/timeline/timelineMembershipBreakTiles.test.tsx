// @vitest-environment jsdom
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { cleanup, render } from '@testing-library/react';
import { MatrixEvent, type EventTimelineSet } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderTimelineTiles, timelineRowSizing } from './roomTimelineRows';
import type { TimelineMessageData, TimelineMessageRow } from './message-rendering/types';
import {
  planMembershipFolds,
  projectRoomRows,
  rowIndexOfLoaded,
  rowRangeOfLoaded,
  viewMembershipFolds,
  type MembershipFold,
} from './membershipFolds';
import type { TimelineRange } from '../event-store/timeline/timelinePagination';
import { estimateRoomRowHeight } from './timelineRowEstimate';
import { NO_VOICE_TRANSCRIPTS } from '../messages/voiceTranscripts';
import { NO_MODEL_CHANGES } from '../messages/modelChanges';

vi.mock('./TurnBreak.css', () => ({
  TurnBreak: 'TurnBreak',
  MembershipBreak: 'MembershipBreak',
  Line: 'Line',
  Pill: 'Pill',
  MembershipPill: 'MembershipPill',
  PillLabel: 'PillLabel',
  Chevron: 'Chevron',
  Dots: 'Dots',
}));

const DAY_1 = new Date(2026, 10, 3, 12, 0).getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

const msgEvent = (id: string, ts: number): MatrixEvent =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:example.org',
    sender: '@sam:example.org',
    type: 'm.room.message',
    origin_server_ts: ts,
    content: { body: id, msgtype: 'm.text' },
  });

const joinEvent = (id: string, user: string, ts: number): MatrixEvent =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:example.org',
    sender: user,
    state_key: user,
    type: 'm.room.member',
    origin_server_ts: ts,
    content: { membership: 'join', displayname: user },
  });

const events = [
  msgEvent('$msg1', DAY_1),
  joinEvent('$m1', '@ada:example.org', DAY_1 + DAY_MS),
  joinEvent('$m2', '@ben:example.org', DAY_1 + DAY_MS + 60_000),
  joinEvent('$m3', '@cora:example.org', DAY_1 + 2 * DAY_MS),
  msgEvent('$msg2', DAY_1 + 2 * DAY_MS + 60_000),
];

const messageData = {
  approvalTimeline: { hiddenEventIds: new Set<string>() },
  threadSummaryTimeline: { hiddenEventIds: new Set<string>() },
  secretRequestTimeline: { hiddenEventIds: new Set<string>() },
  voiceTranscripts: NO_VOICE_TRANSCRIPTS,
  modelChanges: NO_MODEL_CHANGES,
} as unknown as TimelineMessageData;

type TileOptions = {
  open?: boolean;
  /** The window the timeline's state counts, in loaded rows; all of them when left out. */
  stateRange?: TimelineRange;
  /** The read marker's place in the loaded timeline, where each loaded row is at its index. */
  readUptoAbsoluteIndex?: number;
  toggle?: (fold: MembershipFold) => void;
};

/**
 * The tiles of the room's window as the timeline renders them: the loaded rows are folded and
 * listed with each closed fold as one row, the state's window is taken in those rows, and every
 * row of it is a mounted item.
 */
const windowTiles = (
  loaded: MatrixEvent[],
  { open = false, stateRange, readUptoAbsoluteIndex, toggle = () => undefined }: TileOptions = {}
) => {
  const view = viewMembershipFolds(
    planMembershipFolds(loaded, { isSkipped: () => false, pinnedIds: new Set() }),
    () => open
  );
  const projection = projectRoomRows(
    loaded,
    loaded.map((event, absoluteIndex) => ({ event, absoluteIndex })),
    view
  );
  const range = rowRangeOfLoaded(projection, stateRange ?? { start: 0, end: loaded.length });
  const roomWindowRows = projection.rows.slice(range.start, range.end);
  const tiles = renderTimelineTiles({
    virtualItems: roomWindowRows.map((event, index) => ({
      index,
      key: event.getId()!,
      start: index * 40,
      size: 40,
      end: 0,
      lane: 0,
    })),
    threadId: undefined,
    threadEvents: [],
    roomWindowRows,
    roomRowEntries: projection.entries,
    windowStart: range.start,
    readUptoAbsoluteIndex,
    ignoredUsersSet: new Set(),
    showHiddenEvents: false,
    timelineSet: {} as EventTimelineSet,
    focusItem: undefined,
    messageData,
    isHiddenByPlugin: () => false,
    isHiddenByPluginId: () => false,
    renderEvent: ({ eventId }: TimelineMessageRow) => <p data-row="true">{eventId}</p>,
    isQuietMarkerRow: () => false,
    membershipFolds: { view, toggle },
    unreadMarkerRef: () => undefined,
    measureElement: () => undefined,
    ledgerPxAtRender: 0,
  });
  return { tiles, roomWindowRows, projection, range, view };
};

describe('the tiles of a folded membership run', () => {
  let renderer: ReturnType<typeof create> | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    cleanup();
  });

  /** Each tile of the window: its row's event, and what it draws from top to bottom. */
  const mounted = (loaded: MatrixEvent[] = events, options: TileOptions = {}) => {
    const { tiles, roomWindowRows } = windowTiles(loaded, options);
    act(() => {
      renderer = create(<div>{tiles}</div>);
    });
    const text = (node: ReactTestInstance | string): string =>
      typeof node === 'string' ? node : node.children.map(text).join('');
    return renderer!.root
      .findAll((node) => node.type === 'div' && typeof node.props['data-index'] === 'number')
      .map((tile) => [
        roomWindowRows[tile.props['data-index'] as number]!.getId(),
        tile
          .findAll(
            (node) =>
              node.props['data-row'] === 'true' ||
              node.props['data-membership-break'] ||
              node.props.role === 'separator'
          )
          .map((node) => {
            if (node.props['data-membership-break']) return 'break';
            if (node.props.role) {
              return text(node).includes('New Messages') ? 'unread' : 'day';
            }
            return text(node);
          }),
      ]);
  };

  it('draws a closed fold as one row with its break, and the changed day above the next message', () => {
    expect(mounted()).toEqual([
      ['$msg1', ['$msg1']],
      ['$m1', ['break']],
      ['$msg2', ['day', '$msg2']],
    ]);
  });

  it('gives every row of the window an element the paginator finds, a closed fold of 35 too', () => {
    const run = Array.from({ length: 35 }, (_, index) =>
      joinEvent(`$j${index}`, `@guest${index}:example.org`, DAY_1 + index * 1000)
    );
    const loaded = [msgEvent('$first', DAY_1 - 1000), ...run, msgEvent('$last', DAY_1 + 60_000)];
    const { tiles, roomWindowRows } = windowTiles(loaded);
    // Three rows, none of them hidden: the fold takes one place in the list and its overscan.
    expect(roomWindowRows.map((event) => event.getId())).toEqual(['$first', '$j0', '$last']);
    const { container } = render(<div>{tiles}</div>);
    const rows = [...container.querySelectorAll('[data-room-row-index]')];
    expect(rows.map((row) => row.getAttribute('data-room-row-index'))).toEqual(['0', '1', '2']);
    expect(rows[1]?.querySelector('[data-membership-break] button')?.textContent).toContain(
      '35 joined'
    );
  });

  it('toggles the membership fold on click', () => {
    const toggle = vi.fn();
    const { view } = windowTiles(events);
    mounted(events, { toggle });
    const button = renderer!.root.findByType('button');
    act(() => {
      button.props.onClick();
    });
    expect(toggle).toHaveBeenCalledWith(view.breaks.get('$m1')?.fold);
  });

  it('restores all verbatim rows and intermediate day dividers when opened', () => {
    expect(mounted(events, { open: true })).toEqual([
      ['$msg1', ['$msg1']],
      ['$m1', ['break', 'day', '$m1']],
      ['$m2', ['$m2']],
      ['$m3', ['day', '$m3']],
      ['$msg2', ['$msg2']],
    ]);
  });

  it("keeps the break's button, and the focus on it, when the fold opens and closes", () => {
    const { container, rerender } = render(<div>{windowTiles(events).tiles}</div>);
    const button = container.querySelector<HTMLButtonElement>('[data-membership-break] button')!;
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');

    // Open: the fold's first row keeps the tile, with the break above the row.
    rerender(<div>{windowTiles(events, { open: true }).tiles}</div>);
    expect(container.querySelector('[data-membership-break] button')).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.textContent).toContain('Hide 3 room events');
    expect(container.querySelectorAll('[data-row="true"]')).toHaveLength(5);

    rerender(<div>{windowTiles(events).tiles}</div>);
    expect(container.querySelector('[data-membership-break] button')).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(container.querySelectorAll('[data-row="true"]')).toHaveLength(2);
  });

  it("keeps the rows after a fold near the window's end in the window when it opens and closes", () => {
    // The newest rows: a message, a run of four and two messages. The state's window does not
    // change with the fold.
    const loaded = [
      msgEvent('$msg1', DAY_1),
      joinEvent('$m1', '@ada:example.org', DAY_1 + 1000),
      joinEvent('$m2', '@ben:example.org', DAY_1 + 2000),
      joinEvent('$m3', '@cora:example.org', DAY_1 + 3000),
      joinEvent('$m4', '@dan:example.org', DAY_1 + 4000),
      msgEvent('$msg2', DAY_1 + 5000),
      msgEvent('$msg3', DAY_1 + 6000),
    ];
    const stateRange = { start: 0, end: loaded.length };
    expect(mounted(loaded, { stateRange }).map(([id]) => id)).toEqual([
      '$msg1',
      '$m1',
      '$msg2',
      '$msg3',
    ]);
    expect(mounted(loaded, { stateRange, open: true }).map(([id]) => id)).toEqual([
      '$msg1',
      '$m1',
      '$m2',
      '$m3',
      '$m4',
      '$msg2',
      '$msg3',
    ]);
    expect(mounted(loaded, { stateRange }).map(([id]) => id)).toEqual([
      '$msg1',
      '$m1',
      '$msg2',
      '$msg3',
    ]);
  });

  it('places a day divider on the first message after a leading closed multi-day fold', () => {
    const leadingFoldRows = [
      joinEvent('$m1', '@ada:example.org', DAY_1),
      joinEvent('$m2', '@ben:example.org', DAY_1 + DAY_MS),
      joinEvent('$m3', '@cora:example.org', DAY_1 + 3 * DAY_MS),
      msgEvent('$msg', DAY_1 + 3 * DAY_MS + 60_000),
    ];
    expect(mounted(leadingFoldRows)).toEqual([
      ['$m1', ['break']],
      ['$msg', ['day', '$msg']],
    ]);
  });

  it('renders the unread divider above a trailing closed fold of unread joins', () => {
    const trailingUnread = [
      msgEvent('$msg1', DAY_1),
      joinEvent('$m1', '@ada:example.org', DAY_1 + 60_000),
      joinEvent('$m2', '@ben:example.org', DAY_1 + 120_000),
      joinEvent('$m3', '@cora:example.org', DAY_1 + 180_000),
    ];
    expect(mounted(trailingUnread, { readUptoAbsoluteIndex: 0 })).toEqual([
      ['$msg1', ['$msg1']],
      ['$m1', ['unread', 'break']],
    ]);
  });

  it('renders one unread divider above a closed unread fold without duplicating it on the next message, and moves it to the first unread join when opened', () => {
    const sameDayRows = [
      msgEvent('$msg1', DAY_1),
      joinEvent('$m1', '@ada:example.org', DAY_1 + 60_000),
      joinEvent('$m2', '@ben:example.org', DAY_1 + 120_000),
      joinEvent('$m3', '@cora:example.org', DAY_1 + 180_000),
      msgEvent('$msg2', DAY_1 + 240_000),
    ];
    // $msg1 (0) and $m1 (1) are read; $m2 (2) is the first unread event.
    expect(mounted(sameDayRows, { readUptoAbsoluteIndex: 1 })).toEqual([
      ['$msg1', ['$msg1']],
      ['$m1', ['unread', 'break']],
      ['$msg2', ['$msg2']],
    ]);
    expect(mounted(sameDayRows, { open: true, readUptoAbsoluteIndex: 1 })).toEqual([
      ['$msg1', ['$msg1']],
      ['$m1', ['break', '$m1']],
      ['$m2', ['unread', '$m2']],
      ['$m3', ['$m3']],
      ['$msg2', ['$msg2']],
    ]);
    // A fold read to its last event has no divider: it goes above the next row.
    expect(mounted(sameDayRows, { readUptoAbsoluteIndex: 3 })).toEqual([
      ['$msg1', ['$msg1']],
      ['$m1', ['break']],
      ['$msg2', ['unread', '$msg2']],
    ]);

    // The opening scroll goes to the read marker's row: closed, the fold's row.
    const { projection } = windowTiles(sameDayRows);
    expect(rowIndexOfLoaded(projection, 1)).toBe(1);
    expect(rowIndexOfLoaded(projection, 2)).toBe(1);
  });
});

describe('a window that the state starts at or after a closed fold', () => {
  let renderer: ReturnType<typeof create> | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  const drawn = (loaded: MatrixEvent[], options: TileOptions) => {
    const { tiles, roomWindowRows, range } = windowTiles(loaded, options);
    act(() => {
      renderer = create(<div>{tiles}</div>);
    });
    const text = (node: ReactTestInstance | string): string =>
      typeof node === 'string' ? node : node.children.map(text).join('');
    const rows = renderer!.root
      .findAll((node) => node.type === 'div' && typeof node.props['data-index'] === 'number')
      .map((tile) => [
        roomWindowRows[tile.props['data-index'] as number]!.getId(),
        tile
          .findAll(
            (node) =>
              node.props['data-row'] === 'true' ||
              node.props['data-membership-break'] ||
              node.props.role === 'separator'
          )
          .map((node) => {
            if (node.props['data-membership-break']) return 'break';
            if (node.props.role) {
              return text(node).includes('New Messages') ? 'unread' : text(node);
            }
            return text(node);
          }),
      ]);
    return { rows, range };
  };

  // Monday's `$m1`, which the reader has read, then Tuesday's `$m2` to `$m4` and a message.
  const MONDAY = new Date(2026, 10, 2, 12, 0).getTime();
  const TUESDAY = MONDAY + DAY_MS;
  const loaded = [
    joinEvent('$m1', '@ada:example.org', MONDAY),
    joinEvent('$m2', '@ben:example.org', TUESDAY),
    joinEvent('$m3', '@cora:example.org', TUESDAY + 60_000),
    joinEvent('$m4', '@dan:example.org', TUESDAY + 120_000),
    msgEvent('$msg', TUESDAY + 180_000),
  ];

  it('shows the fold whole when the state starts inside it: its unread divider, and the day above the next row', () => {
    // A page of history brought `$m1` and `$m2`: the state's window starts at `$m3`.
    const { rows, range } = drawn(loaded, {
      stateRange: { start: 2, end: 5 },
      readUptoAbsoluteIndex: 0,
    });
    expect(range).toEqual({ start: 0, end: 2 });
    // The break is the run's first row, read from Monday's `$m1`: Tuesday's divider is above the
    // message, and the unread divider above the fold, whose `$m2` is the first unread event.
    expect(rows).toEqual([
      ['$m1', ['unread', 'break']],
      ['$msg', [expect.stringMatching(/\S/), '$msg']],
    ]);
    expect(rows[1]?.[1]?.[0]).not.toBe('unread');
  });

  it('draws no second unread divider on the first row of a window that starts right after the fold', () => {
    // The fold is the row before the window: it holds the first unread event, so the divider is
    // its own, above the window.
    const after = drawn(loaded, { stateRange: { start: 4, end: 5 }, readUptoAbsoluteIndex: 0 });
    expect(after.range).toEqual({ start: 1, end: 2 });
    expect(after.rows).toEqual([['$msg', ['$msg']]]);
    // Read to the fold's last event, the message is the first unread row.
    const read = drawn(loaded, { stateRange: { start: 4, end: 5 }, readUptoAbsoluteIndex: 3 });
    expect(read.rows).toEqual([['$msg', ['unread', '$msg']]]);
  });
});

describe('timelineRowSizing with membership folds', () => {
  const fold = planMembershipFolds(events, { isSkipped: () => false, pinnedIds: new Set() })[0]!;
  const sizing = (compactLayout: boolean, open: boolean, held = new Map<string, number>()) => {
    const view = viewMembershipFolds([fold], () => open);
    const { rows } = projectRoomRows(
      events,
      events.map((event, absoluteIndex) => ({ event, absoluteIndex })),
      view
    );
    const { estimateSize, getItemKey } = timelineRowSizing({
      threadId: undefined,
      compactLayout,
      showThreadRepliesInRoom: false,
      threadEvents: [],
      roomWindowRows: rows,
      windowStart: 0,
      roomRowsRef: { current: rows },
      activeRangeRef: { current: { start: 0, end: rows.length } },
      threadRecordMapRef: { current: new Map() },
      membershipFoldsRef: { current: view },
      foldedRowSizesRef: { current: held },
    });
    return {
      rows,
      estimates: rows.map((_, index) => estimateSize(index)),
      keys: rows.map((_, index) => getItemKey(index)),
    };
  };

  it("prices a closed fold as its break alone and an open fold's first row with its break", () => {
    const closed = sizing(false, false);
    const plain = (rows: MatrixEvent[]) =>
      rows.map(
        (row, index) => estimateRoomRowHeight(row, rows[index - 1], { threadBadge: false }) + 0.5
      );
    // No row of the list is priced at nothing.
    expect(closed.estimates).toEqual([plain(closed.rows)[0], 42.5, plain(closed.rows)[2]]);
    const open = sizing(false, true);
    const openPlain = plain(open.rows);
    expect(open.estimates).toEqual([
      openPlain[0],
      openPlain[1]! + 42,
      openPlain[2],
      openPlain[3],
      openPlain[4],
    ]);
    // The fold's row keeps its key, the tile and the focus of its break, open or closed.
    expect(closed.keys[1]).toBe('$m1');
    expect(open.keys[1]).toBe('$m1');
  });

  it('prices them in the Compact layout', () => {
    expect(sizing(true, false).estimates).toEqual([96, 42.5, 96]);
    expect(sizing(true, true).estimates).toEqual([96, 96 + 42, 96, 96, 96]);
  });

  it('starts a fold at the height of the rows of the last render that it holds', () => {
    // `$m2` and `$m3` were rows of their own, 31 px each, before history brought `$m1`.
    const held = new Map([
      ['$m2', 31],
      ['$m3', 31],
    ]);
    expect(sizing(false, false, held).estimates[1]).toBe(62);
    // Open, the rows are their own again.
    expect(sizing(false, true, held).estimates[1]).toBe(sizing(false, true).estimates[1]);
  });
});
