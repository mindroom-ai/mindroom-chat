// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import type { YoloWindow } from './yoloContract';
import { YoloWindowChips } from './YoloWindowChips';

const state = vi.hoisted(() => ({ windows: [] as YoloWindow[] }));
vi.mock('./useRoomYoloWindows', () => ({ useRoomYoloWindows: () => state.windows }));
vi.mock('./YoloWindowChips.css', () => ({ Chip: 'Chip' }));
vi.mock('../../hooks/useAppLanguageCode', () => ({ useAppLanguageCode: () => 'en' }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      `${key}${values ? JSON.stringify(values) : ''}`,
  }),
}));

const ME = '@alice:example.org';
const NOW = Date.parse('2026-10-22T15:00:00Z');
const room = {
  myUserId: ME,
  getMember: (userId: string) => (userId === '@bob:example.org' ? { name: 'Bob' } : null),
} as unknown as Room;
let container: HTMLDivElement;
let root: Root;

const chips = () => [...container.querySelectorAll('span.Chip')];
const render = () =>
  act(() => {
    root.render(<YoloWindowChips room={room} threadId="$thread" />);
  });
const time = (expiresAt: number) =>
  new Date(expiresAt).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.windows = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('shows nothing without an open window in the thread', () => {
  state.windows = [
    { threadId: '$other', requesterId: ME, expiresAt: NOW + 60_000 },
    { threadId: '$thread', requesterId: ME, expiresAt: NOW - 1 },
  ];
  render();
  expect(container.innerHTML).toBe('');
});

it('names the viewer’s own window and someone else’s, with when each ends', () => {
  const ownEnd = NOW + 30 * 60_000;
  const bobEnd = NOW + 2 * 60 * 60_000;
  state.windows = [
    { threadId: '$thread', requesterId: '@bob:example.org', expiresAt: bobEnd },
    { threadId: '$thread', requesterId: ME, expiresAt: ownEnd },
  ];
  render();
  const [own, bob] = chips();
  expect(own.textContent).toBe(
    `mindroomUi.yolo.ownLabel${JSON.stringify({ name: 'alice', time: time(ownEnd) })}`
  );
  expect(own.getAttribute('title')).toContain('mindroomUi.yolo.ownDetail');
  expect(bob.textContent).toBe(
    `mindroomUi.yolo.otherLabel${JSON.stringify({ name: 'Bob', time: time(bobEnd) })}`
  );
  expect(bob.getAttribute('title')).toContain('mindroomUi.yolo.otherDetail');
});

it('drops a window once it ends', () => {
  state.windows = [{ threadId: '$thread', requesterId: ME, expiresAt: NOW + 60_000 }];
  render();
  expect(chips()).toHaveLength(1);
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(chips()).toHaveLength(0);
});
