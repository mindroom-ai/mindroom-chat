// @vitest-environment jsdom
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { MatrixEvent, type EventTimelineSet } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderTimelineTiles, timelineRowSizing } from './roomTimelineRows';
import type { TimelineMessageData, TimelineMessageRow } from './message-rendering/types';
import { planMembershipFolds, viewMembershipFolds } from './membershipFolds';
import { estimateRoomRowHeight } from './timelineRowEstimate';
import { NO_VOICE_TRANSCRIPTS } from '../messages/voiceTranscripts';
import { NO_MODEL_CHANGES } from '../messages/modelChanges';

vi.mock('./TurnBreak.css', () => ({
  TurnBreak: 'TurnBreak',
  Line: 'Line',
  Pill: 'Pill',
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

  const mounted = (open: boolean, sizes: number[], roomRows = events) => {
    const visibleIds = new Set(roomRows.map((event) => event.getId()!));
    const membershipFolds = {
      view: viewMembershipFolds([fold], () => open, visibleIds),
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
      readUptoAbsoluteIndex: undefined,
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
          .map((node) =>
            node.props['data-membership-break'] ? 'break' : node.props.role ? 'day' : text(node)
          ),
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
});
