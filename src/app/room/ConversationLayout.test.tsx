// @vitest-environment jsdom
import { createRef, type ReactNode, type RefObject } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { createClient, Room } from 'matrix-js-sdk';
import { afterEach, expect, it, vi } from 'vitest';
import { ConversationLayout } from './ConversationLayout';

const mx = createClient({ baseUrl: 'https://matrix.example.org', userId: '@alice:example.org' });
const room = new Room('!room:example.org', mx, '@alice:example.org');

const seen = vi.hoisted(() => ({
  jobs: [] as (string | null)[],
  approvals: [] as (string | undefined)[],
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
  BackgroundJobsBar: ({ threadId }: { threadId: string | null }) => {
    seen.jobs.push(threadId);
    return <div data-testid="jobs" />;
  },
}));
vi.mock('../approvals/ThreadApprovalProvider', () => ({
  ThreadApprovalProvider: ({ threadId, children }: { threadId?: string; children: ReactNode }) => {
    seen.approvals.push(threadId);
    return <>{children}</>;
  },
}));
vi.mock('../approvals/ThreadApprovalControls', () => ({
  ThreadApprovalQueue: () => <div data-testid="approval-queue" />,
}));

afterEach(() => {
  cleanup();
  seen.jobs = [];
  seen.approvals = [];
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
  const footer = document.querySelector('[data-room-footer="true"]');
  expect([...(footer?.children ?? [])].map((child) => child.getAttribute('data-testid'))).toEqual([
    'typing',
    'notice',
    'composer',
    'following',
  ]);
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
