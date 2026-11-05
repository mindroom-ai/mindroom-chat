import React, { type ReactElement, type ReactNode } from 'react';
import { act } from 'react-test-renderer';
import { ThreadEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  makeEvent,
  makeRoom,
  threadResolutionMapMock,
} from '../test-utils/RoomTimeline.test.shared';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

// The Threads view shows a thread chip under a room message only once its thread has a reply.

type Renderer = ReturnType<typeof create>;

const findElement = (
  node: ReactNode,
  predicate: (element: ReactElement) => boolean
): ReactElement | undefined => {
  if (!React.isValidElement(node)) return undefined;
  if (predicate(node)) return node;
  const { children } = node.props as { children?: ReactNode };
  return React.Children.toArray(children)
    .map((child) => findElement(child, predicate))
    .find((child): child is ReactElement => child !== undefined);
};

/** The thread chip under a room row, or undefined when the row shows none. */
const chipOf = async (renderer: Renderer, eventId: string) => {
  const { ThreadBadgeRenderer } = await import('../../threads/ThreadBadgeRenderer');
  const message = renderer.root.findByProps({ 'data-message-id': eventId });
  const reactions = (message.props as { reactions?: ReactNode }).reactions;
  return findElement(reactions, (element) => element.type === ThreadBadgeRenderer)?.props as
    | { model: { replyCount: number; isResolved: boolean } }
    | undefined;
};

const reply = (eventId: string, rootId: string) =>
  makeEvent(eventId, {
    sender: '@bob:example.org',
    ts: 20,
    threadRootId: rootId,
    relation: { rel_type: 'm.thread', event_id: rootId },
  });

const renderTimeline = async (room: ReturnType<typeof makeRoom>) => {
  const { RoomTimeline } = await import('../RoomTimeline');
  const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
  let renderer: Renderer | undefined;
  await act(async () => {
    renderer = create(React.createElement(ControlledRoomTimeline, { room }));
    await flushAsyncWork(2);
  });
  if (!renderer) throw new Error('The timeline did not render');
  return renderer;
};

importBeforeTests(() => import('../RoomTimeline'));

describe('RoomTimeline thread chip', () => {
  it('shows a chip under a root with replies and none under a message without any', async () => {
    const root = makeEvent('$root', { ts: 10, isThreadRoot: true });
    const replies = [reply('$reply-1', '$root'), reply('$reply-2', '$root')];
    const plain = makeEvent('$plain', { ts: 30 });
    const room = makeRoom({
      liveEvents: [root, plain],
      threads: [
        {
          id: '$root',
          rootEvent: root,
          events: replies,
          timeline: replies,
          length: 2,
        },
      ] as never[],
    });

    const renderer = await renderTimeline(room);

    expect((await chipOf(renderer, '$root'))?.model.replyCount).toBe(2);
    expect(await chipOf(renderer, '$plain')).toBeUndefined();
  });

  it('shows no chip for a resolved message without replies', async () => {
    const plain = makeEvent('$plain', { ts: 30 });
    threadResolutionMapMock.set('$plain', { isResolved: true, tags: null });
    const room = makeRoom({ liveEvents: [plain] });

    const renderer = await renderTimeline(room);

    expect(renderer.root.findByProps({ 'data-message-id': '$plain' })).toBeDefined();
    expect(await chipOf(renderer, '$plain')).toBeUndefined();
  });

  it("shows the server's reply count before the replies are loaded", async () => {
    const root = makeEvent('$root', {
      ts: 10,
      unsigned: { 'm.relations': { 'm.thread': { count: 3 } } },
    });
    const room = makeRoom({ liveEvents: [root] });

    const renderer = await renderTimeline(room);

    expect((await chipOf(renderer, '$root'))?.model.replyCount).toBe(3);
  });

  it('adds the chip when the first reply arrives', async () => {
    const plain = makeEvent('$plain', { ts: 30 });
    const room = makeRoom({ liveEvents: [plain] });
    const renderer = await renderTimeline(room);
    expect(await chipOf(renderer, '$plain')).toBeUndefined();

    const thread = room.createThread('$plain', plain, [reply('$first-reply', '$plain')]);
    await act(async () => {
      room.__listeners.get(ThreadEvent.New)?.(thread, true);
      room.__listeners.get(ThreadEvent.NewReply)?.(thread);
      room.__listeners.get(ThreadEvent.Update)?.(thread);
      await flushAsyncWork(2);
    });

    expect((await chipOf(renderer, '$plain'))?.model.replyCount).toBe(1);
  });
});
