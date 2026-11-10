// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
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
import type { ThreadListItem } from './threadGroups';
import { ThreadsNav } from './ThreadsNav';

const ME = '@alice:x';
const state = vi.hoisted(() => ({ items: [] as ThreadListItem[] }));
vi.mock('./useThreadListItems', () => ({ useThreadListItems: () => state.items }));
vi.mock('./useJoinedRoomThreadLists', () => ({ useJoinedRoomThreadLists: () => undefined }));
const mx = {
  getUserId: () => ME,
  getSafeUserId: () => ME,
  getRoom: (roomId: string) => ({
    roomId,
    getCanonicalAlias: () => null,
    membersLoaded: () => true,
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
    threadRecord: { status: { replyCount: 1, isStreaming: false } },
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
          },
        }
      ),
      item('run', '📝 Minutes', {
        threadRecord: { status: { replyCount: 1, isStreaming: true } },
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
          },
        }
      ),
    ];
    renderNav();
    expect(screen.getByText('You: done')).toBeTruthy();
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

  it('says when there is nothing to list', () => {
    renderNav();
    expect(screen.getByText('No threads here yet')).toBeTruthy();
  });
});
