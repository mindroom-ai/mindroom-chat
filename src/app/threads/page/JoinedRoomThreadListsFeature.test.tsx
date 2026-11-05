// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  JoinedRoomThreadListsFeature,
  THREAD_LISTS_START_DELAY_MS,
} from './JoinedRoomThreadListsFeature';

const { state } = vi.hoisted(() => ({ state: { catchingUp: true, listCalls: 0 } }));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('../../matrix/hooks/useInitialClientCatchup', () => ({
  useInitialClientCatchup: () => state.catchingUp,
}));
vi.mock('./useJoinedRoomThreadLists', () => ({
  useJoinedRoomThreadLists: () => {
    state.listCalls += 1;
  },
}));

let host: HTMLDivElement;
let root: Root;

const render = () => act(() => root.render(<JoinedRoomThreadListsFeature />));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.catchingUp = true;
  state.listCalls = 0;
  host = document.createElement('div');
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('lists no thread while the first sync is still catching up', () => {
  render();
  act(() => {
    vi.advanceTimersByTime(THREAD_LISTS_START_DELAY_MS * 10);
  });

  expect(state.listCalls).toBe(0);
});

it('lists the joined rooms a while after the first sync caught up, once the page is idle', () => {
  render();
  state.catchingUp = false;
  render();

  act(() => {
    vi.advanceTimersByTime(THREAD_LISTS_START_DELAY_MS - 1);
  });
  expect(state.listCalls).toBe(0);

  act(() => {
    vi.advanceTimersByTime(1);
  });
  act(() => {
    vi.runOnlyPendingTimers();
  });
  expect(state.listCalls).toBeGreaterThan(0);
});

it('keeps listing when a later sync catches up again', () => {
  state.catchingUp = false;
  render();
  act(() => {
    vi.advanceTimersByTime(THREAD_LISTS_START_DELAY_MS);
  });
  act(() => {
    vi.runOnlyPendingTimers();
  });
  const calls = state.listCalls;
  expect(calls).toBeGreaterThan(0);

  state.catchingUp = true;
  render();

  expect(state.listCalls).toBeGreaterThan(calls);
});

it('starts its wait again when a reconnection catches up before the wait ends', () => {
  state.catchingUp = false;
  render();
  act(() => {
    vi.advanceTimersByTime(THREAD_LISTS_START_DELAY_MS - 1);
  });
  state.catchingUp = true;
  render();
  state.catchingUp = false;
  render();

  act(() => {
    vi.advanceTimersByTime(THREAD_LISTS_START_DELAY_MS - 1);
  });
  expect(state.listCalls).toBe(0);
  act(() => {
    vi.advanceTimersByTime(1);
  });
  act(() => {
    vi.runOnlyPendingTimers();
  });
  expect(state.listCalls).toBeGreaterThan(0);
});
