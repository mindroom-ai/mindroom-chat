// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CrossRoomThreadIndexEntry } from '../threads/cross-room/crossRoomThreadIndex';
import type { ThreadApprovalRecord } from '../matrix/protocol/threadApprovalModel';
import type { ThreadSignals } from '../threads/cross-room/threadSignals';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { allInvitesAtom } from '../matrix/state/inviteList';
import type { ActivityRow, ActivityRowsResult } from './activityRows';
import { activityRowsAtom, activityShowAutomationsAtom } from './activityState';
import { ActivityList } from './ActivityList';

const NAMES: Record<string, string> = {
  '@mindroom_code:x': 'Code',
  '@mindroom_mind:x': 'Mind',
  '@maya:x': 'Maya Chen',
  '@tom:x': 'Tom Becker',
};

const mocks = vi.hoisted(() => ({
  answerApproval: vi.fn(),
  answerQuestion: vi.fn(),
  markActivityRowsRead: vi.fn(async () => undefined),
  rooms: new Map<
    string,
    {
      roomId: string;
      name: string;
      getCanonicalAlias: () => null;
      membersLoaded: () => boolean;
      getJoinedMembers: () => { userId: string; name: string }[];
    }
  >(),
}));

vi.mock('./activityActions', () => ({
  answerApproval: mocks.answerApproval,
  answerQuestion: mocks.answerQuestion,
  markActivityRowsRead: mocks.markActivityRowsRead,
}));

const mx = {
  getUserId: () => '@alice:x',
  getSafeUserId: () => '@alice:x',
  getRoom: (roomId: string) => mocks.rooms.get(roomId) ?? null,
};
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../matrix/hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('../matrix/room', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../matrix/room')>()),
  getSenderName: (_room: unknown, userId: string) => NAMES[userId] ?? userId,
  getMemberRawDisplayName: (_room: unknown, userId: string) => NAMES[userId],
  getMemberAvatarMxc: () => undefined,
}));

const NOW = Date.now();
const quiet: ThreadSignals = {
  mentionedMe: false,
  newCount: 0,
  newSenderIds: [],
  automation: false,
};

const threadRow = (
  key: string,
  kind: ActivityRow['kind'],
  signals: Partial<ThreadSignals>,
  extra: Partial<{ unread: boolean; actorIds: string[]; title: string }> = {}
): ActivityRow => {
  const roomId = `!${key}:x`;
  mocks.rooms.set(roomId, {
    roomId,
    name: 'Launch War Room',
    getCanonicalAlias: () => null,
    membersLoaded: () => true,
    getJoinedMembers: () => [{ userId: '@mindroom_code:x', name: 'Code' }],
  });
  return {
    type: 'thread',
    key,
    kind: kind as Exclude<ActivityRow['kind'], 'invite'>,
    entry: {
      key,
      roomId,
      roomName: 'Launch War Room',
      threadRootId: `$${key}-root`,
      summaryText: extra.title ?? `Thread ${key}`,
      rootPreviewText: '',
      threadRecord: { presentation: {}, status: {} },
    } as unknown as CrossRoomThreadIndexEntry,
    signals: { ...quiet, ...signals },
    unread: extra.unread ?? true,
    ts: NOW - 60_000,
    actorIds: extra.actorIds ?? [],
  };
};

const approvalRecord = {
  eventId: '$ask',
  sender: '@mindroom_router:x',
  approval: {
    agentName: 'code',
    toolName: 'run_shell_command',
    arguments: { command: 'npm run deploy:staging' },
    approvable: true,
  },
} as unknown as ThreadApprovalRecord;

const question = {
  eventId: '$q',
  senderId: '@mindroom_mind:x',
  text: 'Which deck should I polish?',
  options: [
    { key: '✅', label: 'v3 final' },
    { key: '📄', label: 'v4 draft' },
  ],
};

const ROWS: ActivityRow[] = [
  // The router posts approval cards; the row names the agent that asks.
  threadRow(
    'a',
    'approval',
    { pendingApproval: approvalRecord },
    { actorIds: ['@mindroom_router:x'] }
  ),
  threadRow('q', 'question', { pendingQuestion: question }, { actorIds: ['@mindroom_mind:x'] }),
  threadRow(
    'm',
    'mention',
    {
      mentionedMe: true,
      newCount: 2,
      lastReply: {
        eventId: '$r',
        senderId: '@tom:x',
        ts: NOW,
        preview: { kind: 'text', text: '+1, the v2 opener is stronger' },
      },
    },
    { actorIds: ['@maya:x', '@tom:x'], title: '✉️ Launch email draft' }
  ),
  threadRow(
    'read',
    'reply',
    {
      lastReply: {
        eventId: '$x',
        senderId: '@mindroom_mind:x',
        ts: NOW,
        preview: { kind: 'voice' },
      },
    },
    { unread: false, actorIds: ['@mindroom_mind:x'] }
  ),
];

function CurrentPath() {
  const { pathname, search } = useLocation();
  return <output aria-label="Current path">{`${pathname}${search}`}</output>;
}

const renderList = (result: ActivityRowsResult) => {
  const store = createStore();
  store.set(activityRowsAtom, result);
  render(
    <Provider store={store}>
      <ScreenSizeProvider value={ScreenSize.Desktop}>
        <MemoryRouter initialEntries={['/home/']}>
          <ActivityList variant="page" />
          <CurrentPath />
        </MemoryRouter>
      </ScreenSizeProvider>
    </Provider>
  );
  return store;
};

const rowByTitle = (title: string) =>
  screen.getByText(title).closest('[data-activity-row]') as HTMLElement;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ActivityList', () => {
  it('says what happened, in which thread and room', () => {
    renderList({ rows: ROWS, hiddenAutomations: 0 });
    expect(screen.getByText('Code needs approval')).toBeTruthy();
    expect(screen.getByText('Mind asked you')).toBeTruthy();
    const mention = rowByTitle('✉️ Launch email draft');
    expect(within(mention).getByText('Maya Chen mentioned you, Tom Becker replied')).toBeTruthy();
    expect(within(mention).getByText('2 new')).toBeTruthy();
    expect(within(mention).getByText('+1, the v2 opener is stronger')).toBeTruthy();
    expect(within(rowByTitle('Thread read')).getByText('Voice message')).toBeTruthy();
  });

  it('approves in the row and tells when sending fails', async () => {
    let reject: (error: Error) => void = () => undefined;
    mocks.answerApproval.mockImplementation(
      () => new Promise<void>((_resolve, fail) => (reject = fail))
    );
    renderList({ rows: ROWS, hiddenAutomations: 0 });
    fireEvent.click(within(rowByTitle('Thread a')).getByRole('button', { name: 'Approve' }));
    expect(mocks.answerApproval).toHaveBeenCalledWith(mx, '!a:x', approvalRecord, 'approved');
    expect(within(rowByTitle('Thread a')).getByText('Sending…')).toBeTruthy();
    await act(async () => reject(new Error('offline')));
    expect(within(rowByTitle('Thread a')).getByText("Couldn't send. Try again.")).toBeTruthy();
  });

  it('offers the next waiting approval of a thread once the first is answered', async () => {
    mocks.answerApproval.mockResolvedValue(undefined);
    const store = renderList({ rows: ROWS, hiddenAutomations: 0 });
    await act(async () =>
      fireEvent.click(within(rowByTitle('Thread a')).getByRole('button', { name: 'Approve' }))
    );
    expect(within(rowByTitle('Thread a')).getByText('Approved')).toBeTruthy();
    const next = { ...approvalRecord, eventId: '$ask-earlier' } as ThreadApprovalRecord;
    const [first, ...rest] = ROWS;
    const moved = first as Extract<ActivityRow, { type: 'thread' }>;
    act(() =>
      store.set(activityRowsAtom, {
        rows: [{ ...moved, signals: { ...moved.signals, pendingApproval: next } }, ...rest],
        hiddenAutomations: 0,
      })
    );
    expect(within(rowByTitle('Thread a')).getByRole('button', { name: 'Approve' })).toBeTruthy();
  });

  it('answers a question with the option picked', async () => {
    mocks.answerQuestion.mockResolvedValue(undefined);
    renderList({ rows: ROWS, hiddenAutomations: 0 });
    await act(async () =>
      fireEvent.click(within(rowByTitle('Thread q')).getByRole('button', { name: 'v3 final' }))
    );
    expect(mocks.answerQuestion).toHaveBeenCalledWith(
      mx,
      mocks.rooms.get('!q:x'),
      '$q-root',
      question,
      '✅'
    );
    expect(within(rowByTitle('Thread q')).getByText('Answered: v3 final')).toBeTruthy();
  });

  it('keeps each tab to its rows and hides read rows when asked', () => {
    renderList({ rows: ROWS, hiddenAutomations: 0 });
    fireEvent.click(screen.getByRole('tab', { name: 'Mentions' }));
    expect(screen.queryByText('Code needs approval')).toBeNull();
    expect(screen.getByText('✉️ Launch email draft')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    expect(screen.getByText('Thread read')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Unread' }));
    expect(screen.queryByText('Thread read')).toBeNull();
  });

  it('counts the hidden automation runs and shows them on request', () => {
    const store = renderList({ rows: ROWS, hiddenAutomations: 3 });
    expect(screen.getByText('3 automation runs hidden')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(store.get(activityShowAutomationsAtom)).toBe(true);
  });

  it('opens a row in the Activity section', () => {
    renderList({ rows: ROWS, hiddenAutomations: 0 });
    fireEvent.click(screen.getByText('✉️ Launch email draft'));
    expect(screen.getByRole('status', { name: 'Current path' }).textContent).toBe(
      '/activity/!m%3Ax?threadId=%24m-root'
    );
  });

  it('marks the unread rows read', () => {
    renderList({ rows: ROWS, hiddenAutomations: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(mocks.markActivityRowsRead).toHaveBeenCalledWith(mx, ROWS, false);
  });

  it('says You replied when the user wrote last', () => {
    renderList({
      rows: [threadRow('own', 'reply', {}, { unread: false, actorIds: ['@alice:x'] })],
      hiddenAutomations: 0,
    });
    expect(screen.getByText('You replied')).toBeTruthy();
  });

  it('writes out direction controls in titles, previews and room names', () => {
    const row = threadRow(
      'bidi',
      'reply',
      {
        lastReply: {
          eventId: '$b',
          senderId: '@tom:x',
          ts: NOW,
          preview: { kind: 'text', text: 'see invoice\u202etxt.exe' },
        },
      },
      { unread: false, actorIds: ['@tom:x'], title: 'Plan\u202eevil' }
    );
    if (row.type === 'thread') row.entry.roomName = 'Room\u202eodd';
    renderList({ rows: [row], hiddenAutomations: 0 });
    expect(screen.getByText('Plan<U+202E>evil')).toBeTruthy();
    expect(screen.getByText('see invoice<U+202E>txt.exe')).toBeTruthy();
    expect(screen.getByText('Room<U+202E>odd')).toBeTruthy();
  });

  it('shows no time for an invite whose time is unknown', () => {
    mocks.rooms.set('!inv:x', {
      roomId: '!inv:x',
      name: 'Partner Pilot',
      getCanonicalAlias: () => null,
      membersLoaded: () => true,
      getJoinedMembers: () => [],
    });
    renderList({
      rows: [
        {
          type: 'invite',
          key: 'invite:!inv:x',
          kind: 'invite',
          roomId: '!inv:x',
          unread: true,
          ts: 0,
        },
      ],
      hiddenAutomations: 0,
    });
    const row = screen.getByText('Partner Pilot').closest('[data-activity-row]') as HTMLElement;
    expect(row.textContent).not.toMatch(/1969|1970/);
  });

  it('keeps the invite list in reach when every pending invite is one Activity leaves out', () => {
    const store = renderList({ rows: [], hiddenAutomations: 0 });
    act(() => store.set(allInvitesAtom, { type: 'INITIALIZE', rooms: ['!spam:x'] }));
    fireEvent.click(screen.getByRole('button', { name: 'All invites' }));
    expect(screen.getByLabelText('Current path').textContent).toBe('/activity/invites/');
  });

  it('says when nothing is left', () => {
    renderList({ rows: [], hiddenAutomations: 0 });
    expect(screen.getByText("You're all caught up")).toBeTruthy();
  });
});
