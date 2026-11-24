// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createStore, Provider } from 'jotai';
import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { afterEach, expect, it, vi } from 'vitest';
import { roomIdToTypingMembersAtom } from '../../matrix/state/typingMembers';
import { RoomViewTyping } from './RoomViewTyping';

vi.mock('./RoomViewTyping.css', () => ({
  TypingStrip: 'typing-strip',
  TypingStripArriving: 'typing-strip-arriving',
  DropButton: 'drop-button',
  TypingText: 'typing-text',
  TypingDots: 'typing-dots',
  TypingDot: 'typing-dot',
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@me:example.org' }),
}));
// The helper's reply has no row on screen unless a test adds one.
let streamingReplyId: string | undefined;
vi.mock('../../event-store/threads/useThreadStreamingState', () => ({
  getThreadStreamingEvents: () => [
    { getId: () => streamingReplyId, getSender: () => '@mindroom_helper:example.org' },
  ],
  isEventStreaming: () => true,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOM_ID = '!room:example.org';
const HELPER = '@mindroom_helper:example.org';
// A display name that would add an inline handler to the bold name it fills, read as markup.
const MARKUP_NAME = '<name is onclick="alert(1)">Mallory</name>';
const NAMES: Record<string, string> = {
  '@avery:example.org': 'Avery',
  '@blake:example.org': 'Blake',
  '@code:example.org': 'Code',
  '@drew:example.org': 'Drew',
  '@ellis:example.org': 'Ellis',
  '@mallory:example.org': MARKUP_NAME,
  [HELPER]: 'Helper',
};
let jobsState: MatrixEvent[] = [];
let activeRunsState: MatrixEvent[] = [];
const activeRunsFor = (threads: string[], sender = HELPER, ttlMs = 180_000, ts = Date.now()) =>
  new MatrixEvent({
    event_id: `$runs_${ts}_${threads.join('_')}`,
    type: 'io.mindroom.active_runs',
    state_key: sender,
    sender,
    room_id: ROOM_ID,
    origin_server_ts: ts,
    content: {
      version: 1,
      updated_at: ts,
      ttl_ms: ttlMs,
      threads: threads.map((thread_id) => ({ thread_id })),
    },
  });
const room = {
  roomId: ROOM_ID,
  myUserId: '@me:example.org',
  getMember: (userId: string) => ({ rawDisplayName: NAMES[userId], membership: 'join' }),
  currentState: {
    getStateEvents: (type: string) => {
      if (type === 'io.mindroom.background_jobs') return jobsState;
      if (type === 'io.mindroom.active_runs') return activeRunsState;
      return [];
    },
  },
  getThread: () => null,
  getUnfilteredTimelineSet: () => ({}),
  getLiveTimeline: () => ({ getEvents: () => [] }),
  on: () => undefined,
  removeListener: () => undefined,
} as unknown as Room;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  jobsState = [];
  activeRunsState = [];
  streamingReplyId = undefined;
  document.querySelectorAll('[data-message-id]').forEach((row) => row.remove());
  vi.useRealTimers();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
});

const typing = (store: ReturnType<typeof createStore>, userId: string, roomId = ROOM_ID) =>
  store.set(roomIdToTypingMembersAtom, {
    type: 'PUT',
    roomId,
    userId,
    ts: Date.now(),
    isTyping: () => true,
  });

const render = (store: ReturnType<typeof createStore>, threadId?: string, targetRoom = room) => {
  container = document.createElement('div');
  document.body.append(container);
  act(() => {
    root = createRoot(container!);
    root.render(
      <Provider store={store}>
        <RoomViewTyping room={targetRoom} threadId={threadId} />
      </Provider>
    );
  });
  return container;
};

const rerender = (store: ReturnType<typeof createStore>, threadId?: string, targetRoom = room) => {
  act(() => {
    root?.render(
      <Provider store={store}>
        <RoomViewTyping room={targetRoom} threadId={threadId} />
      </Provider>
    );
  });
};

it('shows nothing while nobody else types', () => {
  const store = createStore();
  typing(store, '@me:example.org');
  expect(render(store).textContent).toBe('');
});

it('names who types next to the dots, and drops the notice until the next update', () => {
  const store = createStore();
  typing(store, '@avery:example.org');
  typing(store, '@code:example.org');
  const view = render(store);

  const strip = view.querySelector('[role="status"]');
  expect(strip?.textContent).toBe('Avery and Code are typing...');
  expect(view.querySelectorAll('.typing-dot')).toHaveLength(3);

  const drop = view.querySelector<HTMLButtonElement>('button[aria-label="Drop Typing Status"]');
  act(() => drop?.click());
  expect(view.textContent).toBe('');

  act(() => typing(store, '@avery:example.org'));
  expect(view.querySelector('[role="status"]')?.textContent).toBe('Avery is typing...');
});

it('shows a typing name that holds markup as text, in one bold name with no added attributes', () => {
  const store = createStore();
  typing(store, '@mallory:example.org');
  const strip = render(store).querySelector('[role="status"]');

  const bold = strip?.querySelectorAll('b') ?? [];
  expect(bold).toHaveLength(1);
  expect(bold[0]?.childElementCount).toBe(0);
  expect(bold[0]?.textContent).toBe(MARKUP_NAME);
  expect(bold[0]?.getAttributeNames()).toEqual(['dir']);
  expect(strip?.textContent).toBe(`${MARKUP_NAME} is typing...`);
});

it('names the first three people typing in bold and counts the rest', () => {
  const store = createStore();
  ['@avery:example.org', '@blake:example.org', '@code:example.org', '@drew:example.org'].forEach(
    (userId) => typing(store, userId)
  );
  const view = render(store);
  const boldTexts = () =>
    Array.from(view.querySelectorAll('[role="status"] b'), (bold) => bold.textContent);

  expect(view.querySelector('[role="status"]')?.textContent).toBe(
    'Avery, Blake, Code, and 1 other are typing...'
  );
  expect(boldTexts()).toEqual(['Avery', 'Blake', 'Code', '1 other']);

  act(() => typing(store, '@ellis:example.org'));
  expect(view.querySelector('[role="status"]')?.textContent).toBe(
    'Avery, Blake, Code, and 2 others are typing...'
  );
  expect(boldTexts()).toEqual(['Avery', 'Blake', 'Code', '2 others']);
});

it('names people typing in the room view, and none in a thread view, as typing names no thread', () => {
  const store = createStore();
  typing(store, '@avery:example.org');
  typing(store, '@code:example.org');

  // Avery and Code may type in this thread, in another, or in the room: nothing tells which.
  expect(render(store, '$thread').querySelector('[role="status"]')).toBeNull();
  act(() => root?.unmount());
  container?.remove();
  expect(render(store).querySelector('[role="status"]')?.textContent).toBe(
    'Avery and Code are typing...'
  );
});

it('leaves out an agent whose job in the open thread waits for approval, as it waits for you', () => {
  jobsState = [
    new MatrixEvent({
      type: 'io.mindroom.background_jobs',
      state_key: HELPER,
      sender: HELPER,
      room_id: ROOM_ID,
      content: {
        jobs: [
          {
            job_id: 'job-1',
            kind: 'tool',
            thread_id: '$waiting',
            tool: 'run_shell_command',
            status: 'awaiting_approval',
            started_at: '2026-11-06T02:43:53Z',
          },
        ],
      },
    }),
  ];
  activeRunsState = [activeRunsFor(['$waiting', '$elsewhere'])];
  const store = createStore();
  typing(store, HELPER);

  expect(render(store, '$waiting').querySelector('[role="status"]')).toBeNull();
  act(() => root?.unmount());
  container?.remove();
  expect(render(store, '$elsewhere').querySelector('[role="status"]')?.textContent).toBe(
    'Helper is typing...'
  );
});

/** A timeline row for `eventId` whose box spans `top` to `bottom` in the window. */
const addRow = (eventId: string, place: { top: number; bottom: number }) => {
  const row = document.createElement('div');
  row.setAttribute('data-message-id', eventId);
  row.getBoundingClientRect = () =>
    ({ ...place, left: 0, right: 300, width: 300, height: place.bottom - place.top } as DOMRect);
  document.body.append(row);
  return place;
};

it('leaves out an agent whose streaming reply shows on screen, and names it once it is out of view', () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_763_839_200_000);
  activeRunsState = [activeRunsFor(['$thread'])];
  streamingReplyId = '$streaming';
  const place = addRow('$streaming', { top: 120, bottom: 600 });
  const store = createStore();
  typing(store, HELPER);

  // The reply's dots and Stop say the helper writes.
  const view = render(store, '$thread');
  expect(view.querySelector('[role="status"]')).toBeNull();

  // Scrolled up: the reply is below the screen.
  place.top = 2000;
  place.bottom = 2500;
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(view.querySelector('[role="status"]')?.textContent).toBe('Helper is typing...');
});

it('hides the typing agent when its reply mounts after the typing notice, before the next poll', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_763_839_200_000);
  activeRunsState = [activeRunsFor(['$thread'])];
  streamingReplyId = '$late';
  const store = createStore();
  typing(store, HELPER);
  const view = render(store, '$thread');
  expect(view.querySelector('[role="status"]')?.textContent).toBe('Helper is typing...');

  await act(async () => {
    addRow('$late', { top: 120, bottom: 600 });
  });
  expect(view.querySelector('[role="status"]')).toBeNull();
});

it('shows an agent typing in a thread only while active_runs lists that thread and has not expired', () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_763_839_200_000);
  activeRunsState = [activeRunsFor(['$other-thread'], HELPER, 30_000)];
  const store = createStore();
  typing(store, HELPER);

  expect(render(store, '$thread').querySelector('[role="status"]')).toBeNull();
  act(() => root?.unmount());
  container?.remove();

  activeRunsState = [activeRunsFor(['$thread'], HELPER, 30_000)];
  const view = render(store, '$thread');
  expect(view.querySelector('[role="status"]')?.textContent).toBe('Helper is typing...');

  act(() => {
    vi.advanceTimersByTime(30_001);
  });
  expect(view.querySelector('[role="status"]')).toBeNull();
});

it('renders without the arrive animation when mounted with active typers', () => {
  const store = createStore();
  typing(store, '@avery:example.org');
  const strip = render(store).querySelector('[role="status"]');
  expect(strip?.classList.contains('typing-strip')).toBe(true);
  expect(strip?.classList.contains('typing-strip-arriving')).toBe(false);
});

it('applies the arrive animation when typing starts after mounting empty', () => {
  const store = createStore();
  const view = render(store);
  expect(view.querySelector('[role="status"]')).toBeNull();

  act(() => typing(store, '@avery:example.org'));
  const strip = view.querySelector('[role="status"]');
  expect(strip?.classList.contains('typing-strip-arriving')).toBe(true);
});

it('skips the arrive animation when switching rooms or threads into active typing', () => {
  const store = createStore();
  const otherRoom = { ...room, roomId: '!other:example.org' } as unknown as Room;
  typing(store, '@avery:example.org', otherRoom.roomId);
  const view = render(store);
  expect(view.querySelector('[role="status"]')).toBeNull();

  rerender(store, undefined, otherRoom);
  expect(view.querySelector('[role="status"]')?.classList.contains('typing-strip-arriving')).toBe(
    false
  );

  act(() => typing(store, '@avery:example.org', room.roomId));
  rerender(store, undefined, room);
  expect(view.querySelector('[role="status"]')?.classList.contains('typing-strip-arriving')).toBe(
    false
  );

  rerender(store, '$thread', room);
  expect(view.querySelector('[role="status"]')).toBeNull();
  rerender(store, undefined, room);
  expect(view.querySelector('[role="status"]')?.classList.contains('typing-strip-arriving')).toBe(
    false
  );
});
