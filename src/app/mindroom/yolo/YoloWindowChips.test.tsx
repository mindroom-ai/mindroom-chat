// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import type { YoloWindow } from './yoloContract';
import { YoloWindowChips } from './YoloWindowChips';

const state = vi.hoisted(() => ({ windows: [] as YoloWindow[], hour24Clock: false }));
vi.mock('./useRoomYoloWindows', () => ({ useRoomYoloWindows: () => state.windows }));
vi.mock('../../state/hooks/settings', () => ({
  useSetting: () => [state.hour24Clock, () => undefined],
}));
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
const time = (expiresAt: number, extra: Intl.DateTimeFormatOptions = {}) =>
  new Date(expiresAt).toLocaleString('en', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: !state.hour24Clock,
    ...extra,
  });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.windows = [];
  state.hour24Clock = false;
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

it('follows the 24-hour clock setting, and names the day of an end that is not today', () => {
  state.hour24Clock = true;
  const tomorrow = new Date(NOW);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 30, 0, 0);
  state.windows = [{ threadId: '$thread', requesterId: ME, expiresAt: tomorrow.getTime() }];
  render();
  const [chip] = chips();
  expect(chip.textContent).toBe(
    `mindroomUi.yolo.ownLabel${JSON.stringify({
      name: 'alice',
      time: time(tomorrow.getTime(), { weekday: 'short' }),
    })}`
  );
  expect(chip.textContent).toContain('09:30');
});

it('drops a window that ended while the device slept once the page comes back', () => {
  state.windows = [{ threadId: '$thread', requesterId: ME, expiresAt: NOW + 60_000 }];
  render();
  expect(chips()).toHaveLength(1);
  // A sleeping device runs no timers, so only the wall clock moves.
  vi.setSystemTime(NOW + 10 * 60_000);
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(chips()).toHaveLength(0);
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
