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

/** The message each drawn row needs no reply quote for (`previousEventId`), by its event. */
const quoteless = new Map<string, string | undefined>();

/** Draws every event it is given: the tiles ask it only about events with a row. */
const renderEvent = ({ eventId, previousEventId }: TimelineMessageRow) => {
  quoteless.set(eventId, previousEventId);
  return <p>{eventId}</p>;
};

const messageData = {
  approvalTimeline: { hiddenEventIds: new Set<string>() },
  threadSummaryTimeline: { hiddenEventIds: new Set<string>() },
} as unknown as TimelineMessageData;

/**
 * Each mounted tile's event and the dividers above its row: `unread`, or the date. The room's row
 * window starts at `windowStart`; `indexes` count from there.
 */
const mount = (
  events: MatrixEvent[],
  indexes: number[],
  readUptoAbsoluteIndex: number,
  windowStart = 0
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
    roomWindowRows: events.slice(windowStart),
    roomRowEntries: events.map((rowEvent, absoluteIndex) => ({ event: rowEvent, absoluteIndex })),
    windowStart,
    readUptoAbsoluteIndex,
    ignoredUsersSet: new Set(),
    showHiddenEvents: true,
    timelineSet: {} as EventTimelineSet,
    focusItem: undefined,
    messageData,
    isHiddenByPlugin: () => false,
    isHiddenByPluginId: () => false,
    renderEvent,
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
      return [
        events[windowStart + (tile.props['data-index'] as number)]!.getId(),
        separators.map((node) => (/new ?messages/i.test(text(node)) ? 'unread' : 'date')),
        tile.findAll((node) => node.type === 'p').length > 0,
      ];
    });
};

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
      // The room's row window starts right after the event without a row.
      expect(mount(events, [0], 0, 2)).toEqual([next]);
    }
  );
});

const replyTo = (id: string, target: string) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM,
    sender: '@maya:x',
    type: 'm.room.message',
    origin_server_ts: START + 60_000,
    content: {
      body: id,
      msgtype: 'm.text',
      'm.relates_to': { 'm.in_reply_to': { event_id: target } },
    },
  });

describe('a reply right below the start of the row window', () => {
  const question = event('$question', 'm.room.message', START);
  const hidden = event('$hidden', 'm.room.power_levels', START, '');

  it('needs no quote of the message above it', () => {
    quoteless.clear();
    mount([question, hidden, replyTo('$answer', '$question')], [0], 0, 2);
    expect(quoteless.get('$answer')).toBe('$question');
  });

  it('needs no quote of the message that the rows above it all answer', () => {
    quoteless.clear();
    const answers = [replyTo('$first', '$question'), replyTo('$second', '$question')];
    mount([question, answers[0]!, hidden, answers[1]!], [0], 0, 3);
    expect(quoteless.get('$second')).toBe('$question');
  });
});
