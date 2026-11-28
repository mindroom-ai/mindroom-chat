// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createStore, Provider } from 'jotai';
import { MatrixEvent, MatrixEventEvent, RoomEvent, type Room } from 'matrix-js-sdk';
import { afterEach, expect, it, vi } from 'vitest';
import { roomIdToTypingMembersAtom } from '../../matrix/state/typingMembers';
import { PaneCollapsedContext } from '../../lib/hooks/usePaneCollapsed';
import { RoomViewTyping } from './RoomViewTyping';

vi.mock('./RoomViewTyping.css', () => ({
  TypingStrip: 'typing-strip',
  TypingStripArriving: 'typing-strip-arriving',
  DropButton: 'drop-button',
  TypingText: 'typing-text',
  TypingDots: 'typing-dots',
  TypingDot: 'typing-dot',
}));
const createMockEmitter = () => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    on: (event: string, listener: (...args: unknown[]) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    },
    removeListener: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener);
    },
    emit: (event: string, ...args: unknown[]) => {
      listeners.get(event)?.forEach((listener) => listener(...args));
    },
    clear: () => listeners.clear(),
  };
};
const mockMxEmitter = createMockEmitter();
const mockMx = {
  getUserId: () => '@me:example.org',
  on: mockMxEmitter.on,
  removeListener: mockMxEmitter.removeListener,
};
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => mockMx,
}));
// The helper's reply has no row on screen unless a test adds one.
let streamingReplyId: string | undefined;
let eventStreaming = true;
vi.mock('../../event-store/threads/useThreadStreamingState', () => ({
  getThreadStreamingEvents: () => [
    { getId: () => streamingReplyId, getSender: () => '@mindroom_helper:example.org' },
  ],
  isEventStreaming: () => eventStreaming,
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
const mockRoomEmitter = createMockEmitter();
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
  on: (event: string, listener: (...args: unknown[]) => void) =>
    mockRoomEmitter.on(event, listener),
  removeListener: (event: string, listener: (...args: unknown[]) => void) =>
    mockRoomEmitter.removeListener(event, listener),
} as unknown as Room;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  jobsState = [];
  activeRunsState = [];
  streamingReplyId = undefined;
  eventStreaming = true;
  mockMxEmitter.clear();
  mockRoomEmitter.clear();
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
    ({ ...place, left: 0, right: 300, width: 300, height: place.bottom - place.top }) as DOMRect;
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

it('tracks streaming reply visibility with scoped IntersectionObserver without scroll listeners or polling', async () => {
  const callbacksByTarget = new Map<Element, Set<IntersectionObserverCallback>>();
  const observe = vi.fn();
  const unobserve = vi.fn();
  const disconnect = vi.fn();
  const notifyTarget = (target: Element, isIntersecting: boolean) => {
    callbacksByTarget
      .get(target)
      ?.forEach((callback) =>
        callback(
          [{ target, isIntersecting } as unknown as IntersectionObserverEntry],
          {} as IntersectionObserver
        )
      );
  };
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      private callback: IntersectionObserverCallback;
      private targets = new Set<Element>();

      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }

      observe = (el: Element) => {
        observe(el);
        this.targets.add(el);
        const set = callbacksByTarget.get(el) ?? new Set();
        set.add(this.callback);
        callbacksByTarget.set(el, set);
      };

      unobserve = (el: Element) => {
        unobserve(el);
        this.targets.delete(el);
        callbacksByTarget.get(el)?.delete(this.callback);
      };

      disconnect = () => {
        disconnect();
        this.targets.forEach((el) => callbacksByTarget.get(el)?.delete(this.callback));
        this.targets.clear();
      };
    }
  );
  const addDocListener = vi.spyOn(document, 'addEventListener');
  const setIntervalSpy = vi.spyOn(window, 'setInterval');
  try {
    activeRunsState = [activeRunsFor(['$thread'])];
    streamingReplyId = '$io-streaming';
    const area = document.createElement('div');
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    scroller.getBoundingClientRect = () =>
      ({ top: 0, bottom: 700, left: 0, right: 390, width: 390, height: 700 }) as DOMRect;
    const rows = document.createElement('div');
    rows.setAttribute('data-timeline-rows', '');
    scroller.append(rows);
    area.append(scroller);
    document.body.append(area);
    const areaRef = { current: area };
    const store = createStore();
    typing(store, HELPER);

    container = document.createElement('div');
    area.append(container);
    act(() => {
      root = createRoot(container!);
      root.render(
        <Provider store={store}>
          <RoomViewTyping room={room} threadId="$thread" containerRef={areaRef} />
        </Provider>
      );
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Helper is typing...');
    expect(addDocListener).not.toHaveBeenCalledWith('scroll', expect.anything(), true);
    expect(setIntervalSpy).not.toHaveBeenCalled();

    const row = document.createElement('div');
    row.setAttribute('data-message-id', '$io-streaming');
    row.getBoundingClientRect = () =>
      ({ top: 100, bottom: 300, left: 0, right: 300, width: 300, height: 200 }) as DOMRect;
    await act(async () => {
      rows.append(row);
    });
    expect(observe).toHaveBeenCalledWith(row);
    expect(container.querySelector('[role="status"]')).toBeNull();

    // Scroll off-screen via IntersectionObserver: typing strip appears without polling.
    act(() => notifyTarget(row, false));
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Helper is typing...');

    // Back in view: typing strip hides again.
    act(() => notifyTarget(row, true));
    expect(container.querySelector('[role="status"]')).toBeNull();
    area.remove();
  } finally {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});

it('pauses typing subscriptions and renders nothing while its pane is collapsed', () => {
  const store = createStore();
  typing(store, '@avery:example.org');
  container = document.createElement('div');
  document.body.append(container);
  act(() => {
    root = createRoot(container!);
    root.render(
      <Provider store={store}>
        <PaneCollapsedContext.Provider value>
          <RoomViewTyping room={room} />
        </PaneCollapsedContext.Provider>
      </Provider>
    );
  });
  expect(container.querySelector('[role="status"]')).toBeNull();

  act(() => {
    root?.render(
      <Provider store={store}>
        <PaneCollapsedContext.Provider value={false}>
          <RoomViewTyping room={room} />
        </PaneCollapsedContext.Provider>
      </Provider>
    );
  });
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Avery is typing...');
});

it('updates the typing strip in place when an already-mounted tile transitions into and out of streaming', async () => {
  const observe = vi.fn();
  const unobserve = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = observe;
      unobserve = unobserve;
      disconnect = disconnect;
    }
  );
  try {
    activeRunsState = [activeRunsFor(['$thread'])];
    streamingReplyId = '$in-place';
    eventStreaming = false;

    const area = document.createElement('div');
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    scroller.getBoundingClientRect = () =>
      ({ top: 0, bottom: 700, left: 0, right: 390, width: 390, height: 700 }) as DOMRect;
    const rows = document.createElement('div');
    rows.setAttribute('data-timeline-rows', '');
    const row = document.createElement('div');
    row.setAttribute('data-message-id', '$in-place');
    row.getBoundingClientRect = () =>
      ({ top: 100, bottom: 260, left: 0, right: 300, width: 300, height: 160 }) as DOMRect;
    rows.append(row);
    scroller.append(rows);
    area.append(scroller);
    document.body.append(area);

    const store = createStore();
    typing(store, HELPER);
    container = document.createElement('div');
    area.append(container);
    act(() => {
      root = createRoot(container!);
      root.render(
        <Provider store={store}>
          <RoomViewTyping room={room} threadId="$thread" containerRef={{ current: area }} />
        </Provider>
      );
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Helper is typing...');
    expect(observe).not.toHaveBeenCalledWith(row);

    // Events from another room are ignored.
    const otherRoomEvent = { getRoomId: () => '!other:example.org', isRelation: () => false };
    eventStreaming = true;
    act(() => mockMxEmitter.emit(MatrixEventEvent.Decrypted, otherRoomEvent));
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Helper is typing...');

    // Decrypting in this room starts observing the already-mounted row and hides the strip.
    const roomEvent = { getRoomId: () => ROOM_ID, isRelation: () => false };
    act(() => mockMxEmitter.emit(MatrixEventEvent.Decrypted, roomEvent));
    expect(observe).toHaveBeenCalledWith(row);
    expect(container.querySelector('[role="status"]')).toBeNull();

    // Finishing edit (Replaced) stops observing the tile and brings the typing strip back.
    eventStreaming = false;
    act(() => mockMxEmitter.emit(MatrixEventEvent.Replaced, roomEvent));
    expect(unobserve).toHaveBeenCalledWith(row);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Helper is typing...');

    // Relation events (such as a stop reaction) on RoomEvent.Timeline also resync in place.
    const relationEvent = { getRoomId: () => ROOM_ID, isRelation: () => true };
    eventStreaming = true;
    act(() => mockRoomEmitter.emit(RoomEvent.Timeline, relationEvent, room));
    expect(container.querySelector('[role="status"]')).toBeNull();

    // Redacting the reaction via RoomEvent.Redaction resyncs back to typing.
    eventStreaming = false;
    act(() => mockRoomEmitter.emit(RoomEvent.Redaction, relationEvent, room));
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Helper is typing...');

    // Replacing the rows container rebinds the scoped MutationObserver to the new element.
    const replacementRows = document.createElement('div');
    replacementRows.setAttribute('data-timeline-rows', '');
    rows.replaceWith(replacementRows);
    eventStreaming = true;
    act(() => mockRoomEmitter.emit(RoomEvent.Timeline, roomEvent, room));
    const replacementRow = document.createElement('div');
    replacementRow.setAttribute('data-message-id', '$in-place');
    replacementRow.getBoundingClientRect = () =>
      ({ top: 100, bottom: 260, left: 0, right: 300, width: 300, height: 160 }) as DOMRect;
    await act(async () => {
      replacementRows.append(replacementRow);
    });
    expect(observe).toHaveBeenCalledWith(replacementRow);
    expect(container.querySelector('[role="status"]')).toBeNull();

    area.remove();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('does not observe the enclosing room container with a subtree MutationObserver in Compact mode', () => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
  const observeSpy = vi.spyOn(MutationObserver.prototype, 'observe');
  const area = document.createElement('div');
  document.body.append(area);
  try {
    const store = createStore();
    typing(store, HELPER);
    container = document.createElement('div');
    area.append(container);
    act(() => {
      root = createRoot(container!);
      root.render(
        <Provider store={store}>
          <RoomViewTyping room={room} containerRef={{ current: area }} />
        </Provider>
      );
    });

    expect(container.querySelector('[role="status"]')?.textContent).toBe('Helper is typing...');
    expect(observeSpy).not.toHaveBeenCalled();

    // Mounting [data-timeline-rows] later and receiving a timeline event binds a direct-children observer only.
    const rows = document.createElement('div');
    rows.setAttribute('data-timeline-rows', '');
    area.append(rows);
    const roomEvent = { getRoomId: () => ROOM_ID, isRelation: () => false };
    act(() => mockRoomEmitter.emit(RoomEvent.Timeline, roomEvent, room));

    expect(observeSpy).toHaveBeenCalledWith(rows, { childList: true });
    expect(observeSpy).not.toHaveBeenCalledWith(area, expect.anything());
  } finally {
    area.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});
