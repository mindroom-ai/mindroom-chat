// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { defined } from '../../../test/utils/defined';
import { useJoinedRoomThreadLists } from './useJoinedRoomThreadLists';

type Load = { roomId: string; onProgress?: () => void; signal?: AbortSignal; finish: () => void };
const { loads, completeRooms } = vi.hoisted(() => ({
  loads: [] as Load[],
  completeRooms: new Set<string>(),
}));

vi.mock('../../event-store/threads/roomThreadList', () => ({
  loadRoomThreads: (room: { roomId: string }, onProgress?: () => void, signal?: AbortSignal) =>
    new Promise<void>((resolve) => {
      loads.push({ roomId: room.roomId, onProgress, signal, finish: resolve });
    }),
  roomThreadListIsComplete: (room: { roomId: string }) => completeRooms.has(room.roomId),
}));

const rooms: Record<string, { membership: string; space?: boolean }> = {
  '!a': { membership: 'join' },
  '!b': { membership: 'join' },
  '!c': { membership: 'join' },
  '!d': { membership: 'join' },
  '!space': { membership: 'join', space: true },
  '!invite': { membership: 'invite' },
};
const client = {
  getRoom: (roomId: string) => {
    const room = rooms[roomId];
    return room
      ? { roomId, getMyMembership: () => room.membership, isSpaceRoom: () => !!room.space }
      : null;
  },
};
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));

const answers: boolean[] = [];

function Probe({ allPages = false }: { allPages?: boolean }) {
  answers.push(useJoinedRoomThreadLists(allPages));
  return null;
}

let host: HTMLDivElement;
let root: Root;
let store: ReturnType<typeof createStore>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  loads.length = 0;
  answers.length = 0;
  completeRooms.clear();
  store = createStore();
  host = document.createElement('div');
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

const mount = (roomIds: string[], allPages = false) => {
  store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: roomIds });
  act(() =>
    root.render(
      <Provider store={store}>
        <Probe allPages={allPages} />
      </Provider>
    )
  );
};

/** The room's first page arrives (the consumer leaves) and its load ends. */
const firstPage = async (load: Load) => {
  await act(async () => {
    load.onProgress?.();
    load.finish();
  });
};

it('lists the joined rooms that are not spaces, three at a time, first page only', async () => {
  mount(Object.keys(rooms));
  expect(loads.map((load) => load.roomId)).toEqual(['!a', '!b', '!c']);

  const [first] = loads;
  await firstPage(defined(first, 'the first load'));
  expect(first?.signal?.aborted).toBe(true);
  expect(loads.map((load) => load.roomId)).toEqual(['!a', '!b', '!c', '!d']);
});

it('lists a room once while the page stays open, and again on the next visit', async () => {
  mount(['!a']);
  await firstPage(defined(loads[0], 'the first load'));
  mount(['!a', '!b']);
  expect(loads.map((load) => load.roomId)).toEqual(['!a', '!b']);

  act(() => root.unmount());
  root = createRoot(host);
  mount(['!a', '!b']);
  expect(loads.map((load) => load.roomId)).toEqual(['!a', '!b', '!a', '!b']);
});

it('leaves the loads it started when the page closes', () => {
  mount(['!a', '!b']);
  act(() => root.unmount());
  root = createRoot(host);
  expect(loads.every((load) => load.signal?.aborted)).toBe(true);
});

it('with all pages, stays until each list ends and says whether every list is complete', async () => {
  mount(Object.keys(rooms), true);
  expect(loads.map((load) => load.roomId)).toEqual(['!a', '!b', '!c']);
  const first = defined(loads[0], 'the first load');

  // A page arrives: the page stays for the rest of the list and counts the room as not done.
  await act(async () => {
    first.onProgress?.();
  });
  expect(first.signal?.aborted).toBe(false);
  expect(loads).toHaveLength(3);
  expect(answers.at(-1)).toBe(false);

  // The list ends: the next room starts.
  completeRooms.add('!a');
  await act(async () => {
    first.onProgress?.();
    first.finish();
  });
  expect(loads.map((load) => load.roomId)).toEqual(['!a', '!b', '!c', '!d']);
  expect(answers.at(-1)).toBe(false);

  for (const roomId of ['!b', '!c', '!d']) completeRooms.add(roomId);
  await act(async () => {
    loads.slice(1).forEach((load) => {
      load.onProgress?.();
      load.finish();
    });
  });
  // Spaces and invites have no list of their own to wait for.
  expect(answers.at(-1)).toBe(true);
});
