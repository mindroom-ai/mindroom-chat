// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { useTimelineReadReceiptController } from './timelineReadReceiptController';

vi.mock('../notifications/readReceipts', () => ({
  markMainTimelineAsRead: vi.fn(),
  markRoomAndThreadsAsRead: vi.fn(),
  markThreadAsRead: vi.fn(),
}));

/** The observers the hook creates, with their callbacks, newest last. */
const observers: FakeObserver[] = [];

class FakeObserver {
  observe = vi.fn();

  unobserve = vi.fn();

  disconnect = vi.fn();

  constructor(readonly report: IntersectionObserverCallback) {
    observers.push(this);
  }
}

const anchor = document.createElement('span');
const anchorRef = { current: anchor };
const atBottomRef = { current: false };
const atLiveEndRef = { current: false };
const readUptoEventIdRef: { current: string | undefined } = { current: undefined };
const room = { roomId: '!room:example.org' } as Room;
const mx = {} as MatrixClient;
const getScrollElement = () => null;
const handleOpenEvent = () => undefined;

function Harness({
  atLiveEnd,
  setAtBottom,
}: {
  atLiveEnd: boolean;
  setAtBottom: (atBottom: React.SetStateAction<boolean>) => void;
}) {
  atLiveEndRef.current = atLiveEnd;
  useTimelineReadReceiptController({
    atBottom: false,
    atBottomAnchorRef: anchorRef,
    atBottomRef,
    atLiveEndRef,
    getScrollElement,
    handleOpenEvent,
    hideActivity: false,
    mx,
    readUptoEventIdRef,
    room,
    setAtBottom,
    threadEventsLength: 0,
    threadInitialRenderMode: 'live',
    threadTailLoaded: true,
    timelineAtLiveEnd: atLiveEnd,
  });
  return null;
}

describe('useTimelineReadReceiptController', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal('IntersectionObserver', FakeObserver);
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  });

  it('reports the bottom anchor again once the window is back at the live end', () => {
    const setAtBottom = vi.fn();
    act(() => {
      renderer = create(<Harness atLiveEnd={false} setAtBottom={setAtBottom} />);
    });
    const observer = observers.at(-1);
    expect(observer?.observe).toHaveBeenCalledWith(anchor);
    expect(observer?.unobserve).not.toHaveBeenCalled();

    // The reader stayed at the bottom while the window left the live end and came back: the
    // anchor never left the margin, so only a fresh report can show them at the bottom.
    act(() => renderer?.update(<Harness atLiveEnd setAtBottom={setAtBottom} />));
    expect(observers.at(-1)).toBe(observer);
    expect(observer?.unobserve).toHaveBeenCalledWith(anchor);
    expect(observer?.observe).toHaveBeenLastCalledWith(anchor);

    act(() =>
      observer?.report(
        [{ target: anchor, isIntersecting: true } as unknown as IntersectionObserverEntry],
        observer as unknown as IntersectionObserver
      )
    );
    expect(setAtBottom).toHaveBeenCalledWith(true);
  });
});
