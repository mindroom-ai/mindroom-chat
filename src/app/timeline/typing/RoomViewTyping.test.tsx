// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { createStore, Provider } from 'jotai';
import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { afterEach, expect, it, vi } from 'vitest';
import { roomIdToTypingMembersAtom } from '../../matrix/state/typingMembers';
import { RoomViewTyping } from './RoomViewTyping';

vi.mock('./RoomViewTyping.css', () => ({
  TypingStrip: 'typing-strip',
  DropButton: 'drop-button',
  TypingText: 'typing-text',
  TypingDots: 'typing-dots',
  TypingDot: 'typing-dot',
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@me:example.org' }),
}));
// The helper's reply streams in every thread, so an agent in a thread shows for its approval
// state alone; the reply has no row on screen unless a test adds one.
let streamingReplyId: string | undefined;
vi.mock('../../event-store/threads/useThreadStreamingState', () => ({
  useThreadStreamingState: () => true,
  getThreadStreamingEvents: () => [
    { getId: () => streamingReplyId, getSender: () => '@mindroom_helper:example.org' },
  ],
  isEventStreaming: () => true,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOM_ID = '!room:example.org';
const HELPER = '@mindroom_helper:example.org';
const NAMES: Record<string, string> = {
  '@avery:example.org': 'Avery',
  '@code:example.org': 'Code',
  [HELPER]: 'Helper',
};
let jobsState: MatrixEvent[] = [];
const room = {
  roomId: ROOM_ID,
  myUserId: '@me:example.org',
  getMember: (userId: string) => ({ rawDisplayName: NAMES[userId], membership: 'join' }),
  currentState: {
    getStateEvents: (type: string) => (type === 'io.mindroom.background_jobs' ? jobsState : []),
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
  streamingReplyId = undefined;
  document.querySelectorAll('[data-message-id]').forEach((row) => row.remove());
  vi.useRealTimers();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
});

const typing = (store: ReturnType<typeof createStore>, userId: string) =>
  store.set(roomIdToTypingMembersAtom, {
    type: 'PUT',
    roomId: ROOM_ID,
    userId,
    ts: Date.now(),
    isTyping: () => true,
  });

const render = (store: ReturnType<typeof createStore>, threadId?: string) => {
  container = document.createElement('div');
  document.body.append(container);
  act(() => {
    root = createRoot(container!);
    root.render(
      <Provider store={store}>
        <RoomViewTyping room={room} threadId={threadId} />
      </Provider>
    );
  });
  return container;
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
