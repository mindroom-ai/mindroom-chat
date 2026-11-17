import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  flushOpenTasks,
  makeEvent,
  makeRoom,
  roomTimelineVirtualizerState,
  scrollType,
  threadRenderStateMock,
} from '../test-utils/RoomTimeline.test.shared';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

/** A correction of the scroll position the rows do not show yet, as the ledger reports it. */
const heldCorrection = vi.hoisted(() => ({ px: 0 }));
vi.mock('../timelineScrollLedgerController', async (importOriginal) => {
  const ledger = await importOriginal<typeof import('../timelineScrollLedgerController')>();
  return {
    ...ledger,
    useTimelineScrollLedgerController: (
      ...args: Parameters<typeof ledger.useTimelineScrollLedgerController>
    ) => {
      const controller = ledger.useTimelineScrollLedgerController(...args);
      return {
        ...controller,
        unrenderedCorrectionPx: () => heldCorrection.px || controller.unrenderedCorrectionPx(),
      };
    },
  };
});

type ListOptions = { overscan: number; initialOffset: number | (() => number) };
const listOptions = () => roomTimelineVirtualizerState.lastOptions as unknown as ListOptions;

/** A scroll area at the end of its range, which mounts no row until the test says. */
const makeScroll = () => {
  const mounted = { rows: false, onRead: () => {} };
  const tile = {
    getAttribute: () => '0',
    getBoundingClientRect: () => ({ top: 0, bottom: 100 }),
  };
  const el = {
    isConnected: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
    querySelector: () => {
      mounted.onRead();
      return mounted.rows ? tile : null;
    },
    querySelectorAll: () => [],
    scrollHeight: 2000,
    clientHeight: 600,
    scrollTop: 1400,
    scrollTo: vi.fn(),
    style: {},
  };
  return { el, mounted };
};

const setup = async (extra: Record<string, unknown>) => {
  const { RoomTimeline } = await import('../RoomTimeline');
  const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
  const root = makeEvent('$root', { isThreadRoot: true, ts: 1 });
  const reply1 = makeEvent('$reply1', { threadRootId: '$root', ts: 2 });
  const reply2 = makeEvent('$reply2', { threadRootId: '$root', ts: 3 });
  const room = makeRoom({ liveEvents: [root, reply1, reply2] });
  threadRenderStateMock.threadEvents = [root, reply1, reply2] as never;
  const scroll = makeScroll();
  const props = { room, ...extra };
  let renderer: ReturnType<typeof create> | undefined;
  const render = () =>
    act(async () => {
      const element = React.createElement(ControlledRoomTimeline, props);
      if (renderer) renderer.update(element);
      else {
        renderer = create(element, {
          createNodeMock: (node) => (node.type === scrollType ? scroll.el : null),
        });
      }
      await flushAsyncWork();
      await flushOpenTasks();
    });
  await render();
  return { scroll, render, unmount: () => act(async () => renderer?.unmount()) };
};

importBeforeTests(() => import('../RoomTimeline'));

describe('RoomTimeline thread opening', () => {
  it('starts a thread that opens at its newest reply at the end of its list', async () => {
    const { unmount } = await setup({ threadId: '$root' });
    const { initialOffset } = listOptions();
    expect(typeof initialOffset === 'function' && initialOffset()).toBeGreaterThan(0);
    await unmount();
  });

  it('starts a thread that opens at an event at its first rows, for the jump to that event', async () => {
    const { unmount } = await setup({ threadId: '$root', eventId: '$reply1' });
    expect(listOptions().initialOffset).toBe(0);
    // No reveal to wait for: the rows around the view are mounted from the start.
    expect(listOptions().overscan).toBe(10);
    await unmount();
  });

  it('starts the room at its first rows', async () => {
    const { unmount } = await setup({});
    expect(listOptions().initialOffset).toBe(0);
    expect(listOptions().overscan).toBe(10);
    await unmount();
  });

  it('mounts the rows near the view while the thread opens, and the rows around them once it shows', async () => {
    const { scroll, render, unmount } = await setup({ threadId: '$root' });
    expect(listOptions().overscan).toBe(1);

    // The rows mount at the end of the list: the thread shows, and takes its rows around the view.
    scroll.mounted.rows = true;
    await render();
    expect(listOptions().overscan).toBe(10);
    await unmount();
  });

  it('keeps an opening thread hidden while a commit shows rows at sizes since measured anew', async () => {
    const { scroll, render, unmount } = await setup({ threadId: '$root' });
    // The rows are mounted at the end, but measuring them in this commit changed the list's size
    // after it rendered: the commit shows them at the sizes before.
    scroll.mounted.rows = true;
    scroll.mounted.onRead = () => {
      roomTimelineVirtualizerState.totalSize =
        (roomTimelineVirtualizerState.totalSize ?? 5000) + 10;
    };
    await render();
    expect(listOptions().overscan).toBe(1);

    scroll.mounted.onRead = () => {};
    await render();
    expect(listOptions().overscan).toBe(10);
    roomTimelineVirtualizerState.totalSize = undefined;
    await unmount();
  });

  it('keeps an opening thread hidden in the render that holds the list height back', async () => {
    const { scroll, render, unmount } = await setup({ threadId: '$root' });
    // virtual-core corrected the scroll position for a row measured above the view: the ledger
    // renders the moved rows at once with the list's height held, and at its new height next.
    scroll.mounted.rows = true;
    heldCorrection.px = -50;
    await render();
    expect(listOptions().overscan).toBe(1);

    heldCorrection.px = 0;
    await render();
    expect(listOptions().overscan).toBe(10);
    await unmount();
  });
});
