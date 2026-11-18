// @vitest-environment jsdom
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { MatrixEvent, type EventTimelineSet } from 'matrix-js-sdk';
import type { VirtualItem } from '@tanstack/react-virtual';
import { describe, expect, it } from 'vitest';
import { renderTimelineTiles } from './roomTimelineRows';
import type { TimelineMessageData, TimelineMessageRow } from './message-rendering/types';

// A row whose render gives nothing (an event of a type the timeline draws no row for, kept in the
// list by the developer setting `showHiddenEvents`, or one that decrypted to such a type) takes no
// day or unread divider: the next row with output shows them, wherever the mounted window starts.

const DAY = 24 * 60 * 60_000;
const START = new Date(2026, 10, 3, 12, 0).getTime();
const ROOM = '!room:x';

const event = (id: string, type: string, ts: number, stateKey?: string) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM,
    sender: '@maya:x',
    type,
    origin_server_ts: ts,
    content: { body: id, msgtype: 'm.text' },
    ...(stateKey === undefined ? {} : { state_key: stateKey }),
  });

/** Draws every event it is given, and the quiet markers its row shows beside it, joined by '+'. */
const renderEvent = ({ eventId, quietRun }: TimelineMessageRow) => (
  <p data-row="true">{[eventId, ...(quietRun ?? []).map((marker) => marker.eventId)].join('+')}</p>
);

const messageData = {
  approvalTimeline: { hiddenEventIds: new Set<string>() },
  threadSummaryTimeline: { hiddenEventIds: new Set<string>() },
  secretRequestTimeline: {
    hiddenEventIds: new Set<string>(),
    byReply: new Map(),
    waitingReplyIds: new Set<string>(),
  },
} as unknown as TimelineMessageData;

/** Each mounted tile's event and the dividers above its row: `unread`, or the date. */
const tileRows = (
  events: MatrixEvent[],
  indexes: number[],
  readUptoAbsoluteIndex: number,
  quiet: ReadonlySet<string> = new Set()
) => {
  const tiles = renderTimelineTiles({
    virtualItems: indexes.map(
      (index) =>
        ({
          index,
          key: index,
          start: index * 40,
          size: 40,
          end: index * 40 + 40,
          lane: 0,
        } as VirtualItem)
    ),
    threadId: undefined,
    threadEvents: [],
    roomWindowRows: events,
    roomRowEntries: events.map((rowEvent, absoluteIndex) => ({ event: rowEvent, absoluteIndex })),
    windowStart: 0,
    readUptoAbsoluteIndex,
    ignoredUsersSet: new Set(),
    showHiddenEvents: true,
    timelineSet: {} as EventTimelineSet,
    focusItem: undefined,
    messageData,
    isHiddenByPlugin: () => false,
    isHiddenByPluginId: () => false,
    renderEvent,
    isQuietMarkerRow: (rowEvent) => quiet.has(rowEvent.getId() ?? ''),
    unreadMarkerRef: () => undefined,
    measureElement: () => undefined,
    ledgerPxAtRender: 0,
  });
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(<div>{tiles}</div>);
  });
  const text = (node: ReactTestInstance | string): string =>
    typeof node === 'string' ? node : node.children.map(text).join('');
  return renderer!.root
    .findAll((node) => node.type === 'div' && typeof node.props['data-index'] === 'number')
    .map((tile) => {
      const separators = tile.findAll((node) => node.props.role === 'separator');
      return {
        id: events[tile.props['data-index'] as number]!.getId(),
        separators: separators.map((node) =>
          /new ?messages/i.test(text(node)) ? 'unread' : 'date'
        ),
        shown: tile.findAll((node) => node.props['data-row'] === 'true').map(text),
      };
    });
};

const mount = (events: MatrixEvent[], indexes: number[], readUptoAbsoluteIndex: number) =>
  tileRows(events, indexes, readUptoAbsoluteIndex).map(({ id, separators, shown }) => [
    id,
    separators,
    shown.length > 0,
  ]);

describe('the dividers above a row that renders nothing', () => {
  const rowless = [
    ['an unknown state event', 'm.room.power_levels', ''],
    ['an event of an unknown type', 'org.example.poll', undefined],
  ] as const;

  it.each(rowless)(
    'go to the next row with output past %s, wherever the window starts',
    (_name, type, stateKey) => {
      const events = [
        event('$read', 'm.room.message', START),
        event('$hidden', type, START + DAY, stateKey),
        event('$next', 'm.room.message', START + DAY + 60_000),
      ];
      const next = ['$next', ['unread', 'date'], true];
      expect(mount(events, [0, 1, 2], 0)).toEqual([
        ['$read', [], true],
        ['$hidden', [], false],
        next,
      ]);
      expect(mount(events, [1, 2], 0)).toEqual([['$hidden', [], false], next]);
      expect(mount(events, [2], 0)).toEqual([next]);
    }
  );
});

describe('the dividers above a run of quiet markers', () => {
  const quiet = new Set(['$title', '$review']);
  const events = [
    event('$read', 'm.room.message', START),
    event('$title', 'm.room.message', START + DAY),
    event('$review', 'm.room.message', START + DAY + 60_000),
  ];

  it('show once, above the row that shows the run, wherever the window starts', () => {
    const run = { id: '$title', separators: ['unread', 'date'], shown: ['$title+$review'] };
    const folded = { id: '$review', separators: [], shown: [] };
    expect(tileRows(events, [0, 1, 2], 0, quiet)).toEqual([
      { id: '$read', separators: [], shown: ['$read'] },
      run,
      folded,
    ]);
    expect(tileRows(events, [1, 2], 0, quiet)).toEqual([run, folded]);
    expect(tileRows(events, [1], 0, quiet)).toEqual([run]);
  });
});
