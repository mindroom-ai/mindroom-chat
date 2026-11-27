// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  EventStatus,
  EventType,
  MatrixEvent,
  RelationType,
  type EventTimelineSet,
  type Relations,
  type Room,
} from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderTimelineTiles } from './roomTimelineRows';
import type { TimelineMessageData, TimelineMessageRow } from './message-rendering/types';
import { NO_VOICE_TRANSCRIPTS } from '../messages/voiceTranscripts';
import { NO_MODEL_CHANGES } from '../messages/modelChanges';

const START = new Date(2026, 10, 3, 12, 0).getTime();
const THREAD_ID = '$root';

const makeMessage = (id: string, body: string, minute: number, sender = '@alice:x'): MatrixEvent =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:x',
    sender,
    type: EventType.RoomMessage,
    origin_server_ts: START + minute * 60_000,
    content: { body, msgtype: 'm.text' },
  });

const makeFreshMessageData = (handleOpenReply: TimelineMessageData['handleOpenReply']) =>
  ({
    threadRecordMap: new Map(),
    approvalTimeline: {
      hiddenEventIds: new Set<string>(),
      historyByResponseId: new Map(),
      fallbackGroupsByEventId: new Map(),
    },
    threadSummaryTimeline: {
      hiddenEventIds: new Set<string>(),
      markersByEventId: new Map(),
    },
    secretRequestTimeline: { hiddenEventIds: new Set<string>() },
    voiceTranscripts: {
      ...NO_VOICE_TRANSCRIPTS,
      byVoiceId: new Map(),
      pendingVoiceIds: new Set<string>(),
    },
    modelChanges: {
      ...NO_MODEL_CHANGES,
      byAckId: new Map(),
    },
    handleOpenReply,
  }) as unknown as TimelineMessageData;

describe('renderTimelineTiles row memoization', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('skips re-rendering unchanged sibling rows when one streaming reply receives an edit', () => {
    const root = makeMessage(THREAD_ID, 'question', 0);
    const earlier = makeMessage('$m1', 'earlier note', 1);
    const streaming = makeMessage('$stream', 'chunk 1', 2, '@mindroom_ops:x');
    const events = [root, earlier, streaming];

    const renderCounts = new Map<string, number>();
    const renderEvent = vi.fn((row: TimelineMessageRow) => {
      renderCounts.set(row.eventId, (renderCounts.get(row.eventId) ?? 0) + 1);
      const replacing = row.event.replacingEvent();
      const body =
        (replacing?.getContent()?.['m.new_content'] as { body?: string } | undefined)?.body ??
        (row.event.getContent().body as string);
      return <div data-row={row.eventId}>{body}</div>;
    });
    const retainRenderedRow = vi.fn();
    const handleOpenReply = vi.fn();
    const timelineSet = {} as EventTimelineSet;

    const renderList = () => (
      <>
        {renderTimelineTiles({
          virtualItems: events.map((_, index) => ({
            index,
            key: events[index]!.getId()!,
            start: index * 40,
            size: 40,
            end: (index + 1) * 40,
            lane: 0,
          })),
          threadId: THREAD_ID,
          threadEvents: events,
          ignoredUsersSet: new Set(),
          showHiddenEvents: true,
          timelineSet,
          focusItem: undefined,
          messageData: makeFreshMessageData(handleOpenReply),
          renderEvent,
          retainRenderedRow,
          isQuietMarkerRow: () => false,
          measureElement: () => undefined,
        })}
      </>
    );

    act(() => {
      renderer = create(renderList());
    });
    expect(renderCounts.get(THREAD_ID)).toBe(1);
    expect(renderCounts.get('$m1')).toBe(1);
    expect(renderCounts.get('$stream')).toBe(1);

    // Apply an m.replace streaming edit to only the last message.
    const edit = new MatrixEvent({
      event_id: '$edit1',
      room_id: '!room:x',
      sender: '@mindroom_ops:x',
      type: EventType.RoomMessage,
      origin_server_ts: START + 130_000,
      content: {
        body: '* chunk 2',
        msgtype: 'm.text',
        'm.new_content': { body: 'chunk 2', msgtype: 'm.text' },
        'm.relates_to': { rel_type: RelationType.Replace, event_id: '$stream' },
      },
    });
    streaming.makeReplaced(edit);
    retainRenderedRow.mockClear();

    act(() => {
      renderer!.update(renderList());
    });

    // Only the edited streaming row re-rendered; siblings stayed memoized.
    expect(renderCounts.get(THREAD_ID)).toBe(1);
    expect(renderCounts.get('$m1')).toBe(1);
    expect(renderCounts.get('$stream')).toBe(2);
    expect(JSON.stringify(renderer!.toJSON())).toContain('chunk 2');
    // Unchanged rows still report to retainRenderedRow so decryption subscriptions stay live.
    expect(retainRenderedRow).toHaveBeenCalledWith(THREAD_ID);
    expect(retainRenderedRow).toHaveBeenCalledWith('$m1');
    expect(retainRenderedRow).toHaveBeenCalledWith('$stream');
  });

  it('re-renders a sibling row on in-place status change, redaction, or new reaction', () => {
    const root = makeMessage(THREAD_ID, 'question', 0);
    const sibling = makeMessage('$m1', 'hello', 1);
    const events = [root, sibling];

    const renderCounts = new Map<string, number>();
    const renderEvent = vi.fn((row: TimelineMessageRow) => {
      renderCounts.set(row.eventId, (renderCounts.get(row.eventId) ?? 0) + 1);
      return (
        <div data-row={row.eventId}>
          {row.event.isRedacted() ? 'redacted' : String(row.event.status ?? 'ok')}
        </div>
      );
    });
    const handleOpenReply = vi.fn();

    let reactionList: MatrixEvent[] = [];
    const relations = {
      getRelations: () => reactionList,
    } as unknown as Relations;
    let hasReactions = false;
    const timelineSet = {
      relations: {
        getChildEventsForEvent: (eventId: string, relType: string, eventType: string) => {
          if (
            eventId === '$m1' &&
            relType === String(RelationType.Annotation) &&
            eventType === String(EventType.Reaction) &&
            hasReactions
          ) {
            return relations;
          }
          return undefined;
        },
      },
    } as unknown as EventTimelineSet;

    const renderList = () => (
      <>
        {renderTimelineTiles({
          virtualItems: events.map((_, index) => ({
            index,
            key: events[index]!.getId()!,
            start: index * 40,
            size: 40,
            end: (index + 1) * 40,
            lane: 0,
          })),
          threadId: THREAD_ID,
          threadEvents: events,
          ignoredUsersSet: new Set(),
          showHiddenEvents: true,
          timelineSet,
          focusItem: undefined,
          messageData: makeFreshMessageData(handleOpenReply),
          renderEvent,
          isQuietMarkerRow: () => false,
          measureElement: () => undefined,
        })}
      </>
    );

    act(() => {
      renderer = create(renderList());
    });
    expect(renderCounts.get(THREAD_ID)).toBe(1);
    expect(renderCounts.get('$m1')).toBe(1);

    // 1. In-place send status change.
    sibling.setStatus(EventStatus.NOT_SENT);
    act(() => {
      renderer!.update(renderList());
    });
    expect(renderCounts.get(THREAD_ID)).toBe(1);
    expect(renderCounts.get('$m1')).toBe(2);

    // 2. First reaction attached in timelineSet.relations.
    hasReactions = true;
    reactionList = [makeMessage('$rx1', '👍', 2)];
    act(() => {
      renderer!.update(renderList());
    });
    expect(renderCounts.get(THREAD_ID)).toBe(1);
    expect(renderCounts.get('$m1')).toBe(3);

    // 3. In-place redaction.
    sibling.makeRedacted(
      new MatrixEvent({
        event_id: '$redact1',
        room_id: '!room:x',
        sender: '@alice:x',
        type: EventType.RoomRedaction,
        redacts: '$m1',
        origin_server_ts: START + 180_000,
        content: {},
      }),
      {} as Room
    );
    act(() => {
      renderer!.update(renderList());
    });
    expect(renderCounts.get(THREAD_ID)).toBe(1);
    expect(renderCounts.get('$m1')).toBe(4);
    expect(JSON.stringify(renderer!.toJSON())).toContain('redacted');
  });
});
