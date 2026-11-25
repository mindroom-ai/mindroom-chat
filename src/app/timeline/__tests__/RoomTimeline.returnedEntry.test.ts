import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  makeEvent,
  makeRoom,
  makeTimeline,
  matrixClientMock,
  navigateRoomThreadMock,
  roomThreadListThreadsMock,
} from '../test-utils/RoomTimeline.test.shared';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';
import type { OpenRoomEventHandler } from '../roomEventOpenController';

// The minimap's row select is the timeline's own "open this event", as a tapped quote is.
const opener = vi.hoisted(() => ({ open: undefined as OpenRoomEventHandler | undefined }));
vi.mock('../useRoomTimelineMinimap', () => ({
  useRoomTimelineMinimap: ({ handleOpenEvent }: { handleOpenEvent: OpenRoomEventHandler }) => {
    opener.open = handleOpenEvent;
    return {
      minimapStripMap: new Map(),
      minimapItems: [],
      handleMinimapSelect: () => undefined,
      handleMinimapScrub: () => undefined,
    };
  },
}));

importBeforeTests(() => import('../RoomTimeline'));

const ROOT = '$thread-root';
const REPLY = '$reply';
const EDIT = '$edit';
const inThread = { content: { 'm.relates_to': { rel_type: 'm.thread', event_id: ROOT } } };
const replaces = { content: { 'm.relates_to': { rel_type: 'm.replace', event_id: REPLY } } };
const toThread = (eventId?: string) => ['!room:example.org', ROOT, eventId, { replace: true }];

/** A Compact room with one thread, mounted once: `show` moves it to another route. */
const mountRoom = async (events: ReturnType<typeof makeEvent>[] = []) => {
  const { RoomTimeline } = await import('../RoomTimeline');
  const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
  const threadRoot = makeEvent(ROOT, { isThreadRoot: true });
  const room = makeRoom({ liveEvents: [threadRoot, ...events] });
  // An active thread keeps the compact list from emptying while an event loads.
  roomThreadListThreadsMock.push({ id: ROOT, rootEvent: threadRoot, length: 2 } as never);
  let renderer: ReturnType<typeof create> | undefined;
  const show = async (eventId: string | undefined, entryReturned = false, threadId?: string) => {
    const element = React.createElement(Harness, {
      room,
      eventId,
      threadId,
      initialViewMode: 'compact',
      extraProps: { entryReturned },
    });
    await act(async () => {
      if (renderer) renderer.update(element);
      else renderer = create(element);
      await flushAsyncWork();
    });
  };
  return { room, show };
};

/** A promise the test settles. */
const held = <T>() => {
  let settle: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
};
const settled = async (settle: () => void) => {
  await act(async () => {
    settle();
    await flushAsyncWork();
  });
};

describe('RoomTimeline at the address the app’s Back returned to', () => {
  it('stays the room, and opens the thread for a link followed to the same address', async () => {
    const { show } = await mountRoom();

    await show(ROOT, true);
    expect(navigateRoomThreadMock).not.toHaveBeenCalled();

    // A tapped push or a link to the same event: the same address, not marked as a return.
    await show(ROOT, false);
    expect(navigateRoomThreadMock).toHaveBeenCalledWith(...toThread());

    // A step back to the returned entry shows the room again.
    navigateRoomThreadMock.mockClear();
    await show(ROOT, true);
    expect(navigateRoomThreadMock).not.toHaveBeenCalled();
  });

  it('stays the room after the thread of a reply whose first lookup failed was opened', async () => {
    const reply = makeEvent(REPLY, { threadRootId: ROOT });
    const lookup = held<unknown>();
    matrixClientMock.fetchRoomEvent.mockReturnValueOnce(lookup.promise);
    const { room, show } = await mountRoom();
    const findLoaded = room.findEventById;
    let replyLoaded = false;
    room.findEventById = (eventId: string) =>
      eventId === REPLY && replyLoaded ? reply : findLoaded(eventId);

    // The link's own visit: the server does not say which thread the reply is in.
    await show(REPLY);
    await settled(() => lookup.settle({}));
    expect(navigateRoomThreadMock).not.toHaveBeenCalled();

    // The thread opened from its card loads the reply; Back puts the link's address in its place.
    await show(undefined, false, ROOT);
    replyLoaded = true;
    await show(REPLY, true);
    expect(navigateRoomThreadMock).not.toHaveBeenCalled();
  });

  it('asks the server nothing about the thread, and stays the room once the event loads', async () => {
    const context = held<ReturnType<typeof makeTimeline>>();
    matrixClientMock.getEventTimeline.mockReturnValue(context.promise);
    const { show } = await mountRoom();

    await show(REPLY, true);
    expect(matrixClientMock.fetchRoomEvent).not.toHaveBeenCalled();
    await settled(() => context.settle(makeTimeline([makeEvent(REPLY, { threadRootId: ROOT })])));
    expect(navigateRoomThreadMock).not.toHaveBeenCalled();
  });

  it('leads into the thread of an event opened there by hand, once that event loads', async () => {
    const context = held<ReturnType<typeof makeTimeline>>();
    const { show } = await mountRoom();
    await show(ROOT, true);
    matrixClientMock.getEventTimeline.mockReturnValue(context.promise);

    await act(async () => {
      void opener.open?.(REPLY);
      await flushAsyncWork();
    });
    await settled(() => context.settle(makeTimeline([makeEvent(REPLY, { threadRootId: ROOT })])));

    expect(navigateRoomThreadMock).toHaveBeenCalledWith(...toThread(REPLY));
  });
});

describe('RoomTimeline at the address of an edit of a thread reply', () => {
  it('opens the thread at the reply, from the server’s copies of the edit and the reply', async () => {
    const edit = held<unknown>();
    const reply = held<unknown>();
    matrixClientMock.fetchRoomEvent.mockImplementation((_roomId: string, eventId: string) =>
      eventId === EDIT ? edit.promise : reply.promise
    );
    const { room, show } = await mountRoom();

    await show(EDIT);
    expect(matrixClientMock.fetchRoomEvent.mock.calls).toEqual([[room.roomId, EDIT]]);
    await settled(() => edit.settle(replaces));
    expect(matrixClientMock.fetchRoomEvent.mock.calls).toEqual([
      [room.roomId, EDIT],
      [room.roomId, REPLY],
    ]);
    expect(navigateRoomThreadMock).not.toHaveBeenCalled();
    await settled(() => reply.settle(inThread));

    expect(navigateRoomThreadMock).toHaveBeenCalledWith(...toThread(REPLY));
    expect(matrixClientMock.getEventTimeline).not.toHaveBeenCalled();
  });

  it('opens the thread when the edit is loaded without the reply it replaces', async () => {
    matrixClientMock.fetchRoomEvent.mockImplementation(async (_roomId: string, eventId: string) =>
      eventId === EDIT ? replaces : inThread
    );
    const { room, show } = await mountRoom([
      makeEvent(EDIT, { relation: { rel_type: 'm.replace', event_id: REPLY } }),
    ]);

    await show(EDIT);

    // The room's copy of the edit names the reply: only the reply is asked for.
    expect(matrixClientMock.fetchRoomEvent.mock.calls).toEqual([[room.roomId, REPLY]]);
    expect(navigateRoomThreadMock).toHaveBeenCalledWith(...toThread(REPLY));
  });

  it('shows the room without asking the server when it holds the edit and a room message it replaces', async () => {
    const { show } = await mountRoom([
      makeEvent(REPLY),
      makeEvent(EDIT, { relation: { rel_type: 'm.replace', event_id: REPLY } }),
    ]);

    await show(EDIT);

    expect(matrixClientMock.fetchRoomEvent).not.toHaveBeenCalled();
    expect(navigateRoomThreadMock).not.toHaveBeenCalled();
    expect(matrixClientMock.getEventTimeline).toHaveBeenCalledWith(expect.anything(), EDIT);
  });

  it('shows the room when the event the edit replaces is in no thread', async () => {
    matrixClientMock.fetchRoomEvent.mockImplementation(async (_roomId: string, eventId: string) =>
      eventId === EDIT ? replaces : {}
    );
    const { show } = await mountRoom();

    await show(EDIT);

    expect(navigateRoomThreadMock).not.toHaveBeenCalled();
    expect(matrixClientMock.getEventTimeline).toHaveBeenCalledWith(expect.anything(), EDIT);
  });
});
