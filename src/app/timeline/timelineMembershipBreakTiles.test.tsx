// @vitest-environment jsdom
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { MatrixEvent, type EventTimelineSet } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderTimelineTiles, timelineRowSizing } from './roomTimelineRows';
import type { TimelineMessageData, TimelineMessageRow } from './message-rendering/types';
import {
  planMembershipFolds,
  resolveMembershipFoldAnchorIndex,
  viewMembershipFolds,
} from './membershipFolds';
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

const fold = planMembershipFolds(events, {
  isSkipped: () => false,
  pinnedIds: new Set(),
})[0]!;

const messageData = {
  approvalTimeline: { hiddenEventIds: new Set<string>() },
  threadSummaryTimeline: { hiddenEventIds: new Set<string>() },
  secretRequestTimeline: { hiddenEventIds: new Set<string>() },
  voiceTranscripts: NO_VOICE_TRANSCRIPTS,
  modelChanges: NO_MODEL_CHANGES,
} as unknown as TimelineMessageData;

describe('the tiles of a folded membership run', () => {
  const toggle = vi.fn();
  let renderer: ReturnType<typeof create> | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    toggle.mockClear();
  });

  const mounted = (
    open: boolean,
    sizes: number[],
    roomRows = events,
    options: { readUptoAbsoluteIndex?: number } = {}
  ) => {
    const folds = planMembershipFolds(roomRows, {
      isSkipped: () => false,
      pinnedIds: new Set(),
    });
    const visibleIds = new Set(roomRows.map((event) => event.getId()!));
    const membershipFolds = {
      view: viewMembershipFolds(folds, () => open, visibleIds),
      toggle,
    };
    const tiles = renderTimelineTiles({
      virtualItems: sizes.map((size, index) => ({
        index,
        key: roomRows[index]!.getId()!,
        start: index * 40,
        size,
        end: 0,
        lane: 0,
      })),
      threadId: undefined,
      threadEvents: [],
      roomWindowRows: roomRows,
      roomRowEntries: roomRows.map((event, absoluteIndex) => ({
        event,
        absoluteIndex,
      })),
      windowStart: 0,
      readUptoAbsoluteIndex: options.readUptoAbsoluteIndex,
      ignoredUsersSet: new Set(),
      showHiddenEvents: false,
      timelineSet: {} as EventTimelineSet,
      focusItem: undefined,
      messageData,
      isHiddenByPlugin: () => false,
      isHiddenByPluginId: () => false,
      renderEvent: ({ eventId }: TimelineMessageRow) => <p data-row="true">{eventId}</p>,
      isQuietMarkerRow: () => false,
      membershipFolds,
      unreadMarkerRef: () => undefined,
      measureElement: () => undefined,
      ledgerPxAtRender: 0,
    });
    act(() => {
      renderer = create(<div>{tiles}</div>);
    });
    const text = (node: ReactTestInstance | string): string =>
      typeof node === 'string' ? node : node.children.map(text).join('');
    return renderer!.root
      .findAll((node) => node.type === 'div' && typeof node.props['data-index'] === 'number')
      .map((tile) => [
        roomRows[tile.props['data-index'] as number]!.getId(),
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

  it('hides folded rows and intermediate day dividers while closed, placing a day divider on the next message', () => {
    expect(mounted(false, [60, 42, 0, 0, 60])).toEqual([
      ['$msg1', ['$msg1']],
      ['$m1', ['break']],
      ['$msg2', ['day', '$msg2']],
    ]);
  });

  it('toggles the membership fold on click', () => {
    mounted(false, [60, 42, 0, 0, 60]);
    const button = renderer!.root.findByType('button');
    act(() => {
      button.props.onClick();
    });
    expect(toggle).toHaveBeenCalledWith(fold);
  });

  it('restores all verbatim rows and intermediate day dividers when opened', () => {
    expect(mounted(true, [60, 84, 40, 60, 60])).toEqual([
      ['$msg1', ['$msg1']],
      ['$m1', ['break', 'day', '$m1']],
      ['$m2', ['$m2']],
      ['$m3', ['day', '$m3']],
      ['$msg2', ['$msg2']],
    ]);
  });

  it('places a day divider on the first message after a leading closed multi-day fold', () => {
    const leadingFoldRows = [
      joinEvent('$m1', '@ada:example.org', DAY_1),
      joinEvent('$m2', '@ben:example.org', DAY_1 + DAY_MS),
      joinEvent('$m3', '@cora:example.org', DAY_1 + 3 * DAY_MS),
      msgEvent('$msg', DAY_1 + 3 * DAY_MS + 60_000),
    ];
    expect(mounted(false, [42, 0, 0, 60], leadingFoldRows)).toEqual([
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
    expect(mounted(false, [60, 42, 0, 0], trailingUnread, { readUptoAbsoluteIndex: 0 })).toEqual([
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
    expect(mounted(false, [60, 42, 0, 0, 60], sameDayRows, { readUptoAbsoluteIndex: 1 })).toEqual([
      ['$msg1', ['$msg1']],
      ['$m1', ['unread', 'break']],
      ['$msg2', ['$msg2']],
    ]);
    expect(mounted(true, [60, 84, 40, 40, 60], sameDayRows, { readUptoAbsoluteIndex: 1 })).toEqual([
      ['$msg1', ['$msg1']],
      ['$m1', ['break', '$m1']],
      ['$m2', ['unread', '$m2']],
      ['$m3', ['$m3']],
      ['$msg2', ['$msg2']],
    ]);

    // Opening unread anchor at $m2 (index 2) resolves to the pill row $m1 (index 1) while closed.
    const sameDayFolds = planMembershipFolds(sameDayRows, {
      isSkipped: () => false,
      pinnedIds: new Set(),
    });
    const closedView = viewMembershipFolds(sameDayFolds, () => false);
    expect(resolveMembershipFoldAnchorIndex(sameDayRows, 2, closedView)).toBe(1);
  });
});

describe('timelineRowSizing with membership folds', () => {
  const estimates = (compactLayout: boolean, open: boolean) => {
    const view = viewMembershipFolds([fold], () => open);
    const { estimateSize } = timelineRowSizing({
      threadId: undefined,
      compactLayout,
      showThreadRepliesInRoom: false,
      threadEvents: [],
      roomWindowRows: events,
      windowStart: 0,
      roomRowsRef: { current: events },
      activeRangeRef: { current: { start: 0, end: events.length } },
      threadRecordMapRef: { current: new Map() },
      membershipFoldsRef: { current: view },
    });
    return events.map((_, index) => estimateSize(index));
  };

  it('prices hidden rows at 0, closed break rows at 42.5, and open break rows at normal + 42 in comfortable layout', () => {
    const plain = events.map(
      (row, index) => estimateRoomRowHeight(row, events[index - 1], { threadBadge: false }) + 0.5
    );
    expect(estimates(false, false)).toEqual([plain[0], 42.5, 0, 0, plain[4]]);
    expect(estimates(false, true)).toEqual([
      plain[0],
      plain[1]! + 42,
      plain[2],
      plain[3],
      plain[4],
    ]);
  });

  it('prices hidden rows at 0, closed break rows at 42.5, and open break rows at 96 + 42 in compact layout', () => {
    expect(estimates(true, false)).toEqual([96, 42.5, 0, 0, 96]);
    expect(estimates(true, true)).toEqual([96, 96 + 42, 96, 96, 96]);
  });

  it('prices prepended older members of a fold crossing current.start for pill transfer during back-pagination', () => {
    const longRun = [
      joinEvent('$m0', '@a:example.org', DAY_1),
      joinEvent('$m1', '@b:example.org', DAY_1 + 10_000),
      joinEvent('$m2', '@c:example.org', DAY_1 + 20_000),
      joinEvent('$m3', '@d:example.org', DAY_1 + 30_000),
      msgEvent('$msg', DAY_1 + 40_000),
    ];
    const longFold = planMembershipFolds(longRun, {
      isSkipped: () => false,
      pinnedIds: new Set(),
    })[0]!;
    // Current window starts mid-fold at index 2 ($m2), so $m2 currently draws the break pill.
    const currentStart = 2;
    const currentWindow = longRun.slice(currentStart);
    const currentVisibleIds = new Set(currentWindow.map((event) => event.getId()!));

    // Closed fold: back-paginating to nextWindowStart = 0 transfers the pill to $m0 (42.5) and prices $m1 at 0.
    const closedView = viewMembershipFolds([longFold], () => false, currentVisibleIds);
    const closedSizing = timelineRowSizing({
      threadId: undefined,
      compactLayout: false,
      showThreadRepliesInRoom: false,
      threadEvents: [],
      roomWindowRows: currentWindow,
      windowStart: currentStart,
      roomRowsRef: { current: longRun },
      activeRangeRef: { current: { start: currentStart, end: longRun.length } },
      threadRecordMapRef: { current: new Map() },
      membershipFoldsRef: { current: closedView },
    });
    expect(closedSizing.estimateSize(0 - currentStart, 0)).toBe(42.5);
    expect(closedSizing.estimateSize(1 - currentStart, 0)).toBe(0);
    // Back-paginating only to nextWindowStart = 1 transfers the pill to $m1 (42.5).
    expect(closedSizing.estimateSize(1 - currentStart, 1)).toBe(42.5);

    // Open fold: back-paginating to nextWindowStart = 0 prices $m0 at normal + 42 and $m1 at normal.
    const openView = viewMembershipFolds([longFold], () => true, currentVisibleIds);
    const openSizing = timelineRowSizing({
      threadId: undefined,
      compactLayout: false,
      showThreadRepliesInRoom: false,
      threadEvents: [],
      roomWindowRows: currentWindow,
      windowStart: currentStart,
      roomRowsRef: { current: longRun },
      activeRangeRef: { current: { start: currentStart, end: longRun.length } },
      threadRecordMapRef: { current: new Map() },
      membershipFoldsRef: { current: openView },
    });
    const m0Normal = estimateRoomRowHeight(longRun[0]!, undefined, { threadBadge: false }) + 0.5;
    const m1Normal = estimateRoomRowHeight(longRun[1]!, longRun[0], { threadBadge: false }) + 0.5;
    expect(openSizing.estimateSize(0 - currentStart, 0)).toBe(m0Normal + 42);
    expect(openSizing.estimateSize(1 - currentStart, 0)).toBe(m1Normal);
  });
});
