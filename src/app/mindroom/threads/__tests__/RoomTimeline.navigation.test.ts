import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  getClickableByText,
  makeEvent,
  makeRoom,
  makeTimeline,
  matrixClientMock,
  reactionOrEditEventMock,
  roomTimelineVirtualizerState,
  roomUnreadState,
  scrollToItemMock,
} from '../test-utils/RoomTimeline.test.shared';

describe('RoomTimeline', () => {
  describe('navigation and focus', () => {
    describe('navigation and hidden-event recovery', () => {
      describe('filter navigation', () => {
  it('maps hidden event targets to a visible neighbor instead of filtered index zero', async () => {
    const { getTimelineTargetAnchor } = await import(
      '../timelineScrollUtils'
    );
    const { getRenderableEventEntries } = await import('../roomTimelineEvents');
    const olderMessage = makeEvent('$older', { ts: 1 });
    const threadRoot = makeEvent('$thread-root', { ts: 2 });
    const hiddenReply = makeEvent('$thread-reply', {
      threadRootId: threadRoot.getId(),
      ts: 3,
    });
    const newerMessage = makeEvent('$newer', { ts: 4 });
    const targetTimeline = makeTimeline([olderMessage, threadRoot, hiddenReply, newerMessage]);
    const room = makeRoom({
      timelinesByEventId: new Map([[hiddenReply.getId(), targetTimeline]]),
    });
    const renderableEntries = getRenderableEventEntries(
      [targetTimeline] as never,
      room as never,
      undefined,
      new Set(),
      false,
      false,
      false
    );

    expect(
      getTimelineTargetAnchor({
        linkedTimelines: [targetTimeline] as never,
        renderableEntries,
        eventId: hiddenReply.getId(),
        absoluteIndex: 2,
      })
    ).toEqual({
      eventId: threadRoot.getId(),
      index: 1,
      absoluteIndex: 1,
    });
  });

  it('falls back to the closest renderable entry when all target candidates are hidden', async () => {
    const { getTimelineTargetAnchor } = await import(
      '../timelineScrollUtils'
    );
    const { getRenderableEventEntries } = await import('../roomTimelineEvents');
    const olderMessage = makeEvent('$older', { ts: 1 });
    const hiddenReply = makeEvent('$thread-reply', {
      threadRootId: '$thread-root',
      ts: 2,
    });
    const hiddenEdit = makeEvent('$edit', {
      associatedId: hiddenReply.getId(),
      relation: { rel_type: 'm.replace', event_id: hiddenReply.getId() },
      ts: 3,
    });
    const newerMessage = makeEvent('$newer', { ts: 4 });
    reactionOrEditEventMock.mockImplementation((event) => event.getId() === hiddenEdit.getId());
    const targetTimeline = makeTimeline([olderMessage, hiddenReply, hiddenEdit, newerMessage]);
    const room = makeRoom({
      timelinesByEventId: new Map([[hiddenEdit.getId(), targetTimeline]]),
    });
    const renderableEntries = getRenderableEventEntries(
      [targetTimeline] as never,
      room as never,
      undefined,
      new Set(),
      false,
      false,
      false
    );

    expect(
      getTimelineTargetAnchor({
        linkedTimelines: [targetTimeline] as never,
        renderableEntries,
        eventId: hiddenEdit.getId(),
        absoluteIndex: 2,
      })
    ).toEqual({
      eventId: newerMessage.getId(),
      index: 1,
      absoluteIndex: 3,
    });
  });

  it('falls back to the last renderable entry when read-up-to is beyond all visible events', async () => {
    const { getUnreadTargetAnchor } = await import('../timelineScrollUtils');
    const { getRenderableEventEntries } = await import('../roomTimelineEvents');
    const firstVisible = makeEvent('$first', { ts: 1 });
    const lastVisible = makeEvent('$last', { ts: 2 });
    const hiddenReply = makeEvent('$hidden-reply', {
      threadRootId: '$thread-root',
      ts: 3,
    });
    const targetTimeline = makeTimeline([firstVisible, lastVisible, hiddenReply]);
    const room = makeRoom({
      timelinesByEventId: new Map([[hiddenReply.getId(), targetTimeline]]),
    });
    const renderableEntries = getRenderableEventEntries(
      [targetTimeline] as never,
      room as never,
      undefined,
      new Set(),
      false,
      false,
      false
    );

    expect(
      getUnreadTargetAnchor({
        renderableEntries,
        eventId: hiddenReply.getId(),
        absoluteIndex: 2,
      })
    ).toEqual({
      eventId: lastVisible.getId(),
      index: 1,
      absoluteIndex: 1,
    });
  });

  it('scrolls to the next visible event when read-up-to is filtered out in the live timeline', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const visibleRead = makeEvent('$visible-read', { ts: 1 });
    const hiddenReply = makeEvent('$hidden-reply', {
      threadRootId: '$thread-root',
      ts: 2,
    });
    const unreadVisible = makeEvent('$visible-unread', {
      sender: '@bob:example.org',
      ts: 3,
    });
    const room = makeRoom({
      liveEvents: [visibleRead, hiddenReply, unreadVisible],
    });
    room.getEventReadUpTo = () => hiddenReply.getId();
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    await act(async () => {
      create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(1);
    });

    expect(roomTimelineVirtualizerState.scrollToIndexMock).toHaveBeenCalledWith(1, {
      align: 'start',
      behavior: 'auto',
    });
  });

  it('detects unread divider boundaries when read-up-to is filtered out', async () => {
    const { shouldRenderUnreadDividerAt } = await import(
      '../timelineScrollUtils'
    );

    expect(
      shouldRenderUnreadDividerAt({
        readUptoAbsoluteIndex: 1,
        eventAbsoluteIndex: 2,
        prevRenderedEventAbsoluteIndex: 0,
      })
    ).toBe(true);

    expect(
      shouldRenderUnreadDividerAt({
        readUptoAbsoluteIndex: 1,
        eventAbsoluteIndex: 1,
        prevRenderedEventAbsoluteIndex: 0,
      })
    ).toBe(false);

    expect(
      shouldRenderUnreadDividerAt({
        readUptoAbsoluteIndex: 3,
        eventAbsoluteIndex: 5,
        prevRenderedEventAbsoluteIndex: 4,
      })
    ).toBe(false);
  });

      });

      describe('room focus retry handling', () => {
        it('does not retrigger room focus scroll on unrelated live room updates', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const unresolvedThread = makeEvent('$thread-root', { isThreadRoot: true });
    const unreadMessage = makeEvent('$unread-message');
    const unreadTimelineEvents = [unreadMessage];
    const unreadTimeline = makeTimeline(unreadTimelineEvents);
    const room = makeRoom({
      liveEvents: [unresolvedThread],
      timelinesByEventId: new Map([[unreadMessage.getId(), unreadTimeline]]),
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;

    room.getEventReadUpTo = () => unreadMessage.getId();
    roomUnreadState.value = true;
    matrixClientMock.getEventTimeline.mockResolvedValue(unreadTimeline);

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(1);
    });

    const jumpToUnread = getClickableByText(renderer!, 'Jump to Unread');

    await act(async () => {
      jumpToUnread.props.onClick();
      await flushAsyncWork();
    });

    const initialScrollCallCount = scrollToItemMock.mock.calls.length;
    expect(initialScrollCallCount).toBeGreaterThan(0);
    expect(scrollToItemMock).toHaveBeenLastCalledWith(0, {
      align: 'start',
      behavior: 'instant',
      offset: 32,
      stopInView: false,
    });

    unreadTimelineEvents.push(makeEvent('$later-event', { ts: 10 }));

    await act(async () => {
      renderer?.update(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork();
    });

    expect(scrollToItemMock).toHaveBeenCalledTimes(initialScrollCallCount);

    await act(async () => {
      renderer?.unmount();
      await flushAsyncWork(1);
    });
  });

  it('tracks room-mode focus retries while the target event is still missing from the DOM', async () => {
    const { getNextRoomFocusRetry } = await import('../timelineScrollUtils');

    expect(
      getNextRoomFocusRetry({
        focusEventId: '$target',
        pendingRetry: undefined,
        scrolled: true,
        targetFound: false,
      })
    ).toEqual({
      eventId: '$target',
      attempts: 1,
    });

    expect(
      getNextRoomFocusRetry({
        focusEventId: '$target',
        pendingRetry: {
          eventId: '$target',
          attempts: 1,
        },
        scrolled: true,
        targetFound: false,
      })
    ).toEqual({
      eventId: '$target',
      attempts: 2,
    });

    expect(
      getNextRoomFocusRetry({
        focusEventId: '$target',
        pendingRetry: {
          eventId: '$target',
          attempts: 10,
        },
        scrolled: true,
        targetFound: false,
      })
    ).toBeUndefined();

    expect(
      getNextRoomFocusRetry({
        focusEventId: '$target',
        pendingRetry: undefined,
        scrolled: true,
        targetFound: true,
      })
    ).toBeUndefined();
  });

  it('maps hidden event targets to a visible neighbor instead of filtered index zero', async () => {
    const { getTimelineTargetAnchor } = await import(
      '../timelineScrollUtils'
    );
    const { getRenderableEventEntries } = await import('../roomTimelineEvents');
    const olderMessage = makeEvent('$older', { ts: 1 });
    const threadRoot = makeEvent('$thread-root', { ts: 2 });
    const hiddenReply = makeEvent('$thread-reply', {
      threadRootId: threadRoot.getId(),
      ts: 3,
    });
    const newerMessage = makeEvent('$newer', { ts: 4 });
    const targetTimeline = makeTimeline([olderMessage, threadRoot, hiddenReply, newerMessage]);
    const room = makeRoom({
      timelinesByEventId: new Map([[hiddenReply.getId(), targetTimeline]]),
    });
    const renderableEntries = getRenderableEventEntries(
      [targetTimeline] as never,
      room as never,
      undefined,
      new Set(),
      false,
      false,
      false
    );

    expect(
      getTimelineTargetAnchor({
        linkedTimelines: [targetTimeline] as never,
        renderableEntries,
        eventId: hiddenReply.getId(),
        absoluteIndex: 2,
      })
    ).toEqual({
      eventId: threadRoot.getId(),
      index: 1,
      absoluteIndex: 1,
    });
  });

  it('falls back to the closest renderable entry when all target candidates are hidden', async () => {
    const { getTimelineTargetAnchor } = await import(
      '../timelineScrollUtils'
    );
    const { getRenderableEventEntries } = await import('../roomTimelineEvents');
    const olderMessage = makeEvent('$older', { ts: 1 });
    const hiddenReply = makeEvent('$thread-reply', {
      threadRootId: '$thread-root',
      ts: 2,
    });
    const hiddenEdit = makeEvent('$edit', {
      associatedId: hiddenReply.getId(),
      relation: { rel_type: 'm.replace', event_id: hiddenReply.getId() },
      ts: 3,
    });
    const newerMessage = makeEvent('$newer', { ts: 4 });
    reactionOrEditEventMock.mockImplementation((event) => event.getId() === hiddenEdit.getId());
    const targetTimeline = makeTimeline([olderMessage, hiddenReply, hiddenEdit, newerMessage]);
    const room = makeRoom({
      timelinesByEventId: new Map([[hiddenEdit.getId(), targetTimeline]]),
    });
    const renderableEntries = getRenderableEventEntries(
      [targetTimeline] as never,
      room as never,
      undefined,
      new Set(),
      false,
      false,
      false
    );

    expect(
      getTimelineTargetAnchor({
        linkedTimelines: [targetTimeline] as never,
        renderableEntries,
        eventId: hiddenEdit.getId(),
        absoluteIndex: 2,
      })
    ).toEqual({
      eventId: newerMessage.getId(),
      index: 1,
      absoluteIndex: 3,
    });
  });

  it('falls back to the last renderable entry when read-up-to is beyond all visible events', async () => {
    const { getUnreadTargetAnchor } = await import('../timelineScrollUtils');
    const { getRenderableEventEntries } = await import('../roomTimelineEvents');
    const firstVisible = makeEvent('$first', { ts: 1 });
    const lastVisible = makeEvent('$last', { ts: 2 });
    const hiddenReply = makeEvent('$hidden-reply', {
      threadRootId: '$thread-root',
      ts: 3,
    });
    const targetTimeline = makeTimeline([firstVisible, lastVisible, hiddenReply]);
    const room = makeRoom({
      timelinesByEventId: new Map([[hiddenReply.getId(), targetTimeline]]),
    });
    const renderableEntries = getRenderableEventEntries(
      [targetTimeline] as never,
      room as never,
      undefined,
      new Set(),
      false,
      false,
      false
    );

    expect(
      getUnreadTargetAnchor({
        renderableEntries,
        eventId: hiddenReply.getId(),
        absoluteIndex: 2,
      })
    ).toEqual({
      eventId: lastVisible.getId(),
      index: 1,
      absoluteIndex: 1,
    });
  });

  it('scrolls to the next visible event when read-up-to is filtered out in the live timeline', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const visibleRead = makeEvent('$visible-read', { ts: 1 });
    const hiddenReply = makeEvent('$hidden-reply', {
      threadRootId: '$thread-root',
      ts: 2,
    });
    const unreadVisible = makeEvent('$visible-unread', {
      sender: '@bob:example.org',
      ts: 3,
    });
    const room = makeRoom({
      liveEvents: [visibleRead, hiddenReply, unreadVisible],
    });
    room.getEventReadUpTo = () => hiddenReply.getId();
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    await act(async () => {
      create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(1);
    });

    expect(roomTimelineVirtualizerState.scrollToIndexMock).toHaveBeenCalledWith(1, {
      align: 'start',
      behavior: 'auto',
    });
  });

  it('detects unread divider boundaries when read-up-to is filtered out', async () => {
    const { shouldRenderUnreadDividerAt } = await import(
      '../timelineScrollUtils'
    );

    expect(
      shouldRenderUnreadDividerAt({
        readUptoAbsoluteIndex: 1,
        eventAbsoluteIndex: 2,
        prevRenderedEventAbsoluteIndex: 0,
      })
    ).toBe(true);

    expect(
      shouldRenderUnreadDividerAt({
        readUptoAbsoluteIndex: 1,
        eventAbsoluteIndex: 1,
        prevRenderedEventAbsoluteIndex: 0,
      })
    ).toBe(false);

    expect(
      shouldRenderUnreadDividerAt({
        readUptoAbsoluteIndex: 3,
        eventAbsoluteIndex: 5,
        prevRenderedEventAbsoluteIndex: 4,
      })
    ).toBe(false);
  });

      });
    });
  });
});
