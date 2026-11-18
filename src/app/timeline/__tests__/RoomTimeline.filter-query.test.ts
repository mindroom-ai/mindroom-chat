import type { ThreadWorkflowTab } from '../../event-store/threads/threadWorkflow';
import React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  selectThreadWorkflowTab,
  createDefaultThreadFilterState,
} from '../../event-store/threads/roomThreadOverviewModel';
import { MINDROOM_SCHEDULED_TASK_EVENT } from '../../matrix/protocol/scheduledTaskContract';
import {
  applyParsedThreadFilterQuery,
  parseThreadFilterQuery,
  serializeThreadFilterQuery,
} from '../../event-store/threads/threadFilterDsl';
import {
  create,
  flushAsyncWork,
  getRenderedEventIds,
  makeEvent,
  makeRoom,
  roomThreadOverviewType,
  stateEventsByTypeMock,
  threadStreamingStateMock,
  wrapWithSyncEngine,
} from '../test-utils/RoomTimeline.test.shared';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

const { scheduledEventsByType } = vi.hoisted(() => ({
  scheduledEventsByType: new Map<string, unknown[]>(),
}));

vi.mock('../../matrix/hooks/useStateEvents', () => ({
  useStateEvents: (_room: unknown, eventType: string) => scheduledEventsByType.get(eventType) ?? [],
}));
// The shared harness mocks Matrix ID parsing, so the hook's sender check cannot run here.
vi.mock('../../schedules/useScheduledTaskEvents', () => ({
  useScheduledTaskEvents: () => scheduledEventsByType.get('com.mindroom.scheduled.task') ?? [],
}));
vi.mock('../../event-store/threads/useThreadLastActivityTs', () => ({
  getThreadLastActivityTs: () => 0,
}));

const makeThreadRoom = () => {
  const streaming = makeEvent('$streaming-root', { isThreadRoot: true, ts: 1 });
  const scheduled = makeEvent('$scheduled-root', { isThreadRoot: true, ts: 2 });
  const plain = makeEvent('$plain-root', { isThreadRoot: true, ts: 3 });
  threadStreamingStateMock.set(streaming.getId(), true);
  scheduledEventsByType.set(MINDROOM_SCHEDULED_TASK_EVENT, [
    makeEvent('$scheduled-task', {
      type: MINDROOM_SCHEDULED_TASK_EVENT,
      stateKey: 'task-1',
      content: {
        status: 'pending',
        thread_id: scheduled.getId(),
        new_thread: false,
        execute_at: '2999-01-01T00:00:00Z',
      },
    }),
  ]);
  stateEventsByTypeMock.set(
    MINDROOM_SCHEDULED_TASK_EVENT,
    scheduledEventsByType.get(MINDROOM_SCHEDULED_TASK_EVENT)!
  );
  const room = makeRoom({
    liveEvents: [streaming, scheduled, plain],
    threads: [
      { id: streaming.getId(), rootEvent: streaming },
      { id: scheduled.getId(), rootEvent: scheduled },
      { id: plain.getId(), rootEvent: plain },
    ],
  });
  (
    room.getUnfilteredTimelineSet() as ReturnType<typeof room.getUnfilteredTimelineSet> & {
      relations?: unknown;
    }
  ).relations = { getChildEventsForEvent: () => undefined };
  return {
    room,
    streamingId: streaming.getId(),
    scheduledId: scheduled.getId(),
    plainId: plain.getId(),
  };
};

const setup = async () => {
  const { RoomTimeline } = await import('../RoomTimeline');
  const Harness = ({ room }: { room: ReturnType<typeof makeRoom> }) => {
    const [threadFilterState, setThreadFilterState] = React.useState(
      createDefaultThreadFilterState()
    );
    return wrapWithSyncEngine(
      React.createElement(RoomTimeline as never, {
        room,
        summaryMap: new Map(),
        onStoreThreadSummary: vi.fn(),
        threadFilterState,
        threadSortFreezeState: null,
        setThreadSortFreezeState: vi.fn(),
        onSortDirectionChange: vi.fn(),
        onToggleThreadSortFreeze: vi.fn(),
        onAddTag: vi.fn(),
        onRemoveTag: vi.fn(),
        onReset: vi.fn(),
        onSelectTab: (tab: ThreadWorkflowTab) =>
          setThreadFilterState((prev) => selectThreadWorkflowTab(prev, tab)),
        onSearchQueryChange: (searchQuery: string) =>
          setThreadFilterState((prev) =>
            applyParsedThreadFilterQuery(prev, parseThreadFilterQuery(searchQuery))
          ),
        viewMode: 'threaded',
        editor: {} as never,
      })
    );
  };
  const roomState = makeThreadRoom();
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(React.createElement(Harness, { room: roomState.room }));
    await flushAsyncWork();
  });
  const overview = () => renderer.root.findByType(roomThreadOverviewType).props;
  const type = async (query: string) =>
    act(async () => {
      overview().onSearchQueryChange(query);
      await flushAsyncWork();
    });
  const selectTab = async (tab: ThreadWorkflowTab) =>
    act(async () => {
      overview().onSelectTab(tab);
      await flushAsyncWork();
    });
  const settle = async () =>
    act(async () => {
      vi.advanceTimersByTime(300);
      await flushAsyncWork(2);
    });
  return { ...roomState, renderer: renderer!, overview, type, selectTab, settle };
};

importBeforeTests(() => import('../RoomTimeline'));

describe('RoomTimeline filter query wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    scheduledEventsByType.clear();
    threadStreamingStateMock.clear();
    stateEventsByTypeMock.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies structured DSL filters immediately without a second parse pass', async () => {
    const { overview, renderer, streamingId, scheduledId, plainId, type, settle } = await setup();
    await type('is:streaming OR is:scheduled');
    expect(serializeThreadFilterQuery(overview().state)).toBe('is:streaming OR is:scheduled');
    expect(overview().state).toMatchObject({
      streaming: 'include',
      scheduled: 'include',
      statusMode: 'or',
    });
    expect(overview().threadCount).toBe(2);
    await settle();
    expect(overview().threadCount).toBe(2);
    expect(getRenderedEventIds(renderer)).toEqual([scheduledId, streamingId]);
    expect(getRenderedEventIds(renderer)).not.toContain(plainId);
  });

  it('replaces parsed legacy status restrictions when selecting a workflow tab', async () => {
    const { overview, type, selectTab, settle, streamingId, scheduledId, renderer } = await setup();
    await type('is:streaming OR is:scheduled');
    await selectTab('working');
    expect(overview().state).toMatchObject({
      tab: 'working',
      streaming: 'any',
      scheduled: 'any',
      statusMode: 'and',
    });
    await settle();
    expect(getRenderedEventIds(renderer)).toEqual([streamingId]);
    expect(getRenderedEventIds(renderer)).not.toContain(scheduledId);
  });

  it('clearing the bar clears parsed status and tag chip state immediately', async () => {
    const { overview, type, settle } = await setup();
    await type('is:streaming OR is:scheduled tag:bug');
    expect(overview().state).toMatchObject({
      streaming: 'include',
      scheduled: 'include',
      statusMode: 'or',
    });
    expect(serializeThreadFilterQuery(overview().state)).toBe(
      'is:streaming OR is:scheduled tag:bug'
    );
    expect([...overview().state.tags]).toEqual([['bug', 'include']]);

    await type('');
    expect(overview().state).toMatchObject({
      streaming: 'any',
      scheduled: 'any',
      statusMode: 'and',
    });
    expect(serializeThreadFilterQuery(overview().state)).toBe('');
    expect([...overview().state.tags]).toEqual([]);

    await settle();
    expect(overview().threadCount).toBe(3);
  });

  it('preserves parsed tag tokens when the Working tab is selected', async () => {
    const { overview, selectTab, type } = await setup();
    await type('tag:bug');
    await selectTab('working');
    expect(overview().state).toMatchObject({
      tab: 'working',
      streaming: 'any',
      scheduled: 'any',
      statusMode: 'and',
    });
    expect(serializeThreadFilterQuery(overview().state)).toBe('tag:bug');
    expect([...overview().state.tags]).toEqual([['bug', 'include']]);
  });

  it('preserves unsupported OR text without silently turning it into active chips', async () => {
    const { overview, type, settle } = await setup();
    await type('tag:a OR tag:b');
    expect(serializeThreadFilterQuery(overview().state)).toBe('tag:a OR tag:b');
    expect(overview().state).toMatchObject({
      statusMode: 'and',
      streaming: 'any',
      scheduled: 'any',
    });
    await settle();
    expect(overview().threadCount).toBe(3);
  });
});
