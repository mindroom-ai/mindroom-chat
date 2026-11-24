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
} from '../threads/cross-room/crossRoomThreadIndex';
import type { ThreadApprovalRecord } from '../matrix/protocol/threadApprovalModel';
import type { ThreadSignals } from '../threads/cross-room/threadSignals';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { ClientConfigProvider, type ClientConfig } from '../config/useClientConfig';
import type { RegisteredPlugin } from '../plugins/registry';
import { allInvitesAtom } from '../matrix/state/inviteList';
import { buildActivityRows, type ActivityRow, type ActivityRowsResult } from './activityRows';
import { activityRowsAtom, activityShowAutomationsAtom } from './activityState';
import { ActivityList } from './ActivityList';
import { standInForListMotion } from '../ui/__tests__/listMotionStandIn';
import * as css from './ActivityList.css';

const NAMES: Record<string, string> = {
  '@mindroom_code:x': 'Code',
  '@mindroom_mind:x': 'Mind',
  '@maya:x': 'Maya Chen',
  '@tom:x': 'Tom Becker',
  '@sam:x': 'Sam Rivera',
  // A name of invisible characters only, as spam invites use.
  '@ghost:x': '\u200b\u200b',
};

const mocks = vi.hoisted(() => ({
  plugins: [] as RegisteredPlugin[],
  roots: new Map<string, unknown>(),
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
      loadMembersIfNeeded?: () => Promise<void>;
      getJoinedMembers: () => { userId: string; name: string }[];
      // A thread row's room: the row reads the thread's root.
      getThread?: () => null;
      findEventById?: (eventId: string) => unknown;
    }
  >(),
}));

vi.mock('../plugins/registry', () => ({ registeredPlugins: mocks.plugins }));

vi.mock('./activityActions', () => ({
  answerApproval: mocks.answerApproval,
  markActivityRowsRead: mocks.markActivityRowsRead,
}));
vi.mock('../messages/reactions/answerQuestion', () => ({ answerQuestion: mocks.answerQuestion }));

const mx = {
  getUserId: () => '@alice:x',
  getSafeUserId: () => '@alice:x',
  getRoom: (roomId: string) => mocks.rooms.get(roomId) ?? null,
};
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../matrix/hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('../matrix/room', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../matrix/room')>()),
  // Sam invited the user to a room whose members are not known: the full name carries the ID.
  getSenderName: (_room: unknown, userId: string) =>
    userId === '@sam:x' ? 'Sam Rivera (@sam:x)' : (NAMES[userId] ?? userId),
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
    getThread: () => null,
    findEventById: (eventId: string) => mocks.roots.get(eventId),
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
    argumentsTruncated: false,
    argumentSource: null,
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
      mentionedBy: '@maya:x',
      newCount: 2,
      lastOtherReply: {
        eventId: '$r',
        senderId: '@tom:x',
        ts: NOW,
        preview: { kind: 'text', text: '+1, the v2 opener is stronger' },
        event: { sender: '@tom:x', content: {} },
      },
    },
    { actorIds: ['@maya:x', '@tom:x'], title: '✉️ Launch email draft' }
  ),
  threadRow(
    'read',
    'reply',
    {
      lastOtherReply: {
        eventId: '$x',
        senderId: '@mindroom_mind:x',
        ts: NOW,
        preview: { kind: 'voice' },
        event: { sender: '@mindroom_mind:x', content: {} },
      },
    },
    { unread: false, actorIds: ['@mindroom_mind:x'] }
  ),
];

function CurrentPath() {
  const { pathname, search } = useLocation();
  return <output aria-label="Current path">{`${pathname}${search}`}</output>;
}

const renderList = (
  result: ActivityRowsResult,
  bootstrapped = true,
  config: ClientConfig = {},
  variant: 'page' | 'sheet' = 'page',
  initialPath = '/home/'
) => {
  const store = createStore();
  // As `ActivityRowsFeature` publishes them: the rows say whether the index was still loading.
  store.set(activityRowsAtom, bootstrapped ? result : { ...result, loading: true });
  store.set(crossRoomThreadIndexAtom, { ...emptyCrossRoomThreadIndexSnapshot(), bootstrapped });
  render(
    <Provider store={store}>
      <ClientConfigProvider value={config}>
        <ScreenSizeProvider value={ScreenSize.Desktop}>
          <MemoryRouter initialEntries={[initialPath]}>
            <ActivityList variant={variant} />
            <CurrentPath />
          </MemoryRouter>
        </ScreenSizeProvider>
      </ClientConfigProvider>
    </Provider>
  );
  return store;
};

const replies = (prefix: string, count: number): ActivityRow[] =>
  Array.from({ length: count }, (_, index) =>
    threadRow(`${prefix}${index}`, 'reply', { newCount: 1 }, { actorIds: ['@mindroom_code:x'] })
  );

const listItems = () => within(screen.getByRole('list')).getAllByRole('listitem');

/** An IntersectionObserver that reports only what the test delivers with `intersect`. */
const standInForIntersectionObserver = () => {
  const observers: { callback: IntersectionObserverCallback; live: boolean }[] = [];
  class FakeIntersectionObserver {
    live = true;

    observe = vi.fn();

    unobserve = vi.fn();

    disconnect = vi.fn(() => {
      this.live = false;
    });

    constructor(public callback: IntersectionObserverCallback) {
      observers.push(this);
    }
  }
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  /** Delivers an intersection to `observer`, by default to the one that still observes. */
  const intersect = (observer = observers.findLast((candidate) => candidate.live)!) =>
    act(() =>
      observer.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        observer as unknown as IntersectionObserver
      )
    );
  return { observers, intersect };
};

const rowByTitle = (title: string) =>
  screen.getByText(title).closest('[data-activity-row]') as HTMLElement;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mocks.plugins.splice(0);
  mocks.roots.clear();
});

const GREETING = { msgtype: 'm.text', body: 'Hello there', 'com.example.greeting': { text: 'Hi' } };

/** A plugin that renders greetings as cards, and previews them as "Greeting: <text>". */
const greetingPlugin = (preview: (text: string) => string = (text) => `Greeting: ${text}`) =>
  ({
    id: 'example',
    tag: 'example@1.0.0',
    defaultEnabled: true,
    messageRenderers: [
      {
        match: (event: { content: Record<string, unknown> }) =>
          'com.example.greeting' in event.content,
        Component: () => null,
        preview: (event: { content: Record<string, unknown> }) =>
          preview((event.content['com.example.greeting'] as { text: string }).text),
      },
    ],
  }) as unknown as RegisteredPlugin;

/** A row whose newest reply is `sender`'s greeting. */
const greetingRow = (key: string, sender: string) =>
  threadRow(key, 'reply', {
    newCount: 1,
    lastOtherReply: {
      eventId: `$${key}-reply`,
      senderId: sender,
      ts: NOW,
      preview: { kind: 'text', text: 'Hello there' },
      event: { eventId: `$${key}-reply`, type: 'm.room.message', sender, content: GREETING },
    },
  });

describe('ActivityList', () => {
  it('fades a row that left where it stood while the rows under it close the gap', () => {
    const motion = standInForListMotion();
    try {
      const store = renderList({ rows: ROWS, hiddenAutomations: 0 });
      act(() =>
        store.set(activityRowsAtom, {
          rows: ROWS.filter((row) => row.key !== 'q'),
          hiddenAutomations: 0,
        })
      );

      expect(motion.left().map((row) => row.textContent)).toEqual([
        expect.stringContaining('Mind asked you'),
      ]);
      expect(motion.glided()).toContain('m');
      // A day's divider is a row too, so it moves with the rows under it.
      expect(document.querySelector('[data-motion-row^="day:"]')).not.toBeNull();
    } finally {
      motion.restore();
    }
  });

  it('glides a row that no longer waits and keeps its place in the order', () => {
    const motion = standInForListMotion();
    try {
      const mention = ROWS.filter((row) => row.key === 'm');
      const store = renderList({
        rows: [threadRow('q', 'question', { pendingQuestion: question }), ...mention],
        hiddenAutomations: 0,
      });
      // Answered: it is still the first row, now under the day's divider.
      act(() =>
        store.set(activityRowsAtom, {
          rows: [threadRow('q', 'reply', {}), ...mention],
          hiddenAutomations: 0,
        })
      );

      expect(motion.glided()).toContain('q');
    } finally {
      motion.restore();
    }
  });

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

  it('names a background approval without a sender and seeds its avatar with the row key', () => {
    const job = threadRow('job', 'approval', {}) as Extract<ActivityRow, { type: 'thread' }>;
    job.entry.threadRecord.status.hasBackgroundApproval = true;
    job.entry.lastActivityTs = job.ts;
    renderList(
      buildActivityRows({
        entries: [job.entry],
        signals: () => quiet,
        invites: [],
        now: NOW,
        showAutomations: false,
      })
    );
    expect.soft(screen.queryByText('A background job needs approval')).not.toBeNull();
    expect(
      rowByTitle('Thread job')
        .querySelector('[data-avatar-fallback-id]')
        ?.getAttribute('data-avatar-fallback-id')
    ).toBe(job.key);
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
    const next = { ...approvalRecord, eventId: '$ask-earlier' };
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

  it('shows what an approval runs beside its Approve button, also array arguments', () => {
    const listing = {
      ...approvalRecord,
      approval: {
        ...approvalRecord.approval,
        arguments: { args: ['rm', '-rf', '/workspace/reports'] },
      },
    } as unknown as ThreadApprovalRecord;
    renderList({
      rows: [threadRow('arr', 'approval', { pendingApproval: listing }, { actorIds: [] })],
      hiddenAutomations: 0,
    });
    const row = rowByTitle('Thread arr');
    expect(row.textContent).toContain('/workspace/reports');
    expect(within(row).getByRole('button', { name: /Show all arguments/ })).toBeTruthy();
  });

  it('answers a question with the option picked', async () => {
    mocks.answerQuestion.mockResolvedValue(undefined);
    renderList({ rows: ROWS, hiddenAutomations: 0 });
    const option = within(rowByTitle('Thread q')).getByRole('button', { name: 'v3 final' });
    // A long option wraps, and its button grows instead of spilling over its neighbours.
    expect(option.className).toContain(css.ActionButton);
    await act(async () => fireEvent.click(option));
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

  it('marks the row of the thread shown beside the list', () => {
    renderList({ rows: ROWS, hiddenAutomations: 0 });
    const current = () => document.querySelectorAll('[aria-current="page"]');
    expect(current()).toHaveLength(0);
    fireEvent.click(screen.getByText('✉️ Launch email draft'));
    expect(current()).toHaveLength(1);
    expect(rowByTitle('✉️ Launch email draft').contains(current()[0] ?? null)).toBe(true);
  });

  it('marks the unread rows read', () => {
    renderList({ rows: ROWS, hiddenAutomations: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(mocks.markActivityRowsRead).toHaveBeenCalledWith(mx, ROWS, false);
  });

  it('previews an agent reply with its tool calls as a count', () => {
    // The stored text is the source's; the row writes the tool count in the user's language.
    const text = 'stored preview';
    renderList({
      rows: [
        threadRow('tools', 'reply', {
          newCount: 1,
          lastOtherReply: {
            eventId: '$t',
            senderId: '@mindroom_mind:x',
            ts: NOW,
            preview: {
              kind: 'text',
              text,
              localization: { kind: 'tools', count: 2, prose: 'Here is the reply' },
            },
            event: { sender: '@mindroom_mind:x', content: {} },
          },
        }),
      ],
      hiddenAutomations: 0,
    });
    expect(
      within(rowByTitle('Thread tools')).getByText('🔧 2 tools · Here is the reply')
    ).toBeTruthy();
  });

  it('gives a run that stopped within a minute no duration, only its tools', () => {
    renderList({
      rows: [
        threadRow(
          'stop',
          'stopped',
          {
            outcome: {
              kind: 'stopped',
              senderId: '@mindroom_code:x',
              ts: NOW,
              durationMs: 3000,
              toolCount: 2,
            },
          },
          { actorIds: ['@mindroom_code:x'] }
        ),
      ],
      hiddenAutomations: 0,
    });
    const row = rowByTitle('Thread stop');
    expect(row.textContent).toContain('2 tools');
    expect(row.textContent).not.toMatch(/\bmin\b/);
  });

  it('names no one as the mentioner when only the highlight count tells of the mention', () => {
    renderList({
      rows: [
        threadRow(
          'hl',
          'mention',
          { mentionedMe: true, newCount: 1, newSenderIds: ['@mindroom_mind:x'] },
          { actorIds: ['@mindroom_mind:x'] }
        ),
      ],
      hiddenAutomations: 0,
    });
    const row = rowByTitle('Thread hl');
    expect(row.textContent).toContain('You were mentioned');
    expect(row.textContent).not.toContain('Mind mentioned you');
  });

  it("previews the other sender's reply and omits You replied when the user wrote last", () => {
    renderList({
      rows: [
        threadRow(
          'own',
          'reply',
          {
            lastReply: {
              eventId: '$mine',
              senderId: '@alice:x',
              ts: NOW,
              preview: { kind: 'text', text: 'My own follow-up' },
              event: { sender: '@alice:x', content: {} },
            },
            lastOtherReply: {
              eventId: '$tom',
              senderId: '@tom:x',
              ts: NOW - 60_000,
              preview: { kind: 'text', text: 'Tom left an update' },
              event: { sender: '@tom:x', content: {} },
            },
          },
          { unread: false, actorIds: ['@tom:x'] }
        ),
      ],
      hiddenAutomations: 0,
    });
    const row = rowByTitle('Thread own');
    expect(within(row).getByText('Tom Becker replied')).toBeTruthy();
    expect(within(row).getByText('Tom left an update')).toBeTruthy();
    expect(screen.queryByText('You replied')).toBeNull();
    expect(screen.queryByText('My own follow-up')).toBeNull();
  });

  it('does not fall back to the indexed reply preview when no other reply exists', () => {
    const row = threadRow(
      'root-mention',
      'mention',
      {
        mentionedMe: true,
        mentionedBy: '@maya:x',
        lastReply: {
          eventId: '$mine',
          senderId: '@alice:x',
          ts: NOW,
          preview: { kind: 'text', text: 'My own note' },
          event: { sender: '@alice:x', content: {} },
        },
        lastOtherReply: undefined,
      },
      { actorIds: ['@maya:x'] }
    );
    if (row.type === 'thread') {
      row.entry.threadRecord.presentation.latestReplyPreviewText = 'Indexed own reply';
    }
    renderList({ rows: [row], hiddenAutomations: 0 });
    const item = rowByTitle('Thread root-mention');
    expect(within(item).getByText('Maya Chen mentioned you')).toBeTruthy();
    expect(screen.queryByText('Indexed own reply')).toBeNull();
    expect(screen.queryByText('My own note')).toBeNull();
  });

  it('writes out direction controls in titles, previews and room names', () => {
    const row = threadRow(
      'bidi',
      'reply',
      {
        lastOtherReply: {
          eventId: '$b',
          senderId: '@tom:x',
          ts: NOW,
          preview: { kind: 'text', text: 'see invoice\u202etxt.exe' },
          event: { sender: '@tom:x', content: {} },
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

  const inviteRoom = (roomId: string, name: string) =>
    mocks.rooms.set(roomId, {
      roomId,
      name,
      getCanonicalAlias: () => null,
      membersLoaded: () => true,
      getJoinedMembers: () => [],
    });
  const invite = (roomId: string, inviterId: string): ActivityRow => ({
    type: 'invite',
    key: `invite:${roomId}`,
    kind: 'invite',
    roomId,
    inviterId,
    unread: true,
    ts: NOW,
  });

  it('names the inviter of an invite plainly, with the user ID on a line of its own', () => {
    inviteRoom('!pilot:x', 'Partner Pilot');
    renderList({ rows: [invite('!pilot:x', '@sam:x')], hiddenAutomations: 0 });
    const row = screen.getByText('Partner Pilot').closest('[data-activity-row]') as HTMLElement;
    expect(within(row).getByText('Sam Rivera invited you')).toBeTruthy();
    // The ID still shows, so a copied name can be told apart, but not inside the sentence; whole,
    // as a long ID wraps rather than hiding its server.
    const id = within(row).getByText('@sam:x');
    expect(id.className).toContain(css.WholeId);
  });

  it('names an inviter whose name shows nothing by their user ID', () => {
    inviteRoom('!ghost:x', 'Free prizes');
    renderList({ rows: [invite('!ghost:x', '@ghost:x')], hiddenAutomations: 0 });
    expect(screen.getByText('ghost invited you')).toBeTruthy();
  });

  it('keeps one or two invites as rows of their own, with their answers', () => {
    inviteRoom('!b1:x', 'Bridge 1');
    inviteRoom('!b2:x', 'Bridge 2');
    renderList({
      rows: [invite('!b1:x', '@tom:x'), invite('!b2:x', '@tom:x')],
      hiddenAutomations: 0,
    });
    expect(screen.getAllByRole('button', { name: 'Join' })).toHaveLength(2);
    expect(screen.queryByText('2 invites')).toBeNull();
  });

  it('gathers three or more invites into one row that opens the invite list', () => {
    const rooms = ['!a1:x', '!a2:x', '!a3:x'];
    rooms.forEach((roomId, index) => inviteRoom(roomId, `Bridge ${index}`));
    renderList({
      rows: [...rooms.map((roomId) => invite(roomId, '@tom:x')), ...ROWS.slice(2)],
      hiddenAutomations: 0,
    });
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull();
    fireEvent.click(screen.getByText('3 invites'));
    expect(screen.getByLabelText('Current path').textContent).toBe('/activity/invites/');
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

  it('says it is loading, not that all is read, until the thread index has loaded', () => {
    renderList({ rows: [], hiddenAutomations: 0 }, false);
    expect(screen.getByText('Loading threads')).toBeTruthy();
    expect(screen.queryByText("You're all caught up")).toBeNull();
  });

  it("previews a reply with the plugin that renders it, a person's with its text", () => {
    mocks.plugins.push(greetingPlugin());
    renderList({
      rows: [greetingRow('agent', '@mindroom_code:x'), greetingRow('person', '@tom:x')],
      hiddenAutomations: 0,
    });
    expect(within(rowByTitle('Thread agent')).getByText('Greeting: Hi')).toBeTruthy();
    expect(within(rowByTitle('Thread person')).getByText('Hello there')).toBeTruthy();
  });

  it("keeps the reply's text when the plugin's preview throws or config.json turns it off", () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.plugins.push(
      greetingPlugin(() => {
        throw new Error('boom');
      })
    );
    renderList({ rows: [greetingRow('fails', '@mindroom_code:x')], hiddenAutomations: 0 });
    expect(within(rowByTitle('Thread fails')).getByText('Hello there')).toBeTruthy();
    cleanup();
    mocks.plugins.splice(0, 1, greetingPlugin());
    const off = { plugins: { example: { enabled: false } } } as unknown as ClientConfig;
    renderList({ rows: [greetingRow('off', '@mindroom_code:x')], hiddenAutomations: 0 }, true, off);
    expect(within(rowByTitle('Thread off')).getByText('Hello there')).toBeTruthy();
    logged.mockRestore();
  });

  it("titles a thread without an AI title by the plugin's preview of its root", () => {
    mocks.plugins.push(greetingPlugin());
    // Without an AI title, the index titles the thread by the root's body.
    const row = threadRow(
      'card',
      'reply',
      {},
      { title: 'Hello there', actorIds: ['@mindroom_code:x'] }
    );
    mocks.roots.set(
      '$card-root',
      new MatrixEvent({
        event_id: '$card-root',
        type: 'm.room.message',
        sender: '@mindroom_code:x',
        content: GREETING,
      })
    );
    renderList({ rows: [row], hiddenAutomations: 0 });
    expect(screen.getByText('Greeting: Hi')).toBeTruthy();
    expect(screen.queryByText('Hello there')).toBeNull();
  });

  it('says when nothing is left', () => {
    renderList({ rows: [], hiddenAutomations: 0 });
    expect(screen.getByText("You're all caught up")).toBeTruthy();
  });

  it('windows long lists behind a scroll sentinel while counting all rows and loading only rendered rooms', () => {
    const instances: {
      callback: IntersectionObserverCallback;
      targets: Set<Element>;
      disconnect: ReturnType<typeof vi.fn>;
    }[] = [];
    class FakeIntersectionObserver {
      targets = new Set<Element>();

      disconnect = vi.fn(() => this.targets.clear());

      constructor(public callback: IntersectionObserverCallback) {
        instances.push(this);
      }

      observe(target: Element) {
        this.targets.add(target);
      }

      unobserve(target: Element) {
        this.targets.delete(target);
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

    try {
      const loaders = new Map<string, ReturnType<typeof vi.fn>>();
      const rows = Array.from({ length: 95 }, (_, index) => {
        const key = `r${index}`;
        const mention = index < 5;
        const row = threadRow(
          key,
          mention ? 'mention' : 'reply',
          mention ? { mentionedMe: true, mentionedBy: '@maya:x' } : { newCount: 1 },
          { actorIds: ['@mindroom_code:x'], title: `Thread ${key}` }
        );
        const roomId = `!${key}:x`;
        const loadMembersIfNeeded = vi.fn(async () => undefined);
        loaders.set(roomId, loadMembersIfNeeded);
        mocks.rooms.set(roomId, {
          ...mocks.rooms.get(roomId)!,
          membersLoaded: () => false,
          loadMembersIfNeeded,
        });
        return row;
      });

      renderList({ rows, hiddenAutomations: 0 }, true, {}, 'sheet');

      const list = screen.getByRole('list');
      expect(within(list).getAllByRole('listitem')).toHaveLength(40);
      expect(screen.getByText('Thread r0')).toBeTruthy();
      expect(screen.queryByText('Thread r40')).toBeNull();
      // Unread/tab counts still reflect every row, not just the mounted window.
      expect(screen.getByRole('tab', { name: /All/ }).textContent).toContain('95');
      expect(screen.getByRole('tab', { name: /Mentions/ }).textContent).toContain('5');
      expect(screen.getByRole('tab', { name: /Replies/ }).textContent).toContain('90');
      // Only rooms for the rendered 40 rows load members.
      expect(loaders.get('!r0:x')).toHaveBeenCalledTimes(1);
      expect(loaders.get('!r39:x')).toHaveBeenCalledTimes(1);
      expect(loaders.get('!r40:x')).not.toHaveBeenCalled();

      const showMore = screen.getByRole('button', { name: 'Show more' });
      expect(list.contains(showMore)).toBe(false);

      const intersect = () => {
        const current = instances.at(-1)!;
        const target = [...current.targets][0];
        expect(target).toBeTruthy();
        act(() => {
          current.callback(
            [{ target, isIntersecting: true } as unknown as IntersectionObserverEntry],
            current as unknown as IntersectionObserver
          );
        });
      };

      intersect();
      expect(within(list).getAllByRole('listitem')).toHaveLength(80);
      expect(screen.getByText('Thread r40')).toBeTruthy();
      expect(screen.queryByText('Thread r80')).toBeNull();
      expect(loaders.get('!r79:x')).toHaveBeenCalledTimes(1);
      expect(loaders.get('!r80:x')).not.toHaveBeenCalled();

      intersect();
      expect(within(list).getAllByRole('listitem')).toHaveLength(95);
      expect(screen.getByText('Thread r94')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
      expect(loaders.get('!r94:x')).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('resets the page window when switching tabs or toggling Unread', () => {
    const instances: {
      callback: IntersectionObserverCallback;
      targets: Set<Element>;
    }[] = [];
    class FakeIntersectionObserver {
      targets = new Set<Element>();

      disconnect = vi.fn(() => this.targets.clear());

      constructor(public callback: IntersectionObserverCallback) {
        instances.push(this);
      }

      observe(target: Element) {
        this.targets.add(target);
      }

      unobserve(target: Element) {
        this.targets.delete(target);
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

    try {
      const rows = Array.from({ length: 95 }, (_, index) =>
        threadRow(`p${index}`, 'reply', { newCount: 1 }, { actorIds: ['@mindroom_code:x'] })
      );
      renderList({ rows, hiddenAutomations: 0 }, true, {}, 'page');

      const list = screen.getByRole('list');
      expect(within(list).getAllByRole('listitem')).toHaveLength(40);

      const intersect = () => {
        const current = instances.at(-1)!;
        const target = [...current.targets][0];
        act(() => {
          current.callback(
            [{ target, isIntersecting: true } as unknown as IntersectionObserverEntry],
            current as unknown as IntersectionObserver
          );
        });
      };

      intersect();
      expect(within(list).getAllByRole('listitem')).toHaveLength(80);

      fireEvent.click(screen.getByRole('tab', { name: /Replies/ }));
      expect(within(list).getAllByRole('listitem')).toHaveLength(40);

      intersect();
      expect(within(list).getAllByRole('listitem')).toHaveLength(80);

      fireEvent.click(screen.getByLabelText('Unread'));
      expect(within(list).getAllByRole('listitem')).toHaveLength(40);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('never caps waiting rows or invites when new waiting rows arrive', () => {
    const inviteRow = (id: string): ActivityRow => {
      const roomId = `!inv-${id}:x`;
      mocks.rooms.set(roomId, {
        roomId,
        name: `Invite ${id}`,
        getCanonicalAlias: () => null,
        membersLoaded: () => true,
        getJoinedMembers: () => [],
      });
      return {
        type: 'invite',
        key: `invite:${roomId}`,
        kind: 'invite',
        roomId,
        unread: true,
        ts: NOW - 60_000,
      };
    };

    const approvals = Array.from({ length: 39 }, (_, index) =>
      threadRow(
        `ap${index}`,
        'approval',
        { pendingApproval: approvalRecord },
        { actorIds: ['@mindroom_router:x'], title: `Approval ${index}` }
      )
    );
    const invites = [inviteRow('1'), inviteRow('2'), inviteRow('3')];
    const store = renderList({ rows: [...approvals, ...invites], hiddenAutomations: 0 });
    expect(screen.getByText('3 invites')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();

    const newerApproval = threadRow(
      'ap-new',
      'approval',
      { pendingApproval: approvalRecord },
      { actorIds: ['@mindroom_router:x'], title: 'Approval new' }
    );
    act(() =>
      store.set(activityRowsAtom, {
        rows: [newerApproval, ...approvals, ...invites],
        hiddenAutomations: 0,
      })
    );
    expect(screen.getByText('Approval new')).toBeTruthy();
    expect(screen.getByText('Approval 38')).toBeTruthy();
    expect(screen.getByText('3 invites')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();

    cleanup();
    const questions = Array.from({ length: 40 }, (_, index) =>
      threadRow(
        `q${index}`,
        'question',
        { pendingQuestion: question },
        { actorIds: ['@mindroom_mind:x'], title: `Question ${index}` }
      )
    );
    const singleInvite = inviteRow('solo');
    const qStore = renderList({ rows: [...questions, singleInvite], hiddenAutomations: 0 });
    expect(screen.getByText('Invite solo')).toBeTruthy();
    const newerQuestion = threadRow(
      'q-new',
      'question',
      { pendingQuestion: question },
      { actorIds: ['@mindroom_mind:x'], title: 'Question new' }
    );
    act(() =>
      qStore.set(activityRowsAtom, {
        rows: [newerQuestion, ...questions, singleInvite],
        hiddenAutomations: 0,
      })
    );
    expect(screen.getByText('Question new')).toBeTruthy();
    expect(screen.getByText('Question 39')).toBeTruthy();
    expect(screen.getByText('Invite solo')).toBeTruthy();
  });

  it('never loads the 41st room on the first render after switching tabs', () => {
    const loaders = new Map<string, ReturnType<typeof vi.fn>>();
    const makeRow = (key: string, kind: 'reply' | 'mention') => {
      const row = threadRow(
        key,
        kind,
        kind === 'mention' ? { mentionedMe: true, mentionedBy: '@maya:x' } : { newCount: 1 },
        { actorIds: ['@mindroom_code:x'], title: `Thread ${key}` }
      );
      const roomId = `!${key}:x`;
      const loadMembersIfNeeded = vi.fn(async () => undefined);
      loaders.set(roomId, loadMembersIfNeeded);
      mocks.rooms.set(roomId, {
        ...mocks.rooms.get(roomId)!,
        membersLoaded: () => false,
        loadMembersIfNeeded,
      });
      return row;
    };

    const replies = Array.from({ length: 90 }, (_, i) => makeRow(`rep${i}`, 'reply'));
    const mentions = Array.from({ length: 60 }, (_, i) => makeRow(`men${i}`, 'mention'));
    renderList({ rows: [...replies, ...mentions], hiddenAutomations: 0 });

    // Switch to Replies and grow to 80 rows.
    fireEvent.click(screen.getByRole('tab', { name: /Replies/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(80);

    // Switch to Mentions: first render uses 40, so the 41st mention room never starts loading.
    fireEvent.click(screen.getByRole('tab', { name: /Mentions/ }));
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(40);
    expect(loaders.get('!men0:x')).toHaveBeenCalledTimes(1);
    expect(loaders.get('!men39:x')).toHaveBeenCalledTimes(1);
    expect(loaders.get('!men40:x')).not.toHaveBeenCalled();
  });

  it('appends a page only on Show more activation, not focus, and keeps observer stable across renders', () => {
    let created = 0;
    class SilentIntersectionObserver {
      observe = vi.fn();

      unobserve = vi.fn();

      disconnect = vi.fn();

      constructor() {
        created += 1;
      }
    }
    vi.stubGlobal('IntersectionObserver', SilentIntersectionObserver);

    try {
      const rows = Array.from({ length: 130 }, (_, index) =>
        threadRow(`k${index}`, 'reply', { newCount: 1 }, { actorIds: ['@mindroom_code:x'] })
      );
      const store = renderList({ rows, hiddenAutomations: 0 }, true, {}, 'page');

      const list = screen.getByRole('list');
      expect(within(list).getAllByRole('listitem')).toHaveLength(40);
      expect(created).toBe(1);

      // Re-rendering without growing the window does not rebuild the observer.
      act(() => store.set(activityRowsAtom, { rows: [...rows], hiddenAutomations: 0 }));
      expect(created).toBe(1);

      // Focusing Show more alone (Tab or Shift+Tab from footer) does not paginate.
      const showMore = screen.getByRole('button', { name: 'Show more' });
      showMore.focus();
      fireEvent.focus(showMore);
      expect(within(list).getAllByRole('listitem')).toHaveLength(40);

      // Activation appends one page and moves focus from Show more to the first new row.
      fireEvent.click(showMore, { detail: 0 });
      expect(within(list).getAllByRole('listitem')).toHaveLength(80);
      const firstNewRow = screen.getByText('Thread k40').closest('button');
      expect(document.activeElement).toBe(firstNewRow);

      // Pointer click (detail: 1) with >40 remaining rows appends exactly one page (80 -> 120);
      // where the press focused Show more, focus moves on to the first new row just the same.
      const showMoreAgain = screen.getByRole('button', { name: 'Show more' });
      fireEvent.pointerDown(showMoreAgain);
      showMoreAgain.focus();
      fireEvent.focus(showMoreAgain);
      fireEvent.click(showMoreAgain, { detail: 1 });
      expect(within(list).getAllByRole('listitem')).toHaveLength(120);
      expect(document.activeElement).toBe(screen.getByText('Thread k80').closest('button'));
      expect(screen.getByRole('button', { name: 'Show more' })).toBeTruthy();

      fireEvent.click(showMoreAgain, { detail: 1 });
      expect(within(list).getAllByRole('listitem')).toHaveLength(130);
      expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    [80, 100],
    [700, 700],
  ])('mounts 40 rows on first open when the current thread ranks %i of %i', (rank, count) => {
    const loaders = new Map<string, ReturnType<typeof vi.fn>>();
    const rows = Array.from({ length: count }, (_, index) => {
      const key = `d${index}`;
      const row = threadRow(key, 'reply', { newCount: 1 }, { actorIds: ['@mindroom_code:x'] });
      const roomId = `!${key}:x`;
      const loadMembersIfNeeded = vi.fn(async () => undefined);
      loaders.set(roomId, loadMembersIfNeeded);
      mocks.rooms.set(roomId, {
        ...mocks.rooms.get(roomId)!,
        membersLoaded: () => false,
        loadMembersIfNeeded,
      });
      return row;
    });

    renderList(
      { rows, hiddenAutomations: 0 },
      true,
      {},
      'sheet',
      `/home/!d${rank - 1}:x?threadId=$d${rank - 1}-root`
    );

    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(40);
    const loadedCount = [...loaders.values()].filter((fn) => fn.mock.calls.length > 0).length;
    expect(loadedCount).toBeLessThanOrEqual(40);
    expect(loaders.get('!d40:x')).not.toHaveBeenCalled();
    expect(loaders.get(`!d${rank - 1}:x`)).not.toHaveBeenCalled();
  });

  it('does not restore an earlier tab limit when returning to it (A -> B -> A)', () => {
    const rows = Array.from({ length: 90 }, (_, index) =>
      threadRow(`aba${index}`, 'reply', { newCount: 1 }, { actorIds: ['@mindroom_code:x'] })
    );
    renderList({ rows, hiddenAutomations: 0 }, true, {}, 'page');

    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(40);
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(80);

    fireEvent.click(screen.getByRole('tab', { name: /Replies/ }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(40);

    fireEvent.click(screen.getByRole('tab', { name: /All/ }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(40);
  });

  it('keeps the current or focused row mounted when live rows prepend at the boundary', () => {
    const rows = Array.from({ length: 50 }, (_, index) =>
      threadRow(`b${index}`, 'reply', { newCount: 1 }, { actorIds: ['@mindroom_code:x'] })
    );
    const store = renderList(
      { rows, hiddenAutomations: 0 },
      true,
      {},
      'page',
      '/activity/!b39:x?threadId=$b39-root'
    );

    const row39Button = screen.getByText('Thread b39').closest('button')!;
    expect(row39Button.getAttribute('aria-current')).toBe('page');
    row39Button.focus();
    expect(document.activeElement).toBe(row39Button);

    const incoming = threadRow(
      'b-new',
      'reply',
      { newCount: 1 },
      { actorIds: ['@mindroom_code:x'], title: 'Thread b-new' }
    );
    act(() => store.set(activityRowsAtom, { rows: [incoming, ...rows], hiddenAutomations: 0 }));

    expect(screen.getByText('Thread b-new')).toBeTruthy();
    expect(screen.getByText('Thread b39').closest('button')).toBe(row39Button);
    expect(row39Button.getAttribute('aria-current')).toBe('page');
    expect(document.activeElement).toBe(row39Button);
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(41);

    // Also verify a non-current row holding focus is retained on prepend.
    cleanup();
    const store2 = renderList({ rows, hiddenAutomations: 0 }, true, {}, 'page');
    const focusedBtn = screen.getByText('Thread b39').closest('button')!;
    focusedBtn.focus();
    expect(document.activeElement).toBe(focusedBtn);
    act(() => store2.set(activityRowsAtom, { rows: [incoming, ...rows], hiddenAutomations: 0 }));
    expect(screen.getByText('Thread b39').closest('button')).toBe(focusedBtn);
    expect(document.activeElement).toBe(focusedBtn);
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(41);
  });

  it('keeps every mounted row when a prepend moves the current row from rank 80 to 81', () => {
    // The observer stays silent: only Show more pages.
    standInForIntersectionObserver();
    const rows = replies('e', 100);
    const store = renderList(
      { rows, hiddenAutomations: 0 },
      true,
      {},
      'page',
      '/activity/!e79:x?threadId=$e79-root'
    );
    // The reader reaches the open thread, by Show more where the first open did not mount it.
    if (!screen.queryByText('Thread e79')) {
      fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    }
    expect(listItems()).toHaveLength(80);
    const current = screen.getByText('Thread e79').closest('button')!;
    const reading = screen.getByText('Thread e54').closest('button')!;
    current.focus();

    act(() =>
      store.set(activityRowsAtom, { rows: [...replies('e-new', 1), ...rows], hiddenAutomations: 0 })
    );

    expect(listItems()).toHaveLength(81);
    expect(screen.getByText('Thread e54').closest('button')).toBe(reading);
    expect(screen.getByText('Thread e79').closest('button')).toBe(current);
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(document.activeElement).toBe(current);
  });

  it('keeps a focused row mounted through a bulk prepend', () => {
    const rows = replies('f', 50);
    const store = renderList({ rows, hiddenAutomations: 0 });
    const focused = screen.getByText('Thread f39').closest('button')!;
    focused.focus();

    act(() =>
      store.set(activityRowsAtom, { rows: [...replies('g', 41), ...rows], hiddenAutomations: 0 })
    );

    expect(screen.getByText('Thread f39').closest('button')).toBe(focused);
    expect(document.activeElement).toBe(focused);
    expect(listItems()).toHaveLength(81);
    // Once the last mounted row leaves the list, the window ends at the one before it.
    act(() =>
      store.set(activityRowsAtom, {
        rows: [...replies('g', 41), ...rows.filter((row) => row.key !== 'f39')],
        hiddenAutomations: 0,
      })
    );
    expect(listItems()).toHaveLength(80);
    expect(screen.queryByText('Thread f40')).toBeNull();
  });

  it('starts at one page when the index has loaded, whatever was mounted before', () => {
    const early = replies('h', 40);
    const store = renderList({ rows: early, hiddenAutomations: 0 }, false);
    const loading = (rows: ActivityRow[]) => ({ rows, hiddenAutomations: 0, loading: true });
    act(() => store.set(activityRowsAtom, loading([...replies('i', 300), ...early])));
    expect(listItems()).toHaveLength(40);

    // The index says it has loaded one commit before the rows of its last batch arrive.
    act(() =>
      store.set(crossRoomThreadIndexAtom, {
        ...emptyCrossRoomThreadIndexSnapshot(),
        bootstrapped: true,
      })
    );
    expect(listItems()).toHaveLength(40);
    const rows = [...replies('j', 600), ...replies('i', 300), ...early];
    act(() => store.set(activityRowsAtom, { rows, hiddenAutomations: 0 }));
    expect(listItems()).toHaveLength(40);
    expect(screen.getByText('Thread j39')).toBeTruthy();

    // From here on a live update keeps what is mounted.
    act(() =>
      store.set(activityRowsAtom, { rows: [...replies('k', 1), ...rows], hiddenAutomations: 0 })
    );
    expect(listItems()).toHaveLength(41);
  });

  it('starts at one page when automation runs are shown or hidden', () => {
    const people = replies('p', 50);
    const runs = replies('auto', 600);
    const store = renderList({ rows: people.slice(0, 20), hiddenAutomations: 600 });
    expect(listItems()).toHaveLength(20);

    // The switch alone changes nothing; the rows built with it arrive a commit later.
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(listItems()).toHaveLength(20);
    const shown = { rows: [...runs, ...people], hiddenAutomations: 0, showAutomations: true };
    act(() => store.set(activityRowsAtom, shown));
    expect(listItems()).toHaveLength(40);
    expect(screen.getByRole('button', { name: 'Show more' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(listItems()).toHaveLength(80);
    act(() =>
      store.set(activityRowsAtom, { rows: people, hiddenAutomations: 600, showAutomations: false })
    );
    expect(listItems()).toHaveLength(40);
  });

  it('hands the focus of a row to Show more when an update windows it out while the index loads', () => {
    // The observer stays silent.
    standInForIntersectionObserver();
    const rows = replies('y', 50);
    const store = renderList({ rows, hiddenAutomations: 0 }, false);
    screen.getByText('Thread y39').closest('button')!.focus();

    act(() =>
      store.set(activityRowsAtom, {
        rows: [...replies('z', 1), ...rows],
        hiddenAutomations: 0,
        loading: true,
      })
    );
    expect(listItems()).toHaveLength(40);
    const showMore = screen.getByRole('button', { name: 'Show more' });
    expect(document.activeElement).toBe(showMore);

    // From there the reader gets the row back.
    fireEvent.click(showMore);
    expect(document.activeElement).toBe(screen.getByText('Thread y39').closest('button'));
  });

  it('hands the focus of Show more to the last row when a live update takes it away', () => {
    // The observer stays silent.
    standInForIntersectionObserver();
    const rows = replies('v', 41);
    const store = renderList({ rows, hiddenAutomations: 0 });
    screen.getByRole('button', { name: 'Show more' }).focus();

    // A reply brings the one row past the window to the top: all 41 show, Show more goes.
    act(() =>
      store.set(activityRowsAtom, {
        rows: [rows[40]!, ...rows.slice(0, 40)],
        hiddenAutomations: 0,
      })
    );
    expect(listItems()).toHaveLength(41);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByText('Thread v39').closest('button'));
  });

  it('moves focus from Show more to the first new row when the observer appends a page', () => {
    const { intersect } = standInForIntersectionObserver();
    renderList({ rows: replies('o', 90), hiddenAutomations: 0 });

    screen.getByRole('button', { name: 'Show more' }).focus();
    intersect();
    expect(listItems()).toHaveLength(80);
    expect(document.activeElement).toBe(screen.getByText('Thread o40').closest('button'));

    // The last page takes Show more away; its focus goes to the first new row all the same.
    screen.getByRole('button', { name: 'Show more' }).focus();
    intersect();
    expect(listItems()).toHaveLength(90);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByText('Thread o80').closest('button'));
  });

  it('leaves focus alone when the observer appends a page while a row has it', () => {
    const { intersect } = standInForIntersectionObserver();
    renderList({ rows: replies('n', 90), hiddenAutomations: 0 });
    const focused = screen.getByText('Thread n10').closest('button')!;
    focused.focus();
    intersect();
    expect(listItems()).toHaveLength(80);
    expect(document.activeElement).toBe(focused);
  });

  it('ignores an observer callback from before a filter switch', () => {
    const { observers, intersect } = standInForIntersectionObserver();
    renderList({ rows: replies('s', 95), hiddenAutomations: 0 });
    const stale = observers.at(-1)!;

    fireEvent.click(screen.getByRole('tab', { name: /Replies/ }));
    intersect(stale);
    expect(listItems()).toHaveLength(40);

    // The new filter's own observer still pages.
    intersect();
    expect(listItems()).toHaveLength(80);
  });

  it('does not play a leave fade for rows a filter change leaves past the window edge', () => {
    const motion = standInForListMotion();
    const prevHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 3000 });
    try {
      // The rows past the first page are of an earlier day, under a divider of their own.
      const rows = replies('w', 45).map((row, index) =>
        index < 40 ? row : { ...row, ts: NOW - 36 * 3600_000 }
      );
      renderList({ rows, hiddenAutomations: 0 });
      fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
      expect(listItems()).toHaveLength(45);

      // Replies holds the same rows and starts again at 40: w40 to w44 were not read or removed,
      // and neither was their day.
      fireEvent.click(screen.getByRole('tab', { name: /Replies/ }));
      expect(listItems()).toHaveLength(40);
      expect(motion.left()).toEqual([]);
    } finally {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: prevHeight });
      motion.restore();
    }
  });
});
