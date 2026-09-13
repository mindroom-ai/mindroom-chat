import React, { useRef } from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { useTimelineScrollLedgerController } from './timelineScrollLedgerController';
import type { ThreadLedgerEvent } from './threadScrollLedger';

const virtualizer = vi.hoisted(() => ({
  itemSizeCache: new Map<string, number>(),
  options: {},
  setOptions: vi.fn(),
  shouldAdjustScrollPositionOnItemSizeChange: undefined as unknown,
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => virtualizer,
}));

vi.mock('./rideTraceRecorder', () => ({
  installRideTraceRecorder: vi.fn(),
  isRideTraceEnabled: () => false,
}));

vi.mock('./scrollQuiescence', () => ({
  isIOSWebKitDevice: () => false,
  waitForScrollQuiescence: () => Promise.resolve(),
}));

const event = (eventId: string): ThreadLedgerEvent => ({
  getId: () => eventId,
});

describe('useTimelineScrollLedgerController', () => {
  it('uses the latest committed events when an older async capture callback runs', () => {
    const root = event('$root');
    const oldRow = event('$old');
    const currentRow = event('$current');
    const insertedRow = event('$inserted');
    const anchor = event('$anchor');
    const initialEvents = [root, oldRow, anchor];
    const currentEvents = [root, currentRow, anchor];
    const prependedEvents = [root, insertedRow, currentRow, anchor];
    virtualizer.itemSizeCache = new Map([
      ['$old', 100],
      ['$current', 20],
      ['$inserted', 10],
    ]);

    let retainedCapture:
      | ReturnType<typeof useTimelineScrollLedgerController>['captureThreadPrepend']
      | undefined;
    let latestLedgerPx = 0;

    const Harness = ({ events }: { events: ThreadLedgerEvent[] }) => {
      const pendingRoomFoldPxRef = useRef(0);
      const roomFoldPriceRef = useRef<(key: string | number | bigint, index: number) => number>(
        () => 10
      );
      const controller = useTimelineScrollLedgerController({
        alive: () => true,
        clearPendingThreadAnchor: vi.fn(),
        estimateSize: () => 10,
        getItemKey: (index) => events[index]?.getId() ?? index,
        getScrollElement: () => null,
        itemCount: events.length,
        pendingRoomFoldPxRef,
        roomFoldPriceRef,
        roomId: '!room:example.org',
        threadEventIndexMap: new Map(events.map((entry, index) => [entry.getId() ?? '', index])),
        threadEvents: events,
        threadId: '$root',
        threadInitialRenderMode: 'live',
        threadPaginatingBack: true,
        threadPendingAnchorSeq: 1,
      });
      retainedCapture ??= controller.captureThreadPrepend;
      latestLedgerPx = controller.ledgerPxAtRender;
      return null;
    };

    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(Harness, { events: initialEvents }));
    });
    act(() => {
      renderer.update(React.createElement(Harness, { events: currentEvents }));
    });
    act(() => {
      retainedCapture?.({
        threadId: '$root',
        anchorEventId: '$anchor',
        anchorIndex: 2,
        anchorSeq: 1,
      });
      renderer.update(React.createElement(Harness, { events: prependedEvents }));
    });

    expect(latestLedgerPx).toBe(10);
    renderer.unmount();
  });
});
