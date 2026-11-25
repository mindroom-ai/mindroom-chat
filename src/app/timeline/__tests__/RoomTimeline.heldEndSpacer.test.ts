import React from 'react';
import { act, type ReactTestInstance } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

const heldReportState = vi.hoisted(() => ({
  active: false,
  onLayoutCommit: undefined as (() => void) | undefined,
}));

vi.mock('../timelineScrollLedgerController', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../timelineScrollLedgerController')>();
  const { useInsertionEffect, useLayoutEffect } = await import('react');
  return {
    ...actual,
    useTimelineScrollLedgerController: (
      opts: Parameters<typeof actual.useTimelineScrollLedgerController>[0]
    ) => {
      const ledger = actual.useTimelineScrollLedgerController(opts);
      const held = heldReportState.active;
      useInsertionEffect(() => {
        heldReportState.active = false;
      });
      useLayoutEffect(() => {
        heldReportState.onLayoutCommit?.();
      });
      return {
        ...ledger,
        unrenderedRowMove: () => held || ledger.unrenderedRowMove(),
        unrenderedInRowReport: () => held || ledger.unrenderedInRowReport(),
      };
    },
  };
});

import {
  create,
  createControlledRoomTimelineHarness,
  DEFAULT_THREAD_FILTER_STATE,
  flushAsyncWork,
  makeEvent,
  makeRoom,
  roomThreadListThreadsMock,
  roomTimelineVirtualizerState,
  scrollType,
  threadRenderStateMock,
} from '../test-utils/RoomTimeline.test.shared';

const originalResizeObserver = globalThis.ResizeObserver;
class ResizeObserverStub {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterAll(() => {
  vi.stubGlobal('ResizeObserver', originalResizeObserver);
});

afterEach(() => {
  heldReportState.active = false;
  heldReportState.onLayoutCommit = undefined;
  const virtualizer = roomTimelineVirtualizerState.lastInstance as
    { measurementsCache?: unknown[]; _holdOffset?: number } | undefined;
  if (virtualizer) {
    virtualizer.measurementsCache = [];
    delete virtualizer._holdOffset;
  }
});

type CommitSnapshot = {
  innerHeight: unknown;
  spacerHeight: unknown;
  spacerFlexShrink: unknown;
  spacerAriaHidden: unknown;
  spacerCountInsideContent: number;
  scrollChildRoles: string[];
};

const readCommitSnapshot = (renderer: ReturnType<typeof create>): CommitSnapshot => {
  const scroll = renderer.root.findByType(scrollType);
  const inner = renderer.root.find(
    (node) => node.type === 'div' && node.props['data-timeline-rows'] !== undefined
  );
  const content = renderer.root.find(
    (node) => node.type === 'div' && node.props.style?.minHeight === '100%'
  );
  const directChildren = scroll.children.filter(
    (child): child is ReactTestInstance => typeof child !== 'string'
  );
  const spacer = directChildren.find((child) => child.props['data-held-end-spacer'] !== undefined);
  const scrollChildRoles = directChildren
    .map((child) => {
      if (child === content) return 'content';
      if (child === spacer) return 'spacer';
      if (child.type === 'span' && child.props.style?.height === 0) return 'endAnchor';
      return '';
    })
    .filter(Boolean);

  return {
    innerHeight: inner.props.style?.height,
    spacerHeight: spacer?.props.style?.height,
    spacerFlexShrink: spacer?.props.style?.flexShrink,
    spacerAriaHidden: spacer?.props['aria-hidden'],
    spacerCountInsideContent: content.findAll(
      (node) => node.props['data-held-end-spacer'] !== undefined
    ).length,
    scrollChildRoles,
  };
};

const setVirtualizerEnd = (lastEnd: number, holdOffset = 0) => {
  const virtualizer = roomTimelineVirtualizerState.lastInstance as {
    measurementsCache: Array<{
      index: number;
      start: number;
      size: number;
      end: number;
      key: number;
      lane: number;
    }>;
    _holdOffset?: number;
  };
  const count = roomTimelineVirtualizerState.lastOptions!.count;
  expect(count).toBeGreaterThan(0);
  virtualizer.measurementsCache = Array.from({ length: count }, (_value, index) => ({
    index,
    start: index === count - 1 ? 0 : index * 100,
    size: index === count - 1 ? lastEnd : 100,
    end: index === count - 1 ? lastEnd : (index + 1) * 100,
    key: index,
    lane: 0,
  }));
  virtualizer._holdOffset = holdOffset;
  roomTimelineVirtualizerState.totalSize = lastEnd;
};

const makeNodeMock = (
  contentRect: { top: number; bottom: number },
  innerRect: { top: number; bottom: number },
  heldHeightPx = 500
) => {
  const scrollElement = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getBoundingClientRect: vi.fn(() => ({ top: 0, bottom: 600, width: 390, height: 600 })),
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    scrollHeight: 1200,
    clientHeight: 600,
    offsetHeight: 600,
    scrollTop: 600,
    scrollTo: vi.fn(),
  };
  const contentElement = { getBoundingClientRect: () => contentRect };
  const innerElement = {
    style: { height: `${heldHeightPx}px` },
    getBoundingClientRect: () => innerRect,
    querySelectorAll: () => [],
  };
  return (element: React.ReactElement) => {
    if (element.type === scrollType) return scrollElement;
    const props = element.props as Record<string, unknown> | undefined;
    if (props?.['data-timeline-rows'] !== undefined) return innerElement;
    const style = props?.style as { minHeight?: string } | undefined;
    if (element.type === 'div' && style?.minHeight === '100%') return contentElement;
    return null;
  };
};

const setupThread = (rootId: string, replyCount = 4) => {
  const root = makeEvent(rootId, { isThreadRoot: true, ts: 1 });
  const events = [
    root,
    ...Array.from({ length: replyCount }, (_value, index) =>
      makeEvent(`${rootId}-reply-${index}`, { threadRootId: rootId, ts: index + 2 })
    ),
  ];
  const room = makeRoom({ liveEvents: [root] });
  threadRenderStateMock.threadEvents = events;
  threadRenderStateMock.threadEventIndexMapRef.current = new Map(
    events.map((event, index) => [event.getId(), index])
  );
  return { room, rootId };
};

const runHeldUpdate = async (
  renderer: ReturnType<typeof create>,
  element: React.ReactElement,
  lastEnd: number,
  options?: { holdOffset?: number; onCommit?: (commitIndex: number) => void }
): Promise<CommitSnapshot[]> => {
  const commits: CommitSnapshot[] = [];
  setVirtualizerEnd(lastEnd, options?.holdOffset ?? 0);
  heldReportState.active = true;
  heldReportState.onLayoutCommit = () => {
    const index = commits.length;
    commits.push(readCommitSnapshot(renderer));
    options?.onCommit?.(index);
  };
  try {
    await act(async () => {
      renderer.update(React.cloneElement(element));
      await flushAsyncWork(2);
    });
  } finally {
    heldReportState.onLayoutCommit = undefined;
  }
  return commits;
};

const mountTimeline = async (
  element: React.ReactElement,
  createNodeMock: (element: React.ReactElement) => unknown
) => {
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(element, { createNodeMock });
    await flushAsyncWork(2);
  });
  return renderer;
};

const stubPaddingStyle = (paddingTop: string, paddingBottom: string) =>
  vi.spyOn(globalThis, 'getComputedStyle').mockReturnValue({
    paddingTop,
    paddingBottom,
    scrollPaddingTop: '0px',
  } as unknown as CSSStyleDeclaration);

importBeforeTests(() => import('../RoomTimeline'));

describe('RoomTimeline held-list end spacer', () => {
  it('renders growth spacer outside contentRef before latestEndAnchor and clears', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
    const { room, rootId } = setupThread('$harbor-growth');
    const styleSpy = stubPaddingStyle('0px', '40px');
    const element = React.createElement(Harness, { room, threadId: rootId });
    let renderer: ReturnType<typeof create> | undefined;

    try {
      renderer = await mountTimeline(
        element,
        makeNodeMock({ top: 0, bottom: 540 }, { top: 0, bottom: 500 })
      );
      const commits = await runHeldUpdate(renderer, element, 580, {
        onCommit: (commitIndex) => {
          if (commitIndex !== 0) return;
          // Second consecutive ResizeObserver pass before the first deferred commit settles.
          setVirtualizerEnd(620);
          heldReportState.active = true;
        },
      });

      expect(commits.length).toBeGreaterThanOrEqual(3);
      expect(commits[0]).toEqual({
        innerHeight: 500,
        spacerHeight: 80,
        spacerFlexShrink: 0,
        spacerAriaHidden: true,
        spacerCountInsideContent: 0,
        scrollChildRoles: ['content', 'spacer', 'endAnchor'],
      });
      expect(commits[1]).toMatchObject({
        innerHeight: 500,
        spacerHeight: 120,
        scrollChildRoles: ['content', 'spacer', 'endAnchor'],
      });
      expect(commits.at(-1)).toMatchObject({
        innerHeight: 620,
        spacerHeight: undefined,
        scrollChildRoles: ['content', 'endAnchor'],
      });
    } finally {
      styleSpy.mockRestore();
      act(() => renderer?.unmount());
    }
  });

  it('subtracts minHeight slack in short threads and bottom-aligned rooms', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
    const { room, rootId } = setupThread('$harbor-slack', 2);
    const styleSpy = stubPaddingStyle('60px', '60px');
    let renderer: ReturnType<typeof create> | undefined;

    try {
      // Start-aligned thread: content 800, inner bottom 540, paddingBottom 60 => 200 px slack.
      const threadEl = React.createElement(Harness, { room, threadId: rootId });
      renderer = await mountTimeline(
        threadEl,
        makeNodeMock({ top: 0, bottom: 800 }, { top: 40, bottom: 540 })
      );
      expect((await runHeldUpdate(renderer, threadEl, 650))[0]).toMatchObject({
        innerHeight: 500,
        spacerHeight: undefined,
      });
      expect((await runHeldUpdate(renderer, threadEl, 760))[0]).toMatchObject({
        innerHeight: 500,
        spacerHeight: 60,
      });
      act(() => renderer?.unmount());

      // Bottom-aligned room: inner top 220, content top 0, paddingTop 60 => 160 px slack.
      const roomOnly = makeRoom({ liveEvents: [makeEvent('$harbor-room-1', { ts: 1 })] });
      const roomEl = React.createElement(Harness, { room: roomOnly });
      renderer = await mountTimeline(
        roomEl,
        makeNodeMock({ top: 0, bottom: 800 }, { top: 220, bottom: 720 })
      );
      expect((await runHeldUpdate(renderer, roomEl, 700))[0]).toMatchObject({
        innerHeight: 500,
        spacerHeight: 40,
      });
    } finally {
      styleSpy.mockRestore();
      act(() => renderer?.unmount());
    }
  });

  it('renders no spacer on shrink, holdOffset !== 0, or latestAtTop', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
    const { room, rootId } = setupThread('$harbor-guards');
    const createNodeMock = makeNodeMock({ top: 0, bottom: 540 }, { top: 0, bottom: 500 });
    const styleSpy = stubPaddingStyle('0px', '40px');
    const threadEl = React.createElement(Harness, { room, threadId: rootId });
    let renderer: ReturnType<typeof create> | undefined;

    try {
      renderer = await mountTimeline(threadEl, createNodeMock);
      expect((await runHeldUpdate(renderer, threadEl, 420))[0]).toMatchObject({
        innerHeight: 500,
        spacerHeight: undefined,
      });
      expect((await runHeldUpdate(renderer, threadEl, 500))[0]).toMatchObject({
        innerHeight: 500,
        spacerHeight: undefined,
      });
      const heldOffsetCommits = await runHeldUpdate(renderer, threadEl, 580, { holdOffset: 120 });
      expect(heldOffsetCommits[0]).toMatchObject({
        innerHeight: 500,
        spacerHeight: undefined,
      });
      act(() => renderer?.unmount());

      const rootA = makeEvent('$harbor-top-a', { isThreadRoot: true, ts: 100 });
      const rootB = makeEvent('$harbor-top-b', { isThreadRoot: true, ts: 200 });
      const latestAtTopRoom = makeRoom({ liveEvents: [rootA, rootB] });
      roomThreadListThreadsMock.push(
        { id: rootA.getId(), rootEvent: rootA },
        { id: rootB.getId(), rootEvent: rootB }
      );
      const latestAtTopEl = React.createElement(Harness, {
        room: latestAtTopRoom,
        initialViewMode: 'threaded',
        initialThreadFilterState: { ...DEFAULT_THREAD_FILTER_STATE, tags: new Map() },
      });
      renderer = await mountTimeline(latestAtTopEl, createNodeMock);
      expect((await runHeldUpdate(renderer, latestAtTopEl, 580))[0]).toMatchObject({
        innerHeight: 500,
        spacerHeight: undefined,
        scrollChildRoles: ['endAnchor', 'content'],
      });
    } finally {
      styleSpy.mockRestore();
      act(() => renderer?.unmount());
    }
  });
});
