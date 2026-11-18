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
import { useThreadKeys } from './useThreadKeys';

const ROOM = '!room:server';
const onExitThread = vi.fn();
const onOpenThread = vi.fn();
const onFocusComposer = vi.fn();
const onFocusThread = vi.fn();
const opened = vi.fn();
let store = createStore();
let area: HTMLElement;

const card = (id: string): HTMLElement =>
  area.querySelector<HTMLElement>(`[data-thread-root-id="${id}"]`)!;

const mount = (openThreadId?: string, viewMode: RoomViewMode = 'compact') =>
  renderHook(
    ({ threadId }: { threadId: string | undefined }) =>
      useThreadKeys({
        roomId: ROOM,
        areaRef: { current: area },
        openThreadId: threadId,
        viewMode,
        onOpenThread,
        onExitThread,
        onFocusComposer,
        onFocusThread,
      }),
    {
      initialProps: { threadId: openThreadId },
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
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.clearAllMocks();
  onFocusComposer.mockReset();
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

  it('goes one level in: to the cards, then into the focused card', () => {
    mount();
    expect(press('openThread')).toBe(true);
    expect(document.activeElement).toBe(card('$a'));
    expect(press('openThread')).toBe(true);
    expect(opened).toHaveBeenCalledWith('$a');
    expect(onOpenThread).not.toHaveBeenCalled();
  });

  it('goes to the card of the thread just left, and opens that thread where no cards show', () => {
    store.set(lastExitedThreadAtom, { roomId: ROOM, threadId: '$b' });
    mount();
    expect(press('openThread')).toBe(true);
    expect(document.activeElement).toBe(card('$b'));
    card('$b').blur();
    area.innerHTML = '';
    expect(press('openThread')).toBe(true);
    expect(onOpenThread).toHaveBeenCalledWith('$b');
    store.set(lastExitedThreadAtom, null);
    expect(press('openThread')).toBe(false);
  });

  it('goes one level out: from the thread to its card, then to the composer', () => {
    const { rerender } = mount('$b');
    expect(press('leaveThread')).toBe(true);
    expect(onExitThread).toHaveBeenCalledTimes(1);
    // The room shows without the thread a moment later.
    rerender({ threadId: undefined });
    expect(document.activeElement).toBe(card('$b'));
    // A room without a composer has nowhere further out: the keys stay the browser's.
    expect(press('leaveThread')).toBe(false);
    expect(document.activeElement).toBe(card('$b'));
    const composer = document.createElement('button');
    document.body.append(composer);
    onFocusComposer.mockImplementation(() => composer.focus());
    expect(press('leaveThread')).toBe(true);
    expect(document.activeElement).toBe(composer);
    composer.blur();
    expect(press('leaveThread')).toBe(false);
  });

  it("goes into the open thread from that thread's own card beside it", () => {
    mount('$b');
    card('$b').focus();
    expect(press('openThread')).toBe(true);
    expect(onFocusThread).toHaveBeenCalledTimes(1);
    expect(opened).not.toHaveBeenCalled();
    // Another thread's card opens that thread.
    card('$c').focus();
    expect(press('openThread')).toBe(true);
    expect(opened).toHaveBeenCalledWith('$c');
    expect(onFocusThread).toHaveBeenCalledTimes(1);
  });

  it('leaves the focus alone when the thread closed another way', () => {
    const { rerender } = mount('$b');
    rerender({ threadId: undefined });
    expect(document.activeElement).toBe(document.body);
  });

  it("moves the focus to the left thread's card from another card beside the thread", () => {
    const { rerender } = mount('$b');
    card('$c').focus();
    expect(press('leaveThread')).toBe(true);
    rerender({ threadId: undefined });
    expect(document.activeElement).toBe(card('$b'));
  });

  it('leaves the focus alone when the reader moved it before the thread closed', () => {
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    const { rerender } = mount('$b');
    expect(press('leaveThread')).toBe(true);
    elsewhere.focus();
    rerender({ threadId: undefined });
    expect(document.activeElement).toBe(elsewhere);
  });

  describe("a left thread's card that shows a pass later in the same task", () => {
    // Under a thread that fills the page the room has no cards, and its composer stays.
    let cards: string;
    let composer: HTMLElement;
    beforeEach(() => {
      cards = area.innerHTML;
      area.innerHTML =
        '<div data-room-footer="true"><div contenteditable="true" tabindex="0"></div></div>';
      composer = area.querySelector<HTMLElement>('[contenteditable]')!;
    });
    /** The room shows without the thread, its Compact list still holding its first build. */
    const leave = () => {
      const { rerender } = mount('$b');
      expect(press('leaveThread')).toBe(true);
      rerender({ threadId: undefined });
    };
    const showCards = (html = cards) => area.insertAdjacentHTML('afterbegin', html);

    it('takes the focus the page gave the composer as what the thread left', async () => {
      leave();
      composer.focus();
      showCards();
      await Promise.resolve();
      expect(document.activeElement).toBe(card('$b'));
    });

    it('takes the focus nothing claimed', async () => {
      leave();
      showCards();
      await Promise.resolve();
      expect(document.activeElement).toBe(card('$b'));
    });

    it('leaves the focus on another control that took it meanwhile', async () => {
      const search = document.createElement('input');
      area.append(search);
      const menuItem = document.createElement('button');
      document.body.append(menuItem);
      leave();
      search.focus();
      showCards();
      await Promise.resolve();
      expect(document.activeElement).toBe(search);

      area.querySelector('[data-compact-room-view]')?.remove();
      leave();
      composer.focus();
      menuItem.focus();
      showCards();
      await Promise.resolve();
      expect(document.activeElement).toBe(menuItem);
    });

    it('leaves the focus where it went when no card of the left thread shows', async () => {
      leave();
      composer.focus();
      showCards(
        '<div data-compact-room-view="true"><button data-thread-root-id="$a"></button></div>'
      );
      await Promise.resolve();
      expect(document.activeElement).toBe(composer);
    });
  });

  it('beside an open thread, starts at the card beside that thread', () => {
    mount('$b');
    expect(press('nextThread')).toBe(true);
    expect(document.activeElement).toBe(card('$c'));
    expect(onOpenThread).not.toHaveBeenCalled();
  });

  it('keeps the keys for the browser under a thread that fills the page', () => {
    area.innerHTML = '';
    mount('$b');
    expect(press('nextThread')).toBe(false);
    expect(press('previousThread')).toBe(false);
    expect(onOpenThread).not.toHaveBeenCalled();
  });

  it('opens no thread in the Classic view', () => {
    area.innerHTML = '';
    store.set(lastExitedThreadAtom, { roomId: ROOM, threadId: '$b' });
    mount(undefined, 'classic');
    expect(press('openThread')).toBe(false);
    expect(onOpenThread).not.toHaveBeenCalled();
  });

  it('leaves a thread behind a side panel alone', () => {
    area.innerHTML = '';
    store.set(conversationBehindPanelAtom, true);
    mount('$b');
    expect(press('leaveThread')).toBe(false);
    expect(onExitThread).not.toHaveBeenCalled();
  });
});
