// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, renderHook } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conversationBehindPanelAtom } from '../navigation/conversationCover';
import type { RoomViewMode } from '../navigation/roomViewMode';
import type { ShortcutId } from '../shortcuts/shortcuts';
import { runShortcut } from '../shortcuts/useShortcut';
import { lastExitedThreadAtom } from '../threads/lastExitedThread';
import { noteCompactCardOrder } from '../threads/overview/compactCardKeys';
import { useThreadKeys } from './useThreadKeys';

const ROOM = '!room:server';
const onExitThread = vi.fn();
const onOpenThread = vi.fn();
const opened = vi.fn();
let store = createStore();
let area: HTMLElement;

const card = (id: string): HTMLElement =>
  area.querySelector<HTMLElement>(`[data-thread-root-id="${id}"]`)!;

const mount = (openThreadId?: string, viewMode: RoomViewMode = 'compact') =>
  renderHook(
    () =>
      useThreadKeys({
        roomId: ROOM,
        areaRef: { current: area },
        openThreadId,
        viewMode,
        onOpenThread,
        onExitThread,
      }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider store={store}>{children}</Provider>
      ),
    }
  );

const press = (id: ShortcutId, init: KeyboardEventInit = {}): boolean =>
  runShortcut(id, new KeyboardEvent('keydown', init));

beforeEach(() => {
  store = createStore();
  area = document.createElement('div');
  area.innerHTML = `<div data-compact-room-view="true">${['$a', '$b', '$c']
    .map((id) => `<button data-thread-root-id="${id}"></button>`)
    .join('')}</div>`;
  area.addEventListener('click', (event) =>
    opened((event.target as HTMLElement).dataset.threadRootId)
  );
  document.body.append(area);
  noteCompactCardOrder(ROOM, ['$a', '$b', '$c']);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('useThreadKeys', () => {
  it('moves the focus into the cards and through them', () => {
    mount();
    expect(press('nextThread')).toBe(true);
    expect(document.activeElement).toBe(card('$a'));
    expect(press('nextThread')).toBe(true);
    expect(document.activeElement).toBe(card('$b'));
    expect(press('previousThread')).toBe(true);
    expect(document.activeElement).toBe(card('$a'));
    expect(onOpenThread).not.toHaveBeenCalled();
  });

  it('starts beside the thread just left', () => {
    store.set(lastExitedThreadAtom, { roomId: ROOM, threadId: '$b' });
    mount();
    expect(press('nextThread')).toBe(true);
    expect(document.activeElement).toBe(card('$c'));
  });

  it('opens the focused card, or the thread just left again', () => {
    mount();
    expect(press('openThread')).toBe(false);
    store.set(lastExitedThreadAtom, { roomId: ROOM, threadId: '$b' });
    expect(press('openThread')).toBe(true);
    expect(onOpenThread).toHaveBeenCalledWith('$b');
    card('$c').focus();
    expect(press('openThread')).toBe(true);
    expect(opened).toHaveBeenCalledWith('$c');
  });

  it('leaves the open thread, and does nothing without one', () => {
    const { unmount } = mount();
    expect(press('leaveThread')).toBe(false);
    unmount();
    mount('$b');
    expect(press('leaveThread')).toBe(true);
    expect(onExitThread).toHaveBeenCalledTimes(1);
  });

  it('in a thread that fills the page, opens the thread above or below once per press', () => {
    area.innerHTML = '';
    mount('$b');
    expect(press('nextThread')).toBe(true);
    expect(onOpenThread).toHaveBeenLastCalledWith('$c');
    expect(press('previousThread')).toBe(true);
    expect(onOpenThread).toHaveBeenLastCalledWith('$a');
    expect(press('nextThread', { repeat: true })).toBe(true);
    expect(onOpenThread).toHaveBeenCalledTimes(2);
  });

  it('keeps the keys for the browser past the last thread, and outside Compact', () => {
    area.innerHTML = '';
    const { unmount } = mount('$c');
    expect(press('nextThread')).toBe(false);
    unmount();
    mount('$b', 'threaded');
    expect(press('nextThread')).toBe(false);
    expect(onOpenThread).not.toHaveBeenCalled();
  });

  it('leaves a thread behind a side panel alone', () => {
    area.innerHTML = '';
    store.set(conversationBehindPanelAtom, true);
    mount('$b');
    expect(press('leaveThread')).toBe(false);
    expect(press('nextThread')).toBe(false);
    expect(onExitThread).not.toHaveBeenCalled();
  });
});
