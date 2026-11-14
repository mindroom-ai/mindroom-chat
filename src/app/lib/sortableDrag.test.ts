// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnimateLayoutChanges } from '@dnd-kit/sortable';
import {
  animateSortableLayoutDuringDrag,
  preventClickDefaultsDuringPointerDrag,
} from './sortableDrag';

const layoutArgs = (
  args: Partial<Parameters<AnimateLayoutChanges>[0]>
): Parameters<AnimateLayoutChanges>[0] => ({
  active: null,
  containerId: 'container',
  id: 'item-a',
  index: 0,
  isDragging: false,
  isSorting: false,
  items: ['item-a', 'item-b'],
  newIndex: 1,
  previousContainerId: 'container',
  previousItems: ['item-a', 'item-b'],
  transition: {
    duration: 200,
    easing: 'ease',
  },
  wasDragging: true,
  ...args,
});

describe('animateSortableLayoutDuringDrag', () => {
  it('keeps in-drag layout animation enabled', () => {
    expect(
      animateSortableLayoutDuringDrag(
        layoutArgs({
          active: {
            id: 'item-a',
            data: { current: undefined },
            rect: { current: {} },
          } as Parameters<AnimateLayoutChanges>[0]['active'],
          isSorting: true,
        })
      )
    ).toBe(true);
  });

  it('disables the post-drop layout animation that returns the drag source to its old slot', () => {
    expect(animateSortableLayoutDuringDrag(layoutArgs({ isSorting: false }))).toBe(false);
  });
});

describe('preventClickDefaultsDuringPointerDrag', () => {
  // A press on a button starts the drag, the way the drag library passes its activator event on.
  const startDrag = (type: 'mousedown' | 'touchstart' = 'mousedown') => {
    const button = document.createElement('button');
    document.body.append(button);
    button.addEventListener(type, preventClickDefaultsDuringPointerDrag);
    button.dispatchEvent(new MouseEvent(type, { bubbles: true }));
  };
  const release = (type: string) => {
    document.body.dispatchEvent(new MouseEvent(type, { bubbles: true }));
  };
  const clickActs = () => {
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(click);
    return !click.defaultPrevented;
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('keeps the click that ends a pointer drag from acting', () => {
    startDrag();
    release('mouseup');

    expect(clickActs()).toBe(false);
  });

  it('keeps the drop from acting however long the drag lasts', () => {
    startDrag();
    vi.advanceTimersByTime(2_000);
    release('mouseup');

    expect(clickActs()).toBe(false);
  });

  it('keeps every click from acting until the drag library lets clicks through, 50 ms after the release', () => {
    startDrag();
    release('mouseup');

    expect(clickActs()).toBe(false);
    expect(clickActs()).toBe(false);
    vi.advanceTimersByTime(50);
    expect(clickActs()).toBe(true);
  });

  it('ends with the release of the press that started the drag', () => {
    startDrag('touchstart');
    release('mouseup');
    vi.advanceTimersByTime(50);
    expect(clickActs()).toBe(false);

    release('touchend');
    vi.advanceTimersByTime(50);
    expect(clickActs()).toBe(true);
  });

  it('does not suppress clicks after keyboard drag activators', () => {
    preventClickDefaultsDuringPointerDrag(new KeyboardEvent('keydown', { key: ' ' }));

    expect(clickActs()).toBe(true);
  });
});
