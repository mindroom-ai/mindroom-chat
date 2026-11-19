// @vitest-environment jsdom
import { createRef, useContext, useLayoutEffect, type ReactNode, type RefObject } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createClient, Room } from 'matrix-js-sdk';
import { afterEach, expect, it, vi } from 'vitest';
import { FooterOverHeader, HeaderInThread } from '../ui/styles/RoomOverlay.css';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { useThreadApprovals, type ThreadApprovals } from '../approvals/ThreadApprovalProvider';
import { ThreadApprovalsScope } from '../approvals/ThreadApprovalsRelay';
import { HeaderResizeHoldContext } from '../timeline/headerResizeHold';
import { ConversationLayout } from './ConversationLayout';
import { HeaderInShortArea } from './RoomView.css';

const mx = createClient({ baseUrl: 'https://matrix.example.org', userId: '@alice:example.org' });
const room = new Room('!room:example.org', mx, '@alice:example.org');

const seen = vi.hoisted(() => ({
  jobs: [] as (string | null)[],
  approvals: [] as (string | undefined)[],
  jobsThrow: false,
  reported: [] as unknown[],
}));

vi.mock('../timeline/typing/RoomViewTyping', () => ({
  RoomViewTyping: ({ threadId }: { threadId?: string }) => (
    <div data-testid="typing">{threadId ?? 'room'}</div>
  ),
}));
vi.mock('../timeline/RoomViewFollowing', () => ({
  RoomViewFollowing: ({ threadId }: { threadId?: string }) => (
    <div data-testid="following">{threadId ?? 'room'}</div>
  ),
}));
vi.mock('../background-jobs/BackgroundJobsBar', () => ({
  BackgroundJobsBar: ({ threadId, canCancel }: { threadId: string | null; canCancel: boolean }) => {
    seen.jobs.push(threadId);
    if (seen.jobsThrow) throw new Error('jobs bar broke');
    return <div data-testid="jobs" data-can-cancel={String(canCancel)} />;
  },
}));
vi.mock('../bug-reports/error-reporting/errorReporting', () => ({
  reportBoundaryError: (thrown: unknown) => seen.reported.push(thrown),
}));
// The jobs bar's link to the Sub-agents panel reads the room's runs, which need a client.
vi.mock('../messages/live/subagentRunStore', () => ({
  useRoomSubagentCounts: () => ({ total: 0, active: 0 }),
}));
vi.mock('../approvals/ThreadApprovalProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../approvals/ThreadApprovalProvider')>();
  const { useMemo } = await import('react');
  return {
    ...actual,
    // A thread's provider gives what it holds the thread's approvals: here only its ID, one value
    // while it stays the same, as the real provider's.
    ThreadApprovalProvider: ({
      threadId,
      children,
    }: {
      threadId?: string;
      children: ReactNode;
    }) => {
      seen.approvals.push(threadId);
      const value = useMemo(
        () => (threadId ? ({ threadId } as ThreadApprovals) : undefined),
        [threadId]
      );
      return <ThreadApprovalsScope value={value}>{children}</ThreadApprovalsScope>;
    },
  };
});
vi.mock('../approvals/ThreadApprovalControls', () => ({
  ThreadApprovalQueue: () => <div data-testid="approval-queue" />,
}));

afterEach(() => {
  cleanup();
  seen.jobs = [];
  seen.approvals = [];
  seen.jobsThrow = false;
  seen.reported = [];
  vi.restoreAllMocks();
});

const layout = (props: Partial<Parameters<typeof ConversationLayout>[0]> = {}) => (
  <ConversationLayout
    room={room}
    areaRef={createRef<HTMLDivElement>()}
    timeline={<div data-testid="timeline" />}
    focusConversation={() => undefined}
    canCancelJobs
    notice={<div data-testid="notice" />}
    composer={<div data-testid="composer" />}
    {...props}
  />
);

it('draws the header, timeline, dock and footer of the room', () => {
  let headerRef: RefObject<HTMLDivElement> | undefined;
  render(
    layout({
      header: (ref) => {
        headerRef = ref;
        return <div data-testid="header" />;
      },
    })
  );

  expect(headerRef?.current).toBe(screen.getByTestId('header').parentElement);
  expect(screen.getByTestId('timeline')).toBeTruthy();
  expect(seen.jobs).toContain(null);
  expect(screen.queryByTestId('approval-queue')).toBeNull();
  // The typing strip shares the dock's bars with the jobs bar, first, so it can sit beside it;
  // who has read the latest message ends the dock's row.
  const bars = screen.getByTestId('jobs').parentElement;
  expect([...(bars?.children ?? [])].map((child) => child.getAttribute('data-testid'))).toEqual([
    'typing',
    'jobs',
  ]);
  expect(bars?.className).toBe('room-dock-bars');
  expect(
    [...(bars?.parentElement?.children ?? [])].map(
      (child) => child.getAttribute('data-testid') ?? child.className
    )
  ).toEqual(['room-dock-bars', 'following']);
  // The footer starts with an empty box, where a selection of the conversation ends before the
  // composer.
  const footer = document.querySelector('[data-room-footer="true"]');
  expect(
    [...(footer?.children ?? [])].map(
      (child) =>
        child.getAttribute('data-testid') ??
        (child.childNodes.length === 0 && child.getAttribute('aria-hidden') === 'true'
          ? 'empty box'
          : child.outerHTML)
    )
  ).toEqual(['empty box', 'notice', 'composer']);
});

it('hides only a jobs bar that throws, and tries it again in the next conversation', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  seen.jobsThrow = true;
  const { rerender } = render(layout({ threadId: '$root' }));

  expect(screen.queryByTestId('jobs')).toBeNull();
  expect(screen.getByTestId('timeline')).toBeTruthy();
  expect(screen.getByTestId('typing')).toBeTruthy();
  expect(screen.getByTestId('composer')).toBeTruthy();
  expect(seen.reported).toEqual([new Error('jobs bar broke')]);

  seen.jobsThrow = false;
  rerender(layout({ threadId: '$other' }));
  expect(screen.getByTestId('jobs')).toBeTruthy();
});

it("adds the thread's approvals and passes a confirmed thread to its provider", () => {
  const { rerender } = render(layout({ threadId: '$root' }));
  expect(screen.getByTestId('approval-queue')).toBeTruthy();
  expect(seen.approvals.at(-1)).toBe('$root');
  expect(seen.jobs.at(-1)).toBe('$root');
  expect(screen.getByTestId('typing').textContent).toBe('$root');

  rerender(layout({ threadId: '~!room:example.org:txn' }));
  expect(seen.approvals.at(-1)).toBeUndefined();
});

it("acts on none of a fork draft's thread: no approvals to answer, no jobs to cancel", () => {
  render(layout({ threadId: '$thread:example.org', readOnly: true }));

  expect(screen.queryByTestId('approval-queue')).toBeNull();
  expect(seen.approvals.at(-1)).toBeUndefined();
  expect(screen.getByTestId('jobs').dataset.canCancel).toBe('false');
});

it('shows only its children while collapsed', () => {
  const areaRef = createRef<HTMLDivElement>();
  render(
    layout({
      areaRef,
      collapsed: true,
      header: () => <div data-testid="header" />,
      children: <div data-testid="cover" />,
    })
  );

  expect(screen.getByTestId('cover')).toBeTruthy();
  expect(screen.queryByTestId('header')).toBeNull();
  expect(screen.queryByTestId('timeline')).toBeNull();
  expect(document.querySelector('[data-room-footer="true"]')).toBeNull();
  expect(areaRef.current?.style.flex).toBe('0 0 0px');
  expect(areaRef.current?.style.getPropertyValue('content-visibility')).toBe('hidden');
});

it("marks its header for the short screen's place, and for the banner's inside a thread", () => {
  const header = () => screen.getByTestId('header').parentElement as HTMLElement;
  const { rerender } = render(layout({ header: () => <div data-testid="header" /> }));
  expect(header().classList.contains(HeaderInShortArea)).toBe(true);
  expect(header().classList.contains(HeaderInThread)).toBe(false);
  rerender(layout({ threadId: '$root', header: () => <div data-testid="header" /> }));
  expect(header().classList.contains(HeaderInThread)).toBe(true);
});

it("keeps a phone's header inside a thread on a short screen: it is the thread's bar there", () => {
  render(
    <ScreenSizeProvider value={ScreenSize.Mobile}>
      {layout({ threadId: '$root', header: () => <div data-testid="header" /> })}
    </ScreenSizeProvider>
  );
  const header = screen.getByTestId('header').parentElement as HTMLElement;
  expect(header.classList.contains(HeaderInThread)).toBe(false);
  // Nor does a short area (a keyboard up) take it away: it holds the way back and the rename.
  expect(header.classList.contains(HeaderInShortArea)).toBe(false);
  cleanup();
  // The room's own header still gives its place away there.
  render(
    <ScreenSizeProvider value={ScreenSize.Mobile}>
      {layout({ header: () => <div data-testid="header" /> })}
    </ScreenSizeProvider>
  );
  expect(screen.getByTestId('header').parentElement?.classList.contains(HeaderInShortArea)).toBe(
    true
  );
});

it("raises only a phone thread's footer over the header while the composer holds the focus", () => {
  const header = () => <div data-testid="header" />;
  const raised = (size: ScreenSize, props: Parameters<typeof layout>[0]) => {
    cleanup();
    render(<ScreenSizeProvider value={size}>{layout(props)}</ScreenSizeProvider>);
    const footer = document.querySelector('[data-room-footer="true"]') as HTMLElement;
    return footer.classList.contains(FooterOverHeader);
  };
  expect(raised(ScreenSize.Mobile, { threadId: '$root', header })).toBe(true);
  // The room's own header is one row, which a short area hides; wider screens keep the card.
  expect(raised(ScreenSize.Mobile, { header })).toBe(false);
  expect(raised(ScreenSize.Mobile, { threadId: '$root' })).toBe(false);
  expect(raised(ScreenSize.Tablet, { threadId: '$root', header })).toBe(false);
  expect(raised(ScreenSize.Desktop, { threadId: '$root', header })).toBe(false);
});

it("hands a phone thread header's height changes to the timeline, which holds its reader, before the inset moves", () => {
  const resized: Array<() => void> = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized.push(callback);
      }

      observe = () => undefined;

      disconnect = () => undefined;
    }
  );
  const held: Array<{ inset?: string; change: number }> = [];
  function Timeline() {
    const hold = useContext(HeaderResizeHoldContext);
    useLayoutEffect(() => {
      if (!hold) return undefined;
      hold.current = (change, setInset) => {
        held.push({ inset: area.current?.style.getPropertyValue('--room-header-height'), change });
        setInset();
      };
      return () => {
        hold.current = undefined;
      };
    }, [hold]);
    return <div data-testid="held">{hold ? 'held' : 'free'}</div>;
  }
  const area = createRef<HTMLDivElement>();
  const phoneThread = (threadId?: string) => (
    <ScreenSizeProvider value={ScreenSize.Mobile}>
      {layout({
        areaRef: area,
        threadId,
        timeline: <Timeline />,
        header: () => <div data-testid="header" />,
      })}
    </ScreenSizeProvider>
  );
  let height = 110;
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => height);
  const setHeight = (next: number) => {
    height = next;
    act(() => resized.forEach((callback) => callback()));
  };
  render(phoneThread('$root'));
  expect(screen.getByTestId('held').textContent).toBe('held');
  // The first height is the inset as the thread opens: nothing moved under a reader.
  expect(held).toEqual([]);
  expect(area.current?.style.getPropertyValue('--room-header-height')).toBe('110px');
  // A resolver's line arrives, then goes: the timeline reads its place under the old inset.
  setHeight(134);
  setHeight(110);
  setHeight(110);
  expect(held).toEqual([
    { inset: '110px', change: 24 },
    { inset: '134px', change: -24 },
  ]);
  expect(area.current?.style.getPropertyValue('--room-header-height')).toBe('110px');
  cleanup();
  // The room's own messages on a phone, and a thread on wider screens, keep their own ways.
  render(phoneThread());
  expect(screen.getByTestId('held').textContent).toBe('free');
  cleanup();
  render(layout({ threadId: '$root', timeline: <Timeline /> }));
  expect(screen.getByTestId('held').textContent).toBe('free');
  vi.unstubAllGlobals();
});

it("gives a phone's header the open thread's approvals, which its chips read; wider screens keep them to the thread", () => {
  function Chips() {
    return <div data-testid="chips">{useThreadApprovals()?.threadId ?? 'none'}</div>;
  }
  const { rerender } = render(
    <ScreenSizeProvider value={ScreenSize.Mobile}>
      {layout({ threadId: '$root', header: () => <Chips /> })}
    </ScreenSizeProvider>
  );
  expect(screen.getByTestId('chips').textContent).toBe('$root');
  // The room's own messages have no thread, and so nothing to hand on.
  rerender(
    <ScreenSizeProvider value={ScreenSize.Mobile}>
      {layout({ header: () => <Chips /> })}
    </ScreenSizeProvider>
  );
  expect(screen.getByTestId('chips').textContent).toBe('none');
  cleanup();
  render(layout({ threadId: '$root', header: () => <Chips /> }));
  expect(screen.getByTestId('chips').textContent).toBe('none');
});

it("keeps the element a plugin's cover hides across a collapse, so the cover still holds it", () => {
  const conversationRef = createRef<HTMLDivElement>();
  const { rerender } = render(layout({ conversationRef }));
  const element = conversationRef.current;
  expect(element).not.toBeNull();
  rerender(layout({ conversationRef, collapsed: true }));
  rerender(layout({ conversationRef }));
  expect(conversationRef.current).toBe(element);
});
