// @vitest-environment jsdom
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { MatrixEvent, type EventTimelineSet } from 'matrix-js-sdk';
import type { VirtualItem } from '@tanstack/react-virtual';
import { describe, expect, it, vi } from 'vitest';
import { renderTimelineTiles, timelineRowSizing } from './roomTimelineRows';
import type { TimelineMessageData, TimelineMessageRow } from './message-rendering/types';
import { viewThreadTurnFolds, type ThreadTurnFold } from './threadTurnFolds';
import { estimateMessageRowHeight } from './timelineRowEstimate';
import { NO_VOICE_TRANSCRIPTS } from '../messages/voiceTranscripts';

vi.mock('./TurnBreak.css', () => ({
  TurnBreak: 'TurnBreak',
  Line: 'Line',
  Pill: 'Pill',
  Dots: 'Dots',
}));

// A folded turn's rows mount no tile once sized as nothing; its first row draws the break, alone
// while the turn is folded and above its own row while it is open.

const START = new Date(2026, 10, 3, 12, 0).getTime();
const ROOT = '$q';

const event = (id: string, minute: number): MatrixEvent =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:x',
    sender: id === ROOT ? '@sam:x' : '@mindroom_ops:x',
    type: 'm.room.message',
    origin_server_ts: START + minute * 60_000,
    content: { body: id, msgtype: 'm.text' },
  });

const events = [event(ROOT, 0), event('$a1', 1), event('$a2', 2), event('$a3', 3)];
const fold: ThreadTurnFold = { key: ROOT, hiddenIds: ['$a1', '$a2'], count: 2 };

const messageData = {
  approvalTimeline: { hiddenEventIds: new Set<string>() },
  threadSummaryTimeline: { hiddenEventIds: new Set<string>() },
  secretRequestTimeline: {
    hiddenEventIds: new Set<string>(),
    byReply: new Map(),
    waitingReplyIds: new Set<string>(),
  },
  voiceTranscripts: NO_VOICE_TRANSCRIPTS,
} as unknown as TimelineMessageData;

/** Each mounted tile's event and what it shows in order: its break (`break`) and its row. */
const toggle = vi.fn();
let renderer: ReturnType<typeof create> | undefined;

const mounted = (open: boolean, sizes: number[], threadEvents = events) => {
  const turnFolds = { view: viewThreadTurnFolds([fold], () => open), toggle };
  const tiles = renderTimelineTiles({
    virtualItems: sizes.map(
      (size, index) =>
        ({ index, key: index, start: index * 40, size, end: 0, lane: 0 } as VirtualItem)
    ),
    threadId: ROOT,
    threadEvents,
    roomWindowRows: [],
    roomRowEntries: [],
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
    turnFolds,
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
      threadEvents[tile.props['data-index'] as number]!.getId(),
      tile
        .findAll(
          (node) =>
            node.props['data-row'] === 'true' ||
            node.props['data-turn-break'] ||
            node.props.role === 'separator'
        )
        .map((node) =>
          node.props['data-turn-break'] ? 'break' : node.props.role ? 'day' : text(node)
        ),
    ]);
};

describe('the tiles of a folded turn', () => {
  it('mount only the break on the first hidden row while it is folded', () => {
    expect(mounted(false, [40, 42, 0, 40])).toEqual([
      [ROOT, [ROOT]],
      ['$a1', ['break']],
      ['$a3', ['$a3']],
    ]);
  });

  it("toggle the break's turn on a click", () => {
    mounted(false, [40, 42, 0, 40]);
    const button = renderer!.root.findByType('button');
    act(() => {
      button.props.onClick();
    });
    expect(toggle).toHaveBeenCalledWith(fold);
  });

  it('mount the break even while its row is sized as nothing', () => {
    expect(mounted(false, [40, 0, 0, 40]).map(([id]) => id)).toEqual([ROOT, '$a1', '$a3']);
  });

  it('put the date divider above the answer of a folded turn that crosses midnight', () => {
    const late = [event(ROOT, 0), event('$a1', 1), event('$a2', 2), event('$a3', 24 * 60)];
    expect(mounted(false, [40, 42, 0, 40], late)).toEqual([
      [ROOT, [ROOT]],
      ['$a1', ['break']],
      ['$a3', ['day', '$a3']],
    ]);
  });

  it('mount a hidden row until it is sized as nothing', () => {
    expect(mounted(false, [40, 42, 40, 40]).map(([id]) => id)).toEqual([ROOT, '$a1', '$a2', '$a3']);
  });

  it('show the break above the first row once open', () => {
    expect(mounted(true, [40, 80, 40, 40])).toEqual([
      [ROOT, [ROOT]],
      ['$a1', ['break', '$a1']],
      ['$a2', ['$a2']],
      ['$a3', ['$a3']],
    ]);
  });
});

describe('the estimates of a folded turn', () => {
  const estimates = (open: boolean) => {
    const { estimateSize } = timelineRowSizing({
      threadId: ROOT,
      compactLayout: false,
      showThreadRepliesInRoom: false,
      threadEvents: events,
      roomWindowRows: [],
      windowStart: 0,
      roomRowsRef: { current: [] },
      activeRangeRef: { current: { start: 0, end: 0 } },
      threadRecordMapRef: { current: new Map() },
      turnFolds: viewThreadTurnFolds([fold], () => open),
    });
    return events.map((_, index) => estimateSize(index));
  };

  it('price the break alone while folded and above its row once open', () => {
    const plain = events.map((row) => estimateMessageRowHeight(row, { compact: false }));
    const [root, first, second, answer] = plain;
    expect(estimates(false)).toEqual([root, 42, second, answer]);
    expect(estimates(true)).toEqual([root, first! + 42, second, answer]);
  });
});
