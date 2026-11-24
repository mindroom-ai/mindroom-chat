import { createRef } from 'react';
import {
  EventStatus,
  MatrixEvent,
  MatrixEventEvent,
  type Room,
  type EventTimelineSet,
} from 'matrix-js-sdk';
import { createEditor } from 'slate';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  create,
  makeEvent,
  makeRoom,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  matrixClientMock,
  mentionClickMock,
  navigateRoomMock,
  navigateRoomThreadMock,
  openUserRoomProfileMock,
  settingsState,
  threadRenderStateMock,
} from '../test-utils/RoomTimeline.test.shared';
import { MessageLayout } from '../../preferences/settings';
import { MessageEvent } from '../../matrix/types/room';
import { RenderMessageContent } from '../../messages/content/RenderMessageContent';
import { MINDROOM_TOOL_APPROVAL_EVENT } from '../../matrix/protocol/toolApproval';
import type { TimelineMessageRow } from './types';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';
import { RoomSettingsPage } from '../../navigation/roomSettingsState';
import { NO_VOICE_TRANSCRIPTS } from '../../messages/voiceTranscripts';
import { NO_MODEL_CHANGES } from '../../messages/modelChanges';
import { ROOM_THREAD_MODE_EVENT } from '../../matrix/protocol/roomThreadMode';

const startFork = vi.hoisted(() => vi.fn());
vi.mock('../../threads/fork/useStartThreadFork', () => ({ useStartThreadFork: () => startFork }));

const forksByPoint = vi.hoisted(() => ({
  value: new Map<string, Array<{ threadId: string; ts: number }>>(),
  asked: [] as Array<[string | undefined, string | undefined]>,
}));
vi.mock('../../threads/fork/useThreadForks', () => ({
  useThreadForks: (room: { roomId: string }, threadId: string | undefined) => {
    forksByPoint.asked.push([room.roomId, threadId]);
    return threadId ? forksByPoint.value : new Map();
  },
}));
vi.mock('../../threads/fork/ThreadForksChip', async () => {
  const ReactImport = await import('react');
  return {
    ThreadForksChip: (props: Record<string, unknown>) =>
      ReactImport.createElement('forks-chip', props),
  };
});
/** The forks chip of each row, by event ID: the chips the rows hand their message as reactions. */
const forkChips = async (renderer: ReturnType<typeof create>) => {
  const { Message } = await import('../../messages/Message');
  const { ThreadForksChip } = await import('../../threads/fork/ThreadForksChip');
  return renderer.root.findAllByType(Message).flatMap(({ props }) => {
    const chips = (props.reactions?.props.children as unknown[] | undefined)?.filter(
      (child): child is { type: unknown; props: Record<string, unknown> } =>
        typeof child === 'object' &&
        child !== null &&
        (child as { type?: unknown }).type === ThreadForksChip
    );
    return (chips ?? []).map((chip) => ({
      eventId: props.mEvent.getId() as string,
      props: chip.props,
    }));
  });
};

const openRoomSettings = vi.hoisted(() => vi.fn());
// Its own test draws it; here only which row shows it counts.
vi.mock('../../messages/ModelChangeMarker', () => ({ ModelChangeMarker: () => null }));
vi.mock('../../messages/TriggerWakeMarker', () => ({ TriggerWakeMarker: () => null }));
vi.mock('../../navigation/useRoomSettingsState', () => ({
  useOpenRoomSettings: () => openRoomSettings,
}));

vi.mock('../../messages/thread-summary/ThreadSummaryMarker', async () => {
  const ReactImport = await import('react');
  return {
    ThreadSummaryMarker: (props: Record<string, unknown>) =>
      ReactImport.createElement('summary-marker', props),
  };
});

const summaryEvent = (id: string) =>
  makeEvent(id, {
    threadRootId: '$thread',
    content: {
      msgtype: 'm.notice',
      body: 'Fixing token refresh',
      'io.mindroom.thread_summary': {
        version: 1,
        summary: 'Fixing token refresh',
        message_count: 21,
      },
    },
  }) as unknown as MatrixEvent;
const snoozeEndedEvent = (id: string, sender: string) =>
  makeEvent(id, {
    sender,
    threadRootId: '$thread',
    content: {
      msgtype: 'm.text',
      body: '\u23f0 Snooze ended: check CI',
      'io.mindroom.thread_snooze': { event: 'ended', until: '2026-11-13T09:00:00Z' },
    },
  }) as unknown as MatrixEvent;
const skillReviewEvent = (id: string, sender: string) =>
  makeEvent(id, {
    sender,
    threadRootId: '$thread',
    content: {
      msgtype: 'm.notice',
      body: '\u{1f4be} Skill review: updated `developing-mindroom-chat`',
      'io.mindroom.skill_review': { changes: { 'developing-mindroom-chat': 'updated' } },
    },
  }) as unknown as MatrixEvent;
const COMPACTION_SENT = 1_794_940_102_256;
const compactionNoticeEvent = (id: string, sender: string) =>
  makeEvent(id, {
    sender,
    ts: COMPACTION_SENT,
    threadRootId: '$thread',
    content: {
      msgtype: 'm.notice',
      body: '\u{1f4e6} Compacted 24 runs: 366,804 \u2192 6,336 / 351,792 history budget',
      'io.mindroom.compaction': {
        version: 3,
        mode: 'manual',
        status: 'success',
        before_tokens: 366_804,
        after_tokens: 6336,
        history_budget_tokens: 351_792,
      },
    },
  }) as unknown as MatrixEvent;
const encryptedEvent = (id: string) =>
  new MatrixEvent({
    event_id: id,
    type: MessageEvent.RoomMessageEncrypted,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    content: {},
  });
const summaryMarkers = (renderer: ReturnType<typeof create>) =>
  renderer.root.findAll((node) => (node.type as unknown) === 'summary-marker');
const renderedContent = (renderer: ReturnType<typeof create>) =>
  renderer.root.findAll(
    (node) => node.type === RenderMessageContent && typeof node.props.msgType === 'string'
  );

const rowFor = (event: MatrixEvent, index = 0, previousEventId?: string): TimelineMessageRow => ({
  eventId: event.getId()!,
  event,
  index,
  previousEventId,
  timelineSet: {} as EventTimelineSet,
  collapse: false,
  highlighted: true,
});

const mountFeature = async (
  rows: TimelineMessageRow[],
  threadId?: string,
  forkPrefixEventIds?: ReadonlySet<string>,
  options?: { room?: Room; forkTargetRoom?: Room }
) => {
  const { useTimelineMessageFeature } = await import('./useTimelineMessageFeature');
  const room = options?.room ?? (makeRoom({ liveEvents: [] }) as unknown as Room);
  const editor = createEditor();
  const scrollRef = createRef<HTMLDivElement>();
  let feature!: ReturnType<typeof useTimelineMessageFeature>;
  const data = {
    threadRecordMap: new Map(),
    handleOpenReply: vi.fn(),
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
    voiceTranscripts: NO_VOICE_TRANSCRIPTS,
    modelChanges: NO_MODEL_CHANGES,
    forkPrefixEventIds,
  };
  const Harness = () => {
    feature = useTimelineMessageFeature({
      room,
      forkTargetRoom: options?.forkTargetRoom,
      editor,
      threadId,
      scrollRef,
      showThreadRepliesInRoom: false,
      messageLayout: MessageLayout.Compact,
      messageSpacing: '400',
      hideActivity: false,
    });
    return feature.wrapExpansion(<>{rows.map((row) => feature.renderEvent(row, data))}</>);
  };
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Harness />);
  });
  return {
    renderer,
    feature: () => feature,
    room: () => room,
    data,
    update: () => act(() => renderer.update(<Harness />)),
  };
};

importBeforeTests(() => import('../RoomTimeline'));

describe('timeline message feature', () => {
  it('shares framing while retaining message, approval and sticker edit/reply policy', async () => {
    const events = [
      MessageEvent.RoomMessage,
      MINDROOM_TOOL_APPROVAL_EVENT,
      MessageEvent.Sticker,
    ].map((type, index) => {
      const event = makeEvent(`$${index}`, { type }) as unknown as MatrixEvent;
      Object.defineProperty(event, 'replyEventId', { value: '$target' });
      return event;
    });
    const { renderer, data, update } = await mountFeature(
      events.map((event, index) => rowFor(event, index))
    );
    events.forEach((event) =>
      data.threadRecordMap.set(event.getId()!, {
        roomId: '!room:example.org',
        threadRootId: event.getId(),
        status: { isKnownThreadRoot: true, replyCount: 1, isResolved: false },
        presentation: { replyParticipantIds: [] },
      })
    );
    update();
    const messages = events.map((event) =>
      renderer.root.findByProps({ 'data-message-id': event.getId() })
    );
    expect(messages.map((message) => !!message.props.onEditId)).toEqual([true, false, false]);
    expect(messages.map((message) => !!message.props.reply)).toEqual([true, true, false]);
    expect(messages.map((message) => !!message.props.reactions)).toEqual([true, true, false]);
    expect(messages.map((message) => message.props.highlight)).toEqual([true, true, true]);
    await act(() => messages[0]!.props.onEditId('$0'));
    expect(renderer.root.findByProps({ 'data-message-id': '$0' }).props.edit).toBe(true);
    expect(messages[1]!.props.edit).toBeUndefined();
    expect(messages[2]!.props.edit).toBeUndefined();
  });

  it('gives message content its event ID so tool calls can find their approval cards', async () => {
    const event = makeEvent('$reply', { type: MessageEvent.RoomMessage }) as unknown as MatrixEvent;
    const { renderer } = await mountFeature([rowFor(event)]);
    expect(renderedContent(renderer).map((node) => node.props.eventId)).toContain('$reply');
  });

  it('captures each predecessor before adjacent reply elements render', async () => {
    const events = ['$first', '$second', '$fallback'].map(
      (id) => new MatrixEvent({ event_id: id, type: MessageEvent.RoomMessage, content: {} })
    );
    Object.defineProperty(events[0], 'replyEventId', { value: '$older' });
    Object.defineProperty(events[1], 'replyEventId', { value: '$first' });
    Object.defineProperty(events[2], 'replyEventId', { value: '$older' });
    events[2]!.getWireContent = () => ({
      'm.relates_to': { rel_type: 'm.thread', is_falling_back: true },
    });
    let previousEventId = '$older';
    const rows = events.map((event, index) => {
      const row = rowFor(event, index, previousEventId);
      previousEventId = event.getId()!;
      return row;
    });
    const { renderer } = await mountFeature(rows, '$root');
    expect(
      events.map(
        (event) => !!renderer.root.findByProps({ 'data-message-id': event.getId() }).props.reply
      )
    ).toEqual([false, false, false]);
  });

  it('returns state and unsupported-event null results synchronously', async () => {
    const { feature, data } = await mountFeature([]);
    const event = makeEvent('$state', {
      type: 'example.hidden',
      stateKey: '',
    }) as unknown as MatrixEvent;
    expect(feature().renderEvent(rowFor(event), data)).toBeNull();
    const unknown = makeEvent('$unknown', { type: 'example.unknown' }) as unknown as MatrixEvent;
    expect(feature().renderEvent(rowFor(unknown), data)).toBeNull();
  });

  it('preserves known-state precedence and the row highlight', async () => {
    const event = makeEvent('$name', {
      type: 'm.room.name',
      stateKey: '',
    }) as unknown as MatrixEvent;
    const { renderer } = await mountFeature([rowFor(event)]);
    expect(renderer.root.findByProps({ 'data-message-id': '$name' }).props.highlight).toBe(true);
  });

  it('keeps predecessor capture in the real timeline render batch', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const ControlledTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const root = makeEvent('$root');
    const first = makeEvent('$first', { threadRootId: '$root' });
    const second = makeEvent('$second', { threadRootId: '$root' });
    const fallback = makeEvent('$fallback', { threadRootId: '$root' });
    const replies = [first, second, fallback];
    replies.forEach((event, index) => {
      Object.defineProperty(event, 'replyEventId', { value: index === 1 ? '$first' : '$older' });
      Object.assign(event, {
        getWireContent: () => ({
          'm.relates_to': {
            rel_type: 'm.thread',
            event_id: '$root',
            is_falling_back: index === 2,
          },
        }),
      });
    });
    threadRenderStateMock.threadEvents = [root, ...replies];
    const room = makeRoom({ liveEvents: [root] });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<ControlledTimeline room={room} threadId="$root" />);
      await flushAsyncWork(1);
    });
    expect(
      replies.map(
        (event) => !!renderer.root.findByProps({ 'data-message-id': event.getId() }).props.reply
      )
    ).toEqual([true, false, false]);
  });

  it("gives a thread the usual fold baseline, whatever the room's expand-all", async () => {
    const baseline = (renderer: ReturnType<typeof create>) =>
      renderer.root.findAll((node) => node.props.expandAllInit !== undefined)[0]?.props
        .expandAllInit;
    const inRoom = await mountFeature([]);
    act(() => inRoom.feature().toggleExpandAll());
    expect(baseline(inRoom.renderer)).toBe(true);

    // A thread has no toggle to fold them again.
    const inThread = await mountFeature([], '$root');
    act(() => inThread.feature().toggleExpandAll());
    expect(inThread.feature().expandAll).toBe(true);
    expect(baseline(inThread.renderer)).toBe(false);
  });

  it('consumes live expansion candidates through the rendered collapse control', async () => {
    const event = makeEvent('$live') as unknown as MatrixEvent;
    const { feature, renderer, update } = await mountFeature([rowFor(event)]);
    feature().markLiveExpansionCandidate('$live');
    update();
    const expanded = renderer.root.find((node) => node.props.expansionKey === '$live');
    expect(expanded.props.collapseMode).toBe('initially-expanded');
    await act(() => expanded.props.onInitialExpandConsumed());
    update();
    expect(
      renderer.root.find((node) => node.props.expansionKey === '$live').props.collapseMode
    ).toBe('default');
  });

  it('places approval history once for message, approval fallback and decrypted approval rows', async () => {
    const { ApprovalHistory } = await import('../../approvals/ThreadApprovalControls');
    const message = makeEvent('$message') as unknown as MatrixEvent;
    const approval = makeEvent('$approval', {
      type: MINDROOM_TOOL_APPROVAL_EVENT,
    }) as unknown as MatrixEvent;
    const encrypted = new MatrixEvent({
      event_id: '$encrypted-approval',
      type: MessageEvent.RoomMessageEncrypted,
      content: {},
    });
    const events = [message, approval, encrypted];
    const { renderer, data, update } = await mountFeature(
      events.map((event, index) => rowFor(event, index))
    );
    data.approvalTimeline.historyByResponseId.set('$message', [{ eventId: '$history-message' }]);
    data.approvalTimeline.fallbackGroupsByEventId.set('$approval', [
      { eventId: '$history-approval' },
    ]);
    data.approvalTimeline.fallbackGroupsByEventId.set('$encrypted-approval', [
      { eventId: '$history-encrypted' },
    ]);
    update();
    await act(async () => {
      await encrypted.attemptDecryption({
        decryptEvent: async () => ({
          clearEvent: {
            type: MINDROOM_TOOL_APPROVAL_EVENT,
            content: { approval_id: 'approval-1' },
          },
        }),
      } as unknown as Parameters<MatrixEvent['attemptDecryption']>[0]);
    });
    expect(
      renderer.root
        .findAllByType(ApprovalHistory)
        .flatMap((node) => node.props.records.map((record: { eventId: string }) => record.eventId))
    ).toEqual(['$history-message', '$history-approval', '$history-encrypted']);
  });

  it('renders newly decrypted content and cleans up subscriptions on replacement and unmount', async () => {
    const event = encryptedEvent('$encrypted');
    const rows = [rowFor(event)];
    const { renderer, update } = await mountFeature(rows);
    expect(event.listenerCount(MatrixEventEvent.Decrypted)).toBe(1);
    await act(async () => {
      await event.attemptDecryption({
        decryptEvent: async () => ({
          clearEvent: {
            type: MessageEvent.RoomMessage,
            content: { body: 'Now decrypted', msgtype: 'm.text' },
          },
        }),
      } as unknown as Parameters<MatrixEvent['attemptDecryption']>[0]);
    });
    const content = renderer.root.findAll((node) => typeof node.props.getContent === 'function');
    expect(
      content.some(
        (node) =>
          node.props.eventType === MessageEvent.RoomMessage && node.props.msgType === 'm.text'
      )
    ).toBe(true);
    expect(content[0]!.props.getContent()).toEqual({ body: 'Now decrypted', msgtype: 'm.text' });
    const replacement = new MatrixEvent({
      event_id: '$encrypted',
      type: MessageEvent.RoomMessageEncrypted,
      content: {},
    });
    rows[0] = rowFor(replacement);
    update();
    expect(event.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
    expect(replacement.listenerCount(MatrixEventEvent.Decrypted)).toBe(1);
    act(() => renderer.unmount());
    expect(replacement.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
  });

  it("listens for the decryption of a row's pending edits, and of those of the quiet markers beside it, until it unmounts", async () => {
    const withPendingEdit = (event: MatrixEvent, edit: MatrixEvent) =>
      Object.assign(event, { __pendingEdits: [edit] });
    const messageEdit = encryptedEvent('$message-edit');
    const summaryEdit = encryptedEvent('$summary-edit');
    const laterSummaryEdit = encryptedEvent('$later-summary-edit');
    const message = withPendingEdit(
      makeEvent('$message', { threadRootId: '$thread' }) as unknown as MatrixEvent,
      messageEdit
    );
    const summary = withPendingEdit(summaryEvent('$summary'), summaryEdit);
    const laterSummary = withPendingEdit(summaryEvent('$later-summary'), laterSummaryEdit);
    const rows = [rowFor(message), { ...rowFor(summary, 1), quietRun: [rowFor(laterSummary, 2)] }];
    const { renderer, data, update } = await mountFeature(rows, '$thread');
    ['$summary', '$later-summary'].forEach((id) =>
      data.threadSummaryTimeline.markersByEventId.set(id, { first: false })
    );
    update();
    // Both summaries show as markers on one row.
    expect(summaryMarkers(renderer)).toHaveLength(2);
    const watched = () =>
      [messageEdit, summaryEdit, laterSummaryEdit].map((edit) =>
        edit.listenerCount(MatrixEventEvent.Decrypted)
      );
    expect(watched()).toEqual([1, 1, 1]);
    act(() => renderer.unmount());
    expect(watched()).toEqual([0, 0, 0]);
  });

  it('leaves the failed root of an open thread to the thread footer', async () => {
    const { FailedSendActions } = await import('../../messages/FailedSendActions');
    const [root, reply] = ['~root', '~reply'].map((id) => {
      const event = makeEvent(id, { content: { body: id } }) as unknown as MatrixEvent;
      event.status = EventStatus.NOT_SENT;
      return event;
    });
    const { renderer } = await mountFeature([rowFor(root!), rowFor(reply!, 1, '~root')], '~root');

    expect(renderer.root.findAllByType(FailedSendActions).map((node) => node.props.event)).toEqual([
      reply,
    ]);
  });

  it('resolves edits on mutable events again when the feature rerenders', async () => {
    const event = makeEvent('$mutable', {
      content: { body: 'First', msgtype: 'm.text' },
    }) as unknown as MatrixEvent;
    const { renderer, update } = await mountFeature([rowFor(event)]);
    event.getContent = (() => ({
      body: 'Stream update',
      msgtype: 'm.text',
    })) as MatrixEvent['getContent'];
    update();
    const message = renderer.root.findByProps({ 'data-message-id': '$mutable' });
    expect(message.props.resolvedMessageContent.body).toBe('Stream update');
    expect(
      renderer.root.findAll((node) => node.props.getContent?.().body === 'Stream update').length
    ).toBeGreaterThan(0);
  });

  it("gives an agent reply's header when it started and when its stream finished", async () => {
    const reply = makeEvent('$reply', {
      sender: '@mindroom_code:example.org',
      ts: 1_000,
      content: { msgtype: 'm.text', body: '…', 'io.mindroom.stream_status': 'pending' },
    }) as unknown as MatrixEvent;
    const finished = makeEvent('$finished', {
      sender: '@mindroom_code:example.org',
      ts: 2_000,
      content: { msgtype: 'm.text', body: 'Hi', 'io.mindroom.stream_status': 'pending' },
    }) as unknown as MatrixEvent;
    Object.assign(finished, {
      __editedEvent: makeEvent('$finish', {
        sender: '@mindroom_code:example.org',
        ts: 434_000,
        content: {
          'm.new_content': { msgtype: 'm.text', body: 'Done', 'io.mindroom.stream_status': 'done' },
        },
      }),
    });
    const person = makeEvent('$person', { ts: 3_000 }) as unknown as MatrixEvent;
    // A person's messages that carry stream statuses, active and finished by an edit, are not
    // agent replies.
    const personStreaming = makeEvent('$person-streaming', {
      ts: 4_000,
      content: { msgtype: 'm.text', body: '…', 'io.mindroom.stream_status': 'streaming' },
    }) as unknown as MatrixEvent;
    const personFinished = makeEvent('$person-finished', {
      ts: 5_000,
      content: { msgtype: 'm.text', body: 'Hi', 'io.mindroom.stream_status': 'pending' },
    }) as unknown as MatrixEvent;
    Object.assign(personFinished, {
      __editedEvent: makeEvent('$person-finish', {
        ts: 9_000,
        content: {
          'm.new_content': { msgtype: 'm.text', body: 'Done', 'io.mindroom.stream_status': 'done' },
        },
      }),
    });
    const { renderer } = await mountFeature([
      rowFor(reply),
      rowFor(finished, 1),
      rowFor(person, 2),
      rowFor(personStreaming, 3),
      rowFor(personFinished, 4),
    ]);

    const timingOf = (eventId: string) =>
      renderer.root.findByProps({ 'data-message-id': eventId }).props.replyTiming;
    expect(timingOf('$reply')).toEqual({ startTs: 1_000, streaming: true, revisionTs: 1_000 });
    expect(timingOf('$finished')).toEqual({ startTs: 2_000, endTs: 434_000, streaming: false });
    expect(timingOf('$person')).toBeUndefined();
    expect(timingOf('$person-streaming')).toBeUndefined();
    expect(timingOf('$person-finished')).toBeUndefined();
  });

  it('shrinks a summary in an open thread to a marker carrying its plan', async () => {
    const event = summaryEvent('$summary');
    const { renderer, data, update, room } = await mountFeature([rowFor(event)], '$thread');
    data.threadSummaryTimeline.markersByEventId.set('$summary', {
      first: false,
      previousSummaryText: 'Push bug',
    });
    update();

    const [marker] = summaryMarkers(renderer);
    expect(marker!.props.summaryInfo.summaryText).toBe('Fixing token refresh');
    expect(marker!.props.plan).toEqual({ first: false, previousSummaryText: 'Push bug' });
    expect(renderedContent(renderer)).toHaveLength(0);

    // Its settings button opens the room's settings on the MindRoom page.
    (marker!.props.onOpenSettings as () => void)();
    expect(openRoomSettings).toHaveBeenCalledWith(room().roomId, RoomSettingsPage.MindroomPage);
  });

  it("shows an agent's snooze-ended message in an open thread as a marker row", async () => {
    const { Message } = await import('../../messages/Message');
    const { SnoozeEndedMarker } = await import('../../messages/SnoozeEndedMarker');
    const event = snoozeEndedEvent('$wake', '@mindroom_router:example.org');
    const { renderer } = await mountFeature([rowFor(event)], '$thread');

    const marker = renderer.root.findByType(SnoozeEndedMarker);
    expect(marker.props.note).toBe('check CI');
    // No message chrome: no avatar, sender name or toolbar.
    expect(renderer.root.findAllByType(Message)).toHaveLength(0);
    expect(renderedContent(renderer)).toHaveLength(0);
  });

  it("keeps a person's message with the snooze-ended key as a normal message", async () => {
    const { Message } = await import('../../messages/Message');
    const { SnoozeEndedMarker } = await import('../../messages/SnoozeEndedMarker');
    const event = snoozeEndedEvent('$fake', '@bob:example.org');
    const { renderer } = await mountFeature([rowFor(event)], '$thread');

    expect(renderer.root.findAllByType(Message)).toHaveLength(1);
    expect(renderedContent(renderer)).toHaveLength(1);
    expect(renderer.root.findAllByType(SnoozeEndedMarker)).toHaveLength(0);
  });

  it("shows an agent's skill review notice in an open thread as a marker row", async () => {
    const { Message } = await import('../../messages/Message');
    const { SkillReviewMarker } = await import('../../messages/SkillReviewMarker');
    const event = skillReviewEvent('$review', '@mindroom_code:example.org');
    const { renderer } = await mountFeature([rowFor(event)], '$thread');

    const marker = renderer.root.findByType(SkillReviewMarker);
    expect(marker.props.review.changes).toEqual([
      { skill: 'developing-mindroom-chat', action: 'updated' },
    ]);
    expect(renderer.root.findAllByType(Message)).toHaveLength(0);
    expect(renderedContent(renderer)).toHaveLength(0);
  });

  it("keeps a person's message with the skill review key as a normal message", async () => {
    const { SkillReviewMarker } = await import('../../messages/SkillReviewMarker');
    const event = skillReviewEvent('$fake', '@bob:example.org');
    const { renderer } = await mountFeature([rowFor(event)], '$thread');

    expect(renderedContent(renderer)).toHaveLength(1);
    expect(renderer.root.findAllByType(SkillReviewMarker)).toHaveLength(0);
  });

  it("shows an agent's compaction notice in an open thread as a seam row", async () => {
    const { Message } = await import('../../messages/Message');
    const { CompactionNoticeSeam } = await import('../../messages/agent-run/CompactionSeam');
    const event = compactionNoticeEvent('$compacted', '@mindroom_code:example.org');
    const { renderer } = await mountFeature([rowFor(event)], '$thread');

    const seam = renderer.root.findByType(CompactionNoticeSeam);
    expect(seam.props.compaction).toMatchObject({
      phase: 'manual',
      status: 'success',
      startedAt: COMPACTION_SENT,
      beforeTokens: 366_804,
      afterTokens: 6336,
    });
    expect(renderer.root.findAllByType(Message)).toHaveLength(0);
    expect(renderedContent(renderer)).toHaveLength(0);
  });

  it("keeps a person's message with the compaction key as a normal message", async () => {
    const { CompactionNoticeSeam } = await import('../../messages/agent-run/CompactionSeam');
    const event = compactionNoticeEvent('$fake', '@bob:example.org');
    const { renderer } = await mountFeature([rowFor(event)], '$thread');

    expect(renderedContent(renderer)).toHaveLength(1);
    expect(renderer.root.findAllByType(CompactionNoticeSeam)).toHaveLength(0);
  });

  it('counts as a quiet marker for reply quotes exactly the rows it draws as one', async () => {
    const { SkillReviewMarker } = await import('../../messages/SkillReviewMarker');
    const { SnoozeEndedMarker } = await import('../../messages/SnoozeEndedMarker');
    const { CompactionNoticeSeam } = await import('../../messages/agent-run/CompactionSeam');
    // An agent notice that an edit turned into a skill review: only the edit carries the key.
    const edited = makeEvent('$edited', {
      sender: '@mindroom_code:example.org',
      threadRootId: '$thread',
      content: { msgtype: 'm.notice', body: 'Reviewing skills' },
    }) as unknown as MatrixEvent;
    const skillReview = skillReviewEvent('$edit', '@mindroom_code:example.org');
    Object.assign(edited, { __editedEvent: skillReview });
    const events = [
      skillReviewEvent('$review', '@mindroom_code:example.org'),
      skillReviewEvent('$person', '@bob:example.org'),
      snoozeEndedEvent('$wake', '@mindroom_router:example.org'),
      summaryEvent('$unplanned'),
      edited,
      compactionNoticeEvent('$compacted', '@mindroom_code:example.org'),
      compactionNoticeEvent('$person-compacted', '@bob:example.org'),
    ];
    const drawn = (threadId?: string) => {
      const mounted = mountFeature(
        events.map((event, index) => rowFor(event, index)),
        threadId
      );
      return mounted.then(({ renderer, feature, data }) => ({
        markers: [
          ...renderer.root.findAllByType(SkillReviewMarker),
          ...renderer.root.findAllByType(SnoozeEndedMarker),
          ...renderer.root.findAllByType(CompactionNoticeSeam),
        ].length,
        quiet: events.filter((event) =>
          feature().isQuietMarkerRow(event, data as never, {} as EventTimelineSet)
        ),
      }));
    };

    const thread = await drawn('$thread');
    expect(thread.quiet.map((event) => event.getId())).toEqual([
      '$review',
      '$wake',
      '$edited',
      '$compacted',
    ]);
    expect(thread.markers).toBe(4);
    // A room draws these as full messages, so none counts there.
    expect(await drawn()).toEqual({ markers: 0, quiet: [] });
  });

  it("draws a thread's applied model change as a marker row of its own, in the open thread only", async () => {
    const { Message } = await import('../../messages/Message');
    const { ModelChangeMarker } = await import('../../messages/ModelChangeMarker');
    const ack = makeEvent('$ack', {
      sender: '@mindroom_router:example.org',
      threadRootId: '$thread',
      ts: 5_000,
      content: { msgtype: 'm.notice', body: 'This thread now uses invented-swift.' },
    }) as unknown as MatrixEvent;
    // The hidden command, with an edit of it that has not decrypted yet.
    const commandEdit = encryptedEvent('$command-edit');
    const command = Object.assign(encryptedEvent('$command'), { __pendingEdits: [commandEdit] });
    const change = {
      command,
      operation: 'set',
      model: 'invented-swift',
      senderId: '@bob:example.org',
      threadId: '$thread',
      runtimeUserId: '@mindroom_router:example.org',
      runtimeDeviceId: 'DEVICE',
    } as const;
    const planned = { hiddenEventIds: new Set(['$command']), byAckId: new Map([['$ack', change]]) };
    const watched = () =>
      [command, commandEdit].map((event) => event.listenerCount(MatrixEventEvent.Decrypted));
    const noSet = {} as EventTimelineSet;

    const thread = await mountFeature([rowFor(ack)], '$thread');
    // The router's reply is a message until the thread's plan pairs it with its command.
    expect(thread.renderer.root.findAllByType(ModelChangeMarker)).toHaveLength(0);
    expect(renderedContent(thread.renderer)).toHaveLength(1);
    thread.data.modelChanges = planned;
    thread.update();
    expect(thread.renderer.root.findByType(ModelChangeMarker).props).toMatchObject({
      change,
      ts: 5_000,
    });
    expect(thread.renderer.root.findAllByType(Message)).toHaveLength(0);
    expect(renderedContent(thread.renderer)).toHaveLength(0);
    expect(thread.feature().isQuietMarkerRow(ack, thread.data as never, noSet)).toBe(true);
    // Its details open under it, so it never shares a row with other markers.
    expect(thread.feature().joinsQuietMarkerRun(ack, thread.data as never, noSet)).toBe(false);
    // The line stands for the command too: an edit of it that decrypts into another message
    // repaints, so the plan gives the command its row back.
    expect(watched()).toEqual([1, 1]);
    act(() => thread.renderer.unmount());
    expect(watched()).toEqual([0, 0]);

    const roomView = await mountFeature([rowFor(ack)]);
    roomView.data.modelChanges = planned;
    roomView.update();
    expect(roomView.renderer.root.findAllByType(ModelChangeMarker)).toHaveLength(0);
    expect(renderedContent(roomView.renderer)).toHaveLength(1);
  });

  it("draws an agent trigger wake as its own quiet marker row in a thread, and ignores a person's lookalike", async () => {
    const { Message } = await import('../../messages/Message');
    const { TriggerWakeMarker } = await import('../../messages/TriggerWakeMarker');
    const reactive = makeEvent('$reactive', {
      sender: '@mindroom_helper:example.org',
      threadRootId: '$thread',
      ts: 7_000,
      content: {
        msgtype: 'm.text',
        body: '@mindroom_helper:example.org Check PR\n\nReactive trigger context: trigger=tr_demo_watch, source=github, kind=pr.opened',
        'com.mindroom.source_kind': 'reactive_trigger',
        'io.mindroom.reactive_trigger.id': 'tr_demo_watch',
      },
    }) as unknown as MatrixEvent;
    const external = makeEvent('$external', {
      sender: '@mindroom_router:example.org',
      threadRootId: '$thread',
      ts: 8_000,
      content: {
        msgtype: 'm.text',
        body: '@mindroom_helper:example.org Deploy done',
        'com.mindroom.source_kind': 'external_trigger',
        'io.mindroom.external_trigger.id': 'deploy-hook',
        'io.mindroom.external_trigger.kind': 'deploy.finished',
      },
    }) as unknown as MatrixEvent;
    const spoof = makeEvent('$spoof', {
      sender: '@bob:example.org',
      threadRootId: '$thread',
      ts: 9_000,
      content: {
        msgtype: 'm.text',
        body: '@mindroom_helper:example.org Spoofed wake',
        'com.mindroom.source_kind': 'reactive_trigger',
        'io.mindroom.reactive_trigger.id': 'tr_spoof',
      },
    }) as unknown as MatrixEvent;
    const noSet = {} as EventTimelineSet;

    const { renderer, feature, data } = await mountFeature(
      [rowFor(reactive, 0), rowFor(external, 1), rowFor(spoof, 2)],
      '$thread'
    );

    const markers = renderer.root.findAllByType(TriggerWakeMarker);
    expect(markers).toHaveLength(2);
    expect(markers[0]?.props).toMatchObject({
      wake: { sourceKind: 'reactive', triggerId: 'tr_demo_watch', kind: 'pr.opened' },
      ts: 7_000,
    });
    expect(markers[1]?.props).toMatchObject({
      wake: { sourceKind: 'external', triggerId: 'deploy-hook', kind: 'deploy.finished' },
      ts: 8_000,
    });
    expect(renderer.root.findAllByType(Message)).toHaveLength(1);
    expect(renderedContent(renderer)).toHaveLength(1);
    expect(feature().isQuietMarkerRow(reactive, data as never, noSet)).toBe(true);
    expect(feature().joinsQuietMarkerRun(reactive, data as never, noSet)).toBe(false);
    expect(feature().isQuietMarkerRow(external, data as never, noSet)).toBe(true);
    expect(feature().joinsQuietMarkerRun(external, data as never, noSet)).toBe(false);
    expect(feature().isQuietMarkerRow(spoof, data as never, noSet)).toBe(false);
  });

  it('keeps the summary card for a summary outside an open thread', async () => {
    const { renderer } = await mountFeature([rowFor(summaryEvent('$summary'))]);

    expect(summaryMarkers(renderer)).toHaveLength(0);
    expect(renderedContent(renderer)).toHaveLength(1);
  });
});

describe("a fork's rows of its parent thread", () => {
  const AGENT = '@mindroom_research:example.org';
  /** A message of the parent thread `$parent`, shown in the fork `$fork` before its own. */
  const parentMessage = (id: string, opts: Parameters<typeof makeEvent>[1] = {}) =>
    makeEvent(id, { threadRootId: '$parent', ...opts }) as unknown as MatrixEvent;
  // The fork's root before the SDK knows its thread: no thread ID of its own yet.
  const forkRoot = () => makeEvent('$fork') as unknown as MatrixEvent;
  // The parent's root, copied from the cache: it does not know it starts a thread.
  const parentRoot = () => makeEvent('$parent') as unknown as MatrixEvent;
  const forkReply = () => makeEvent('$r1', { threadRootId: '$fork' }) as unknown as MatrixEvent;

  it('offers no reply, reaction, edit, delete or pin, and opens the message in its thread', async () => {
    const { Message } = await import('../../messages/Message');
    const rows = [parentRoot(), parentMessage('$p1'), forkRoot(), forkReply()];
    const { renderer } = await mountFeature(
      rows.map((event, index) => rowFor(event, index)),
      '$fork',
      new Set(['$parent', '$p1'])
    );

    const messages = renderer.root.findAllByType(Message).map((node) => node.props);
    const [first, second, root, reply] = messages;
    [first, second].forEach((prefix) => {
      expect(prefix).toMatchObject({
        canDelete: false,
        canSendReaction: false,
        canPinEvent: false,
      });
      expect(prefix?.onReplyClick).toBeUndefined();
      expect(prefix?.onReactionToggle).toBeUndefined();
      expect(prefix?.onEditId).toBeUndefined();
    });
    [root, reply].forEach((own) => {
      expect(own?.onReplyClick).toBeDefined();
      expect(own?.canSendReaction).toBe(true);
      expect(own?.onOpenInOriginalThread).toBeUndefined();
    });

    act(() => {
      first?.onOpenInOriginalThread();
      second?.onOpenInOriginalThread();
    });
    expect(navigateRoomThreadMock.mock.calls).toEqual([
      ['!room:example.org', '$parent', '$parent'],
      ['!room:example.org', '$parent', '$p1'],
    ]);
  });

  it('answers its cards in the parent thread and shows an approval and a question without their buttons', async () => {
    const { Message } = await import('../../messages/Message');
    const approval = parentMessage('$approval', {
      type: MINDROOM_TOOL_APPROVAL_EVENT,
      sender: AGENT,
      content: { tool_name: 'web_search', status: 'pending' },
    });
    const question = parentMessage('$question', {
      sender: AGENT,
      content: {
        msgtype: 'm.text',
        body: 'Which city? React with 1️⃣ Lisbon or 2️⃣ Porto.',
        'io.mindroom.interactive': {
          question_text: 'Which city?',
          options: { '1️⃣': 'Lisbon', '2️⃣': 'Porto' },
        },
      },
    });
    const { renderer } = await mountFeature(
      [rowFor(approval, 0), rowFor(question, 1), rowFor(forkReply(), 2)],
      '$fork',
      new Set(['$approval', '$question'])
    );

    expect(
      renderedContent(renderer).map(({ props }) => [props.eventId, props.threadId, props.readOnly])
    ).toEqual([
      ['$approval', '$parent', true],
      ['$question', '$parent', true],
      ['$r1', '$fork', false],
    ]);
    // A question's options are its reaction chips: in the fork they do not react.
    const chipsCanReact = renderer.root
      .findAllByType(Message)
      .map(({ props }) => props.reactions.props.children[0].props.canSendReaction);
    expect(chipsCanReact).toEqual([false, false, true]);
  });
});

describe('Fork from here', () => {
  const forkRefs = () => startFork.mock.calls.map(([ref]) => ref as unknown);

  it("forks a thread's message in its own thread, a parent's message in the fork in the parent's", async () => {
    const { Message } = await import('../../messages/Message');
    startFork.mockClear();
    // The parent's root copied from the cache does not know it starts a thread; nor does the
    // fork's root before the SDK has its thread.
    const rows = [
      makeEvent('$parent'),
      makeEvent('$p1', { threadRootId: '$parent' }),
      makeEvent('$fork'),
      makeEvent('$r1', { threadRootId: '$fork' }),
    ] as unknown as MatrixEvent[];
    const { renderer } = await mountFeature(
      rows.map((event, index) => rowFor(event, index)),
      '$fork',
      new Set(['$parent', '$p1'])
    );

    act(() => {
      renderer.root
        .findAllByType(Message)
        .forEach(({ props }) => props.onForkClick?.(props.mEvent.getId()));
    });
    expect(forkRefs()).toEqual([
      { threadId: '$parent', eventId: '$parent' },
      { threadId: '$parent', eventId: '$p1' },
      { threadId: '$fork', eventId: '$fork' },
      { threadId: '$fork', eventId: '$r1' },
    ]);
  });

  it('is offered on messages the server confirmed inside a thread, and nowhere else', async () => {
    const { Message } = await import('../../messages/Message');
    const rows = [
      makeEvent('~!room:example.org:txn-1', { threadRootId: '$thread' }),
      makeEvent('$approval', { threadRootId: '$thread', type: MINDROOM_TOOL_APPROVAL_EVENT }),
    ] as unknown as MatrixEvent[];
    const inThread = await mountFeature(
      rows.map((event, index) => rowFor(event, index)),
      '$thread'
    );
    expect(
      inThread.renderer.root.findAllByType(Message).map(({ props }) => props.onForkClick)
    ).toEqual([undefined, undefined]);

    const inRoom = await mountFeature([rowFor(makeEvent('$m') as unknown as MatrixEvent)]);
    expect(inRoom.renderer.root.findByType(Message).props.onForkClick).toBeUndefined();
  });

  it('is not offered in a room whose agents answer in the room, where a fork stays empty', async () => {
    const { Message } = await import('../../messages/Message');
    const roomMode = {
      currentState: {
        getStateEvents: (type: string) =>
          type === 'io.mindroom.thread_mode' ? { getContent: () => ({ mode: 'room' }) } : null,
      },
    };
    matrixClientMock.getRoom.mockImplementation(() => roomMode as never);
    try {
      const { renderer } = await mountFeature(
        [rowFor(makeEvent('$r1', { threadRootId: '$thread' }) as unknown as MatrixEvent)],
        '$thread'
      );
      expect(renderer.root.findByType(Message).props.onForkClick).toBeUndefined();
    } finally {
      matrixClientMock.getRoom.mockImplementation(() => null);
    }
  });
});

describe('the forks made at a message', () => {
  const forks = [
    { threadId: '$f1', ts: 10 },
    { threadId: '$f2', ts: 20 },
  ];

  it('shows a chip under the fork-point message of the thread, and under no other', async () => {
    forksByPoint.value = new Map([['$p2', forks]]);
    forksByPoint.asked.length = 0;
    const rows = [
      makeEvent('$p1', { threadRootId: '$parent' }),
      makeEvent('$p2', { threadRootId: '$parent' }),
      makeEvent('$p3', { threadRootId: '$parent' }),
    ] as unknown as MatrixEvent[];
    const { renderer } = await mountFeature(
      rows.map((event, index) => rowFor(event, index)),
      '$parent'
    );

    const chips = await forkChips(renderer);
    expect(chips.map((chip) => chip.eventId)).toEqual(['$p2']);
    expect(chips[0]?.props.forks).toBe(forks);
    expect(chips[0]?.props.room).toBeDefined();
    expect(forksByPoint.asked[0]?.[1]).toBe('$parent');
  });

  it("shows none on the rows of a parent shown inside a fork, only on the fork's own", async () => {
    forksByPoint.value = new Map([
      ['$p1', forks],
      ['$r1', [{ threadId: '$g', ts: 30 }]],
    ]);
    const rows = [
      makeEvent('$p1', { threadRootId: '$parent' }),
      makeEvent('$r1', { threadRootId: '$fork' }),
    ] as unknown as MatrixEvent[];
    const { renderer } = await mountFeature(
      rows.map((event, index) => rowFor(event, index)),
      '$fork',
      new Set(['$p1'])
    );

    const chips = await forkChips(renderer);
    expect(chips.map((chip) => chip.eventId)).toEqual(['$r1']);
    expect(chips[0]?.props.forks).toEqual([{ threadId: '$g', ts: 30 }]);
  });

  it('shows none outside a thread', async () => {
    forksByPoint.value = new Map([['$m', forks]]);
    const { renderer } = await mountFeature([rowFor(makeEvent('$m') as unknown as MatrixEvent)]);
    expect(await forkChips(renderer)).toHaveLength(0);
  });
});

describe('cross-room fork prefix rows', () => {
  it('uses per-row eventRoom for display name, Message room, Reply, Open in original thread, sender click, Fork from here, and encryption preview guard', async () => {
    const { Message } = await import('../../messages/Message');
    const sourceRoom = makeRoom({ roomId: '!alpha:example.org' });
    sourceRoom.hasEncryptionStateEvent = () => true;
    sourceRoom.getMember = ((userId: string) =>
      userId === '@alice:example.org' ? { name: 'Alice in Alpha' } : null) as never;

    settingsState.urlPreview = true;
    settingsState.encUrlPreview = false;
    startFork.mockClear();
    navigateRoomThreadMock.mockClear();
    openUserRoomProfileMock.mockClear();

    matrixClientMock.getRoom.mockImplementation(((id: string) =>
      id === '!alpha:example.org' ? sourceRoom : null) as never);

    try {
      const crossPrefixMsg = makeEvent('$p1', {
        roomId: '!alpha:example.org',
        threadRootId: '$parent',
        replyTo: '$p0',
        content: { msgtype: 'm.text', body: 'Check https://example.com' },
      }) as unknown as MatrixEvent;
      const ownReply = makeEvent('$r1', {
        roomId: '!room:example.org',
        threadRootId: '$fork',
        content: { msgtype: 'm.text', body: 'Own reply https://example.com' },
      }) as unknown as MatrixEvent;

      const { renderer } = await mountFeature(
        [rowFor(crossPrefixMsg, 0), rowFor(ownReply, 1)],
        '$fork',
        new Set(['$p1'])
      );

      const messages = renderer.root.findAllByType(Message);
      expect(messages).toHaveLength(2);
      const [prefixMessage, ownMessage] = messages;

      // Message & Reply use sourceRoom (so Copy Link, avatars, quoted replies resolve in Alpha).
      expect(prefixMessage!.props.room).toBe(sourceRoom);
      expect(prefixMessage!.props.reply.props.room).toBe(sourceRoom);
      expect(ownMessage!.props.room.roomId).toBe('!room:example.org');

      // Open in original thread navigates to sourceRoom.
      act(() => {
        prefixMessage!.props.onOpenInOriginalThread?.();
      });
      expect(navigateRoomThreadMock).toHaveBeenCalledWith('!alpha:example.org', '$parent', '$p1');

      // Sender click opens user profile in sourceRoom.
      const fakeEvent = {
        currentTarget: {
          getAttribute: (name: string) => (name === 'data-user-id' ? '@alice:example.org' : null),
          getBoundingClientRect: () => ({ top: 0, left: 0, width: 10, height: 10 }),
        },
        stopPropagation: vi.fn(),
      };
      act(() => {
        prefixMessage!.props.onUserClick?.(fakeEvent);
      });
      expect(openUserRoomProfileMock).toHaveBeenCalledWith(
        '!alpha:example.org',
        undefined,
        '@alice:example.org',
        expect.anything()
      );

      // Content uses sourceRoom display name and suppresses URL preview because sourceRoom is encrypted
      // while the unencrypted target room still allows URL previews on its own row.
      const contents = renderer.root.findAllByType(RenderMessageContent);
      expect(contents[0]!.props.roomId).toBe('!alpha:example.org');
      expect(contents[0]!.props.displayName).toBe('Alice in Alpha');
      expect(contents[0]!.props.urlPreview).toBe(false);
      expect(contents[1]!.props.roomId).toBe('!room:example.org');
      expect(contents[1]!.props.urlPreview).toBe(true);

      // Fork from here on an unencrypted cross-room prefix row preserves roomId.
      sourceRoom.hasEncryptionStateEvent = () => false;
      const unenc = await mountFeature([rowFor(crossPrefixMsg, 0)], '$fork', new Set(['$p1']));
      act(() => {
        unenc.renderer.root.findByType(Message).props.onForkClick?.('$p1');
      });
      expect(startFork).toHaveBeenCalledWith({
        roomId: '!alpha:example.org',
        threadId: '$parent',
        eventId: '$p1',
      });
    } finally {
      matrixClientMock.getRoom.mockImplementation(() => null);
    }
  });

  it('binds user mention clicks in cross-room prefix rows to eventRoom while delegating room mentions', async () => {
    const sourceRoom = makeRoom({ roomId: '!alpha:example.org' });
    matrixClientMock.getRoom.mockImplementation(((id: string) =>
      id === '!alpha:example.org' ? sourceRoom : null) as never);

    try {
      const crossPrefixMsg = makeEvent('$p1', {
        roomId: '!alpha:example.org',
        threadRootId: '$parent',
        content: { msgtype: 'm.text', body: 'Hello @bob:example.org' },
      }) as unknown as MatrixEvent;

      const { renderer } = await mountFeature(
        [rowFor(crossPrefixMsg, 0)],
        '$fork',
        new Set(['$p1'])
      );
      const content = renderer.root.findByType(RenderMessageContent);

      const userMentionEvent = {
        currentTarget: {
          getAttribute: (name: string) => (name === 'data-mention-id' ? '@bob:example.org' : null),
          getBoundingClientRect: () => ({ top: 1, left: 2, width: 30, height: 14 }),
        },
        preventDefault: vi.fn(),
      };
      // HTML parser mention click opens user profile in sourceRoom (!alpha:example.org).
      act(() => {
        content.props.htmlReactParserOptions.handleMentionClick(userMentionEvent);
      });
      expect(userMentionEvent.preventDefault).toHaveBeenCalledTimes(1);
      expect(openUserRoomProfileMock).toHaveBeenCalledWith(
        '!alpha:example.org',
        undefined,
        '@bob:example.org',
        expect.anything()
      );

      // Linkify plain-text mention click also binds to sourceRoom (!alpha:example.org).
      openUserRoomProfileMock.mockClear();
      const linkified = content.props.linkifyOpts.render('https://matrix.to/#/@bob:example.org');
      act(() => {
        linkified.customProps.onClick(userMentionEvent);
      });
      expect(openUserRoomProfileMock).toHaveBeenCalledWith(
        '!alpha:example.org',
        undefined,
        '@bob:example.org',
        expect.anything()
      );

      // Room mentions still delegate to the room mention handler.
      const roomMentionEvent = {
        currentTarget: {
          getAttribute: (name: string) =>
            name === 'data-mention-id' ? '!gamma:example.org' : null,
          getBoundingClientRect: () => ({ top: 0, left: 0, width: 10, height: 10 }),
        },
        preventDefault: vi.fn(),
      };
      act(() => {
        content.props.htmlReactParserOptions.handleMentionClick(roomMentionEvent);
      });
      expect(mentionClickMock).toHaveBeenCalledWith(roomMentionEvent);
    } finally {
      matrixClientMock.getRoom.mockImplementation(() => null);
    }
  });

  it('resolves off-prefix reply quotes in eventRoom (standalone room message vs other thread vs thread root)', async () => {
    const { Message } = await import('../../messages/Message');
    const standalone = makeEvent('$standalone', {
      roomId: '!alpha:example.org',
      content: { msgtype: 'm.text', body: 'Standalone in Alpha' },
    });
    const otherThreadReply = makeEvent('$otherReply', {
      roomId: '!alpha:example.org',
      threadRootId: '$otherThread',
      content: { msgtype: 'm.text', body: 'Reply in other thread' },
    });
    const otherThreadRoot = makeEvent('$otherRoot', {
      roomId: '!alpha:example.org',
      isThreadRoot: true,
      content: { msgtype: 'm.text', body: 'Other thread root' },
    });
    const sourceRoom = makeRoom({
      roomId: '!alpha:example.org',
      liveEvents: [standalone, otherThreadReply, otherThreadRoot],
    });
    matrixClientMock.getRoom.mockImplementation(((id: string) =>
      id === '!alpha:example.org' ? sourceRoom : null) as never);

    try {
      const parentRootQuotingStandalone = makeEvent('$parent', {
        roomId: '!alpha:example.org',
        isThreadRoot: true,
        replyTo: '$standalone',
        content: { msgtype: 'm.text', body: 'Thread root quoting standalone' },
      }) as unknown as MatrixEvent;
      const prefixQuotingOtherThread = makeEvent('$p1', {
        roomId: '!alpha:example.org',
        threadRootId: '$parent',
        replyTo: '$otherReply',
        content: { msgtype: 'm.text', body: 'Prefix quoting other thread reply' },
      }) as unknown as MatrixEvent;
      const prefixQuotingOtherRoot = makeEvent('$p2', {
        roomId: '!alpha:example.org',
        threadRootId: '$parent',
        replyTo: '$otherRoot',
        content: { msgtype: 'm.text', body: 'Prefix quoting other thread root' },
      }) as unknown as MatrixEvent;
      const prefixQuotingUnloaded = makeEvent('$p3', {
        roomId: '!alpha:example.org',
        threadRootId: '$parent',
        replyTo: '$unloaded',
        content: { msgtype: 'm.text', body: 'Prefix quoting unloaded event' },
      }) as unknown as MatrixEvent;

      const { renderer } = await mountFeature(
        [
          rowFor(parentRootQuotingStandalone, 0),
          rowFor(prefixQuotingOtherThread, 1),
          rowFor(prefixQuotingOtherRoot, 2),
          rowFor(prefixQuotingUnloaded, 3),
        ],
        '$fork',
        new Set(['$parent', '$p1', '$p2', '$p3'])
      );
      const messages = renderer.root.findAllByType(Message);

      // Quoting a standalone room message navigates to the room event in Alpha, not $parent thread.
      act(() => {
        messages[0]!.props.reply.props.onClick?.();
      });
      expect(navigateRoomMock).toHaveBeenCalledWith('!alpha:example.org', '$standalone');
      expect(navigateRoomThreadMock).not.toHaveBeenCalled();

      // Quoting a reply from another thread navigates to that thread at the quoted reply.
      navigateRoomMock.mockClear();
      act(() => {
        messages[1]!.props.reply.props.onClick?.();
      });
      expect(navigateRoomThreadMock).toHaveBeenCalledWith(
        '!alpha:example.org',
        '$otherThread',
        '$otherReply'
      );
      expect(navigateRoomMock).not.toHaveBeenCalled();

      // Quoting another thread's root navigates to that thread root.
      navigateRoomThreadMock.mockClear();
      act(() => {
        messages[2]!.props.reply.props.onClick?.();
      });
      expect(navigateRoomThreadMock).toHaveBeenCalledWith(
        '!alpha:example.org',
        '$otherRoot',
        undefined
      );

      // Quoting an unloaded event navigates to the room event in Alpha (where deep-link redirect resolves it).
      navigateRoomMock.mockClear();
      navigateRoomThreadMock.mockClear();
      act(() => {
        messages[3]!.props.reply.props.onClick?.();
      });
      expect(navigateRoomMock).toHaveBeenCalledWith('!alpha:example.org', '$unloaded');
      expect(navigateRoomThreadMock).not.toHaveBeenCalled();
    } finally {
      matrixClientMock.getRoom.mockImplementation(() => null);
    }
  });

  it('resolves source-room reactions from eventRoom.getUnfilteredTimelineSet() when no SDK Thread exists', async () => {
    const { Message } = await import('../../messages/Message');
    const sourceReactions = { tag: 'alpha-reactions' };
    const sourceRoom = makeRoom({ roomId: '!alpha:example.org' });
    Object.assign(sourceRoom.getUnfilteredTimelineSet(), {
      relations: {
        getChildEventsForEvent: (eventId: string) =>
          eventId === '$parent' ? sourceReactions : undefined,
      },
    });
    matrixClientMock.getRoom.mockImplementation(((id: string) =>
      id === '!alpha:example.org' ? sourceRoom : null) as never);

    try {
      const parentRoot = makeEvent('$parent', {
        roomId: '!alpha:example.org',
        isThreadRoot: true,
        content: { msgtype: 'm.text', body: 'Single-message parent root' },
      }) as unknown as MatrixEvent;

      const { renderer } = await mountFeature(
        [rowFor(parentRoot, 0)],
        '$fork',
        new Set(['$parent'])
      );
      const prefixMessage = renderer.root.findByType(Message);
      expect(prefixMessage.props.relations).toBe(sourceReactions);
    } finally {
      matrixClientMock.getRoom.mockImplementation(() => null);
    }
  });

  it('keeps forkTargetRoom and checks target room thread mode for "Fork from here" inside a cross-room draft', async () => {
    const { Message } = await import('../../messages/Message');
    const makeModeRoom = (roomId: string, mode: 'room' | 'thread') =>
      Object.assign(makeRoom({ roomId }), {
        currentState: {
          getStateEvents: (type: string, key: string) =>
            type === ROOM_THREAD_MODE_EVENT && key === '' ? { getContent: () => ({ mode }) } : null,
        },
      }) as unknown as Room;

    const alphaRoomMode = makeModeRoom('!alpha:example.org', 'room');
    const betaThreadMode = makeModeRoom('!beta:example.org', 'thread');
    const roomsById = new Map<string, Room>([
      [alphaRoomMode.roomId, alphaRoomMode],
      [betaThreadMode.roomId, betaThreadMode],
    ]);
    matrixClientMock.getRoom.mockImplementation(
      ((id: string) => roomsById.get(id) ?? null) as never
    );

    try {
      const earlierMsg = makeEvent('$a', {
        roomId: '!alpha:example.org',
        threadRootId: '$parent',
        content: { msgtype: 'm.text', body: 'Earlier message in Alpha' },
      }) as unknown as MatrixEvent;

      // Alpha is in room mode, Beta is in thread mode -> Fork from here IS available and targets Beta.
      startFork.mockClear();
      const allowed = await mountFeature([rowFor(earlierMsg, 0)], '$parent', new Set(['$a']), {
        room: alphaRoomMode,
        forkTargetRoom: betaThreadMode,
      });
      const msg = allowed.renderer.root.findByType(Message);
      expect(msg.props.onForkClick).toBeDefined();
      act(() => {
        msg.props.onForkClick?.('$a');
      });
      expect(startFork).toHaveBeenCalledWith(
        { threadId: '$parent', eventId: '$a' },
        '!beta:example.org'
      );

      // Alpha is in thread mode, Beta is in room mode -> Fork from here is suppressed because Beta ignores threads.
      const alphaThreadMode = makeModeRoom('!alpha:example.org', 'thread');
      const betaRoomMode = makeModeRoom('!beta:example.org', 'room');
      roomsById.set(alphaThreadMode.roomId, alphaThreadMode);
      roomsById.set(betaRoomMode.roomId, betaRoomMode);

      const blocked = await mountFeature([rowFor(earlierMsg, 0)], '$parent', new Set(['$a']), {
        room: alphaThreadMode,
        forkTargetRoom: betaRoomMode,
      });
      expect(blocked.renderer.root.findByType(Message).props.onForkClick).toBeUndefined();
    } finally {
      matrixClientMock.getRoom.mockImplementation(() => null);
    }
  });
});
