// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { MatrixEvent } from 'matrix-js-sdk';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  crossRoomThreadIndexAtom,
  emptyCrossRoomThreadIndexSnapshot,
  type CrossRoomThreadIndexEntry,
} from '../cross-room/crossRoomThreadIndex';
import type { ThreadSignals } from '../cross-room/threadSignals';
import type { ThreadApprovalRecord } from '../../matrix/protocol/threadApprovalModel';
import { ScreenSize, ScreenSizeProvider } from '../../lib/hooks/useScreenSize';
import type { RegisteredPlugin } from '../../plugins/registry';
import type { ThreadListItem } from './threadGroups';
import { ThreadsNav } from './ThreadsNav';

const ME = '@alice:x';
const state = vi.hoisted(() => ({
  items: [] as ThreadListItem[],
  listsComplete: true,
  plugins: [] as RegisteredPlugin[],
  roots: new Map<string, MatrixEvent>(),
}));
vi.mock('../../plugins/registry', () => ({ registeredPlugins: state.plugins }));
vi.mock('./useThreadListItems', () => ({ useThreadListItems: () => state.items }));
vi.mock('./useJoinedRoomThreadLists', () => ({
  useJoinedRoomThreadLists: () => state.listsComplete,
}));
const mx = {
  getUserId: () => ME,
  getSafeUserId: () => ME,
  getRoom: (roomId: string) => ({
    roomId,
    getCanonicalAlias: () => null,
    membersLoaded: () => true,
    getThread: () => null,
    findEventById: (eventId: string) => state.roots.get(eventId),
  }),
};
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../../matrix/room', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../matrix/room')>()),
  getSenderName: (_room: unknown, userId: string) => (userId === '@tom:x' ? 'Tom' : userId),
  getMemberRawDisplayName: () => 'Code',
}));

const quiet: ThreadSignals = {
  mentionedMe: false,
  newCount: 0,
  newSenderIds: [],
  automation: false,
};

const item = (
  key: string,
  title: string,
  entry: Partial<CrossRoomThreadIndexEntry> = {},
  signals: Partial<ThreadSignals> = {}
): ThreadListItem => ({
  entry: {
    key,
    roomId: `!${key}:x`,
    roomName: 'Launch War Room',
    threadRootId: `$${key}`,
    rootSenderId: ME,
    isInvolved: true,
    isUnread: false,
    isResolved: false,
    lastActivityTs: Date.now() - 60_000,
    summaryText: title,
    rootPreviewText: '',
    searchableText: title.toLowerCase(),
    threadRecord: { status: { replyCount: 1, isStreaming: false }, presentation: {} },
    ...entry,
  } as CrossRoomThreadIndexEntry,
  signals: { ...quiet, ...signals },
});

function CurrentPath() {
  const { pathname, search } = useLocation();
  return <output aria-label="Current path">{`${pathname}${search}`}</output>;
}

const renderNav = (bootstrapped = true) => {
  const store = createStore();
  store.set(crossRoomThreadIndexAtom, { ...emptyCrossRoomThreadIndexSnapshot(), bootstrapped });
  return render(
    <Provider store={store}>
      <ScreenSizeProvider value={ScreenSize.Desktop}>
        <MemoryRouter initialEntries={['/threads/']}>
          <ThreadsNav />
          <CurrentPath />
        </MemoryRouter>
      </ScreenSizeProvider>
    </Provider>
  );
};

// The navigation column's scroller measures itself.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

const group = (name: string) => screen.getByRole('region', { name });

afterEach(() => {
  cleanup();
  localStorage.clear();
  state.items = [];
  state.plugins.splice(0);
  state.roots.clear();
});

describe('ThreadsNav', () => {
  it('groups the followed threads by state and previews the last reply', () => {
    state.items = [
      item(
        'ask',
        '🧪 Staging load test',
        {},
        { pendingApproval: { eventId: '$a' } as ThreadApprovalRecord }
      ),
      item(
        'new',
        '✉️ Launch email draft',
        {},
        {
          newCount: 2,
          mentionedMe: true,
          lastReply: {
            eventId: '$r',
            senderId: '@tom:x',
            ts: 1,
            preview: { kind: 'text', text: '+1' },
            event: { sender: '@tom:x', content: {} },
          },
        }
      ),
      item('run', '📝 Minutes', {
        threadRecord: { status: { replyCount: 1, isStreaming: true }, presentation: {} },
      } as never),
      item('old', '📊 Q3 churn'),
    ];
    renderNav();
    expect(within(group('Needs you')).getByText('🧪 Staging load test')).toBeTruthy();
    expect(within(group('Needs you')).getByText('Approval')).toBeTruthy();
    const unread = group('Unread');
    expect(within(unread).getByText('Tom: +1')).toBeTruthy();
    expect(within(unread).getByText('Mentions you')).toBeTruthy();
    expect(within(unread).getByText('2')).toBeTruthy();
    expect(within(group('Agents working')).getByText('📝 Minutes')).toBeTruthy();
    expect(within(group('Recent')).getByText('📊 Q3 churn')).toBeTruthy();
  });

  it('switches between Mine, Following and All, and remembers the choice', () => {
    state.items = [
      item('mine', 'Mine thread'),
      item('theirs', 'Their thread', { rootSenderId: '@bob:x' }),
      item('room', 'Room thread', { rootSenderId: '@bob:x', isInvolved: false }),
    ];
    renderNav();
    expect(screen.queryByText('Room thread')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Mine' }));
    expect(screen.queryByText('Their thread')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    expect(screen.getByText('Room thread')).toBeTruthy();
    expect(localStorage.getItem(`threadsScope:${ME}`)).toBe('"all"');
  });

  it('searches the threads', () => {
    state.items = [item('a', 'Staging deploy'), item('b', 'Board deck')];
    renderNav();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search threads' }), {
      target: { value: 'deck' },
    });
    expect(screen.queryByText('Staging deploy')).toBeNull();
    expect(screen.getByText('Board deck')).toBeTruthy();
  });

  it('shows 50 recent threads at a time', () => {
    state.items = Array.from({ length: 60 }, (_, index) =>
      item(`t${index}`, `Thread ${index}`, { lastActivityTs: 1_000_000 - index })
    );
    renderNav();
    expect(screen.queryByText('Thread 55')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(screen.getByText('Thread 55')).toBeTruthy();
  });

  it('folds the automations under All', () => {
    state.items = [
      item(
        'digest',
        'Daily digest',
        { rootSenderId: '@mindroom_bot:x', isInvolved: false },
        { automation: true }
      ),
    ];
    renderNav();
    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    const toggle = screen.getByRole('button', { name: /Automations/ });
    expect(screen.queryByText('Daily digest')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText('Daily digest')).toBeTruthy();
  });

  it('folds the snoozed threads before the automations, each fold on its own', () => {
    state.items = [
      item(
        'digest',
        'Daily digest',
        { rootSenderId: '@mindroom_bot:x', isInvolved: false },
        { automation: true }
      ),
      item('later', 'Revisit pricing', { snoozedUntilTs: Date.now() + 3600_000 }),
    ];
    renderNav();
    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    const snoozed = screen.getByRole('button', { name: /Snoozed/ });
    const automations = screen.getByRole('button', { name: /Automations/ });
    expect(
      snoozed.compareDocumentPosition(automations) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.queryByText('Revisit pricing')).toBeNull();
    fireEvent.click(snoozed);
    expect(screen.getByText('Revisit pricing')).toBeTruthy();
    expect(screen.queryByText('Daily digest')).toBeNull();
    expect(snoozed.getAttribute('aria-expanded')).toBe('true');
    expect(automations.getAttribute('aria-expanded')).toBe('false');
  });

  it('moves a snoozed thread back to Recent when its time passes', () => {
    vi.useFakeTimers();
    try {
      state.items = [item('later', 'Revisit pricing', { snoozedUntilTs: Date.now() + 60_000 })];
      renderNav();
      expect(screen.queryByText('Revisit pricing')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(within(group('Recent')).getByText('Revisit pricing')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows "Snoozed until ..." on a snoozed row, and nothing once its time passes', () => {
    vi.useFakeTimers();
    try {
      state.items = [item('later', 'Revisit pricing', { snoozedUntilTs: Date.now() + 3600_000 })];
      const { container } = renderNav();
      fireEvent.click(screen.getByRole('radio', { name: 'All' }));
      fireEvent.click(screen.getByRole('button', { name: /Snoozed/ }));
      expect(container.querySelector('[data-thread-snoozed]')?.textContent).toMatch(
        /^Snoozed until /
      );
      act(() => {
        vi.advanceTimersByTime(3600_000);
      });
      expect(container.querySelector('[data-thread-snoozed]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a resolved and snoozed thread as resolved only', () => {
    state.items = [
      item('done', 'Revisit pricing', { snoozedUntilTs: Date.now() + 3600_000, isResolved: true }),
    ];
    const { container } = renderNav();
    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    // It stays with the other quiet threads; no Snoozed group takes it.
    expect(screen.queryByRole('button', { name: /Snoozed/ })).toBeNull();
    expect(screen.getByText('Revisit pricing')).toBeTruthy();
    expect(container.querySelector('[data-thread-snoozed]')).toBeNull();
    expect(container.textContent).not.toContain('Snoozed until');
  });

  it('opens a thread beside the list', () => {
    state.items = [item('t', 'Launch email draft')];
    renderNav();
    fireEvent.click(screen.getByText('Launch email draft'));
    expect(screen.getByRole('status', { name: 'Current path' }).textContent).toBe(
      '/threads/!t%3Ax?threadId=%24t'
    );
  });

  it('names the user as You in a preview', () => {
    state.items = [
      item(
        'own',
        'My thread',
        {},
        {
          lastReply: {
            eventId: '$m',
            senderId: ME,
            ts: 1,
            preview: { kind: 'text', text: 'done' },
            event: { sender: ME, content: {} },
          },
        }
      ),
    ];
    renderNav();
    expect(screen.getByText('You: done')).toBeTruthy();
  });

  it("previews a reply, and titles a thread without an AI title, with the plugin's preview", () => {
    const content = { msgtype: 'm.text', body: 'Hello there', 'com.example.greeting': {} };
    state.plugins.push({
      id: 'example',
      tag: 'example@1.0.0',
      messageRenderers: [
        {
          match: () => true,
          Component: () => null,
          preview: (event: { eventId: string }) => `Card ${event.eventId}`,
          trust: 'server',
        },
      ],
    } as unknown as RegisteredPlugin);
    state.items = [
      item(
        'card',
        'Card thread',
        {},
        {
          lastReply: {
            eventId: '$c',
            senderId: '@tom:x',
            ts: 1,
            preview: { kind: 'text', text: 'Hello there' },
            event: { eventId: '$c', sender: '@tom:x', content },
          },
        }
      ),
      item('root', 'Root body'),
    ];
    state.roots.set(
      '$root',
      new MatrixEvent({ event_id: '$root', type: 'm.room.message', sender: '@tom:x', content })
    );
    renderNav();
    expect(screen.getByText('Tom: Card $c')).toBeTruthy();
    expect(screen.getByText('Card $root')).toBeTruthy();
    expect(screen.queryByText('Root body')).toBeNull();
  });

  it('writes out direction controls in titles, previews and room names', () => {
    state.items = [
      item(
        'bidi',
        'Plan\u202eevil',
        { roomName: 'Room\u202eodd' },
        {
          lastReply: {
            eventId: '$b',
            senderId: '@tom:x',
            ts: 1,
            preview: { kind: 'text', text: 'a\u202eb' },
            event: { sender: '@tom:x', content: {} },
          },
        }
      ),
    ];
    renderNav();
    expect(screen.getByText('Plan<U+202E>evil')).toBeTruthy();
    expect(screen.getByText('Tom: a<U+202E>b')).toBeTruthy();
    expect(screen.getByText('Room<U+202E>odd')).toBeTruthy();
  });

  it('falls back to the index preview of the newest reply, never the root', () => {
    state.items = [
      item('summary', 'Summary only', {
        rootPreviewText: 'The root text',
        threadRecord: {
          status: { replyCount: 2, isStreaming: false },
          presentation: { latestReplyPreviewText: 'Older reply', lastSenderId: '@tom:x' },
        },
      } as never),
    ];
    renderNav();
    expect(screen.getByText('Tom: Older reply')).toBeTruthy();
    expect(screen.queryByText(/The root text/)).toBeNull();
  });

  it('says it is loading, not that nothing is there, until the thread index has loaded', () => {
    state.items = [];
    renderNav(false);
    expect(screen.getByText('Loading threads')).toBeTruthy();
    expect(screen.queryByText('No threads here yet')).toBeNull();
  });

  it('says it is loading while the rooms still load their thread lists', () => {
    state.items = [];
    state.listsComplete = false;
    renderNav();
    expect(screen.getByText('Loading threads')).toBeTruthy();
    state.listsComplete = true;
  });

  it('says when there is nothing to list', () => {
    renderNav();
    expect(screen.getByText('No threads here yet')).toBeTruthy();
  });
});
