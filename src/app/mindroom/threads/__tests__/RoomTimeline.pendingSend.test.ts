import { EventStatus } from 'matrix-js-sdk';
import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  canEditEventMock,
  create,
  createControlledRoomTimelineHarness,
  editableActiveElementMock,
  flushAsyncWork,
  keyDownHandlersMock,
  makeEvent,
  makeRoom,
  matrixClientMock,
  noteRoomFocusedMock,
  saveCachedThreadSummaryMock,
  saveThreadEventsToCacheMock,
} from '../test-utils/RoomTimeline.test.shared';

describe('RoomTimeline pending-send wiring', () => {
  it('passes local-echo status into rendered message content', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const pendingEvent = makeEvent('$pending', { content: { body: 'pending' } }) as ReturnType<
      typeof makeEvent
    > & { status?: EventStatus };
    pendingEvent.status = EventStatus.SENDING;
    const pendingEdit = makeEvent('$pending-edit', {
      content: { body: 'pending edit' },
    }) as ReturnType<typeof makeEvent> & { status?: EventStatus };
    pendingEdit.status = EventStatus.SENDING;
    const editedBaseEvent = makeEvent('$edited-base', {
      content: { body: 'original' },
    }) as ReturnType<typeof makeEvent> & { __editedEvent?: typeof pendingEdit };
    editedBaseEvent.__editedEvent = pendingEdit;
    const failedEvent = makeEvent('$failed', { content: { body: 'failed' } }) as ReturnType<
      typeof makeEvent
    > & { status?: EventStatus };
    failedEvent.status = EventStatus.NOT_SENT;
    const confirmedEvent = makeEvent('$confirmed', { content: { body: 'confirmed' } });
    const room = makeRoom({
      liveEvents: [pendingEvent, editedBaseEvent, failedEvent, confirmedEvent],
    });

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(React.createElement(ControlledRoomTimeline, { room }));
      await flushAsyncWork(1);
    });

    const messageContent = renderer!.root
      .findAll(
        (node) =>
          typeof node.props.getContent === 'function' && typeof node.props.pendingSend === 'boolean'
      )
      .map((node) => ({
        body: node.props.getContent().body,
        pendingSend: node.props.pendingSend,
        failedSend: node.props.failedSend,
      }));

    expect(messageContent).toEqual(
      expect.arrayContaining([
        { body: 'pending', pendingSend: true, failedSend: false },
        { body: 'pending edit', pendingSend: true, failedSend: false },
        { body: 'failed', pendingSend: false, failedSend: true },
        { body: 'confirmed', pendingSend: false, failedSend: false },
      ])
    );
  });

  it('does not enter edit mode from ArrowUp until the target id is confirmed', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const localEventId = '~!room:example.org:txn-pending-root';
    const pendingEvent = makeEvent(localEventId, { content: { body: 'pending root' } });
    const room = makeRoom({ liveEvents: [pendingEvent] });
    canEditEventMock.mockReturnValue(true);
    editableActiveElementMock.mockReturnValue({});
    const previousDocument = globalThis.document;
    vi.stubGlobal('document', {
      activeElement: {
        getAttribute: (name: string) => (name === 'data-editable-name' ? 'RoomInput' : null),
      },
    });

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(React.createElement(ControlledRoomTimeline, { room }));
      await flushAsyncWork(1);
    });

    const localMessage = () =>
      renderer!.root.find(
        (node) => node.props.eventId === localEventId && typeof node.props.edit === 'boolean'
      );
    const pendingKeyEvent = { key: 'ArrowUp', preventDefault: vi.fn() } as unknown as KeyboardEvent;
    await act(async () => {
      keyDownHandlersMock.forEach((handler) => handler(pendingKeyEvent));
    });

    expect(localMessage().props.edit).toBe(false);
    expect(pendingKeyEvent.preventDefault).not.toHaveBeenCalled();

    const confirmedEventId = '$confirmed-root';
    const confirmedEvent = makeEvent(confirmedEventId, { content: { body: 'confirmed root' } });
    const confirmedRoom = makeRoom({ liveEvents: [confirmedEvent] });
    await act(async () => {
      renderer!.update(React.createElement(ControlledRoomTimeline, { room: confirmedRoom }));
      await flushAsyncWork(1);
    });
    const confirmedKeyEvent = {
      key: 'ArrowUp',
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    await act(async () => {
      keyDownHandlersMock.forEach((handler) => handler(confirmedKeyEvent));
    });

    const confirmedMessage = renderer!.root.find(
      (node) => node.props.eventId === confirmedEventId && typeof node.props.edit === 'boolean'
    );
    expect(confirmedMessage.props.edit).toBe(true);
    expect(confirmedKeyEvent.preventDefault).toHaveBeenCalled();

    vi.stubGlobal('document', previousDocument);
  });

  it('does not start remote or thread-persistence work for a local root route', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const localEventId = '~!room:example.org:txn-local-route';
    const localRoot = makeEvent(localEventId, {
      content: { body: 'optimistic root' },
      isSending: true,
      isThreadRoot: true,
    });
    const room = makeRoom({ liveEvents: [localRoot] });
    const onStoreThreadSummary = vi.fn();

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          threadId: localEventId,
          onStoreThreadSummary,
        })
      );
      await flushAsyncWork();
    });

    expect(matrixClientMock.fetchRelations).not.toHaveBeenCalled();
    expect(matrixClientMock.getThreadTimeline).not.toHaveBeenCalled();
    expect(saveThreadEventsToCacheMock).not.toHaveBeenCalled();
    expect(saveCachedThreadSummaryMock).not.toHaveBeenCalled();
    expect(onStoreThreadSummary).not.toHaveBeenCalled();
    expect(noteRoomFocusedMock).toHaveBeenCalledWith(room.roomId, undefined);
    expect(noteRoomFocusedMock).not.toHaveBeenCalledWith(room.roomId, localEventId);
  });
});
