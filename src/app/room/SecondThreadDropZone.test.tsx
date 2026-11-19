// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THREAD_DRAG_TYPE } from '../navigation/secondThread';
import { SecondThreadDropZone } from './SecondThreadDropZone';

const WIDTH_KEY = 'example.secondThread.width';

// A test's stand-in for the browser's drag data, which jsdom lacks.
const dragData = (entries: Record<string, string>) => ({
  types: Object.keys(entries),
  getData: (type: string) => entries[type] ?? '',
  dropEffect: 'none',
});
const threadDrag = (rootId = '$b', roomId = '!room:example.org') =>
  dragData({ [THREAD_DRAG_TYPE]: JSON.stringify({ roomId, rootId }) });
const zone = () => screen.queryByTestId('second-thread-drop-zone');
// A drag starting somewhere on the page, which the window hears.
const startDrag = (dataTransfer: ReturnType<typeof dragData>) => {
  fireEvent.dragStart(document.body, { dataTransfer });
  act(() => {
    vi.runAllTimers();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the drop zone of the second column', () => {
  it("shows while a thread card's drag is under way, and not for a file's", () => {
    render(<SecondThreadDropZone widthKey={WIDTH_KEY} onOpen={vi.fn()} />);
    expect(zone()).toBeNull();
    startDrag(dragData({ Files: '' }));
    expect(zone()).toBeNull();
    fireEvent.dragEnd(document.body);
    startDrag(threadDrag());
    expect(zone()?.textContent).toContain('Drop to open in second column');
    // A mouse's affordance: the thread menu's entry is the way for the keyboard and readers.
    expect(zone()?.getAttribute('aria-hidden')).toBe('true');
  });

  it("takes the second column's stored width, or the default one", () => {
    render(<SecondThreadDropZone widthKey={WIDTH_KEY} onOpen={vi.fn()} />);
    startDrag(threadDrag());
    expect(zone()?.style.width).toBe('480px');
    fireEvent.dragEnd(document.body);
    localStorage.setItem(WIDTH_KEY, '620');
    startDrag(threadDrag());
    expect(zone()?.style.width).toBe('620px');
  });

  it('lights up under the drag and opens the dropped thread in the second column', () => {
    const onOpen = vi.fn();
    render(<SecondThreadDropZone widthKey={WIDTH_KEY} onOpen={onOpen} />);
    startDrag(threadDrag('$c'));
    const target = zone()!;
    const dataTransfer = threadDrag('$c');
    // Over the zone the drag may drop (its default prevented), and the zone shows it takes it.
    expect(fireEvent.dragEnter(target, { dataTransfer })).toBe(false);
    expect(fireEvent.dragOver(target, { dataTransfer })).toBe(false);
    expect(target.dataset.over).toBe('true');
    fireEvent.dragLeave(target, { dataTransfer, relatedTarget: document.body });
    expect(target.dataset.over).toBeUndefined();
    fireEvent.dragEnter(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    expect(onOpen.mock.calls).toEqual([['!room:example.org', '$c']]);
    expect(zone()).toBeNull();
  });

  it('goes as the drag ends anywhere else, or Escape cancels it', () => {
    const onOpen = vi.fn();
    render(<SecondThreadDropZone widthKey={WIDTH_KEY} onOpen={onOpen} />);
    startDrag(threadDrag());
    // Escape cancels a drag: the browser ends it.
    fireEvent.dragEnd(document.body);
    expect(zone()).toBeNull();
    startDrag(threadDrag());
    fireEvent.drop(document.body, { dataTransfer: threadDrag() });
    expect(zone()).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
