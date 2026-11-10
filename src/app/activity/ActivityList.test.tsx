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
import type { ActivityRow, ActivityRowsResult } from './activityRows';
import { activityRowsAtom, activityShowAutomationsAtom } from './activityState';
import { ActivityList } from './ActivityList';
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
  // Sam invited the user to a room whose members are not known: the full name carries the ID.
  getSenderName: (_room: unknown, userId: string) =>
    userId === '@sam:x' ? 'Sam Rivera (@sam:x)' : NAMES[userId] ?? userId,
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
      lastReply: {
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
      lastReply: {
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

const renderList = (result: ActivityRowsResult, bootstrapped = true, config: ClientConfig = {}) => {
  const store = createStore();
  store.set(activityRowsAtom, result);
  store.set(crossRoomThreadIndexAtom, { ...emptyCrossRoomThreadIndexSnapshot(), bootstrapped });
  render(
    <Provider store={store}>
      <ClientConfigProvider value={config}>
        <ScreenSizeProvider value={ScreenSize.Desktop}>
          <MemoryRouter initialEntries={['/home/']}>
            <ActivityList variant="page" />
            <CurrentPath />
          </MemoryRouter>
        </ScreenSizeProvider>
      </ClientConfigProvider>
    </Provider>
  );
  return store;
};

const rowByTitle = (title: string) =>
  screen.getByText(title).closest('[data-activity-row]') as HTMLElement;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.plugins.splice(0);
  mocks.roots.clear();
});

const GREETING = { msgtype: 'm.text', body: 'Hello there', 'com.example.greeting': { text: 'Hi' } };

/** A plugin that renders greetings as cards, and previews them as "Greeting: <text>". */
const greetingPlugin = (preview: (text: string) => string = (text) => `Greeting: ${text}`) =>
  ({
    id: 'example',
    tag: 'example@1.0.0',
    messageRenderers: [
      {
        match: (event: { content: Record<string, unknown> }) =>
          'com.example.greeting' in event.content,
        Component: () => null,
        preview: (event: { content: Record<string, unknown> }) =>
          preview((event.content['com.example.greeting'] as { text: string }).text),
      },
    ],
  } as unknown as RegisteredPlugin);

/** A row whose newest reply is `sender`'s greeting. */
const greetingRow = (key: string, sender: string) =>
  threadRow(key, 'reply', {
    newCount: 1,
    lastReply: {
      eventId: `$${key}-reply`,
      senderId: sender,
      ts: NOW,
      preview: { kind: 'text', text: 'Hello there' },
      event: { eventId: `$${key}-reply`, type: 'm.room.message', sender, content: GREETING },
    },
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
          lastReply: {
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
});
