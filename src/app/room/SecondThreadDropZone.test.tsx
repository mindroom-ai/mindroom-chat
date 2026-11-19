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
const startDrag = (dataTransfer: ReturnType<typeof dragData>, from: Element = document.body) => {
  fireEvent.dragStart(from, { dataTransfer });
  act(() => {
    vi.runAllTimers();
  });
};

// A drag starting at x on the page.
const startDragAt = (x: number) => {
  const start = new MouseEvent('dragstart', { bubbles: true, clientX: x, clientY: 100 });
  Object.defineProperty(start, 'dataTransfer', { value: threadDrag('$c') });
  document.body.dispatchEvent(start);
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
  it('goes as the drag ends on its card, also one that left the page, which the window misses', async () => {
    render(<SecondThreadDropZone widthKey={WIDTH_KEY} onOpen={vi.fn()} />);
    const card = document.createElement('div');
    document.body.append(card);
    fireEvent.dragStart(card, { dataTransfer: threadDrag() });
    act(() => {
      vi.runAllTimers();
    });
    // The card's own end, which does not reach the window.
    act(() => {
      card.dispatchEvent(new Event('dragend'));
    });
    expect(zone()).toBeNull();
    // A card that leaves the page mid-drag ends it: its end may never come.
    fireEvent.dragStart(card, { dataTransfer: threadDrag() });
    act(() => {
      vi.runAllTimers();
    });
    expect(zone()).not.toBeNull();
    await act(async () => card.remove());
    expect(zone()).toBeNull();
  });

  it('shows nothing for a drag its card refused', () => {
    render(<SecondThreadDropZone widthKey={WIDTH_KEY} onOpen={vi.fn()} />);
    const card = document.createElement('div');
    document.body.append(card);
    card.addEventListener('dragstart', (evt) => evt.preventDefault());
    startDrag(threadDrag(), card);
    expect(zone()).toBeNull();
    card.remove();
  });

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

  it("takes a drag that shows its thread only as it starts, as the Mac app's WebKit does", () => {
    const onOpen = vi.fn();
    render(<SecondThreadDropZone widthKey={WIDTH_KEY} onOpen={onOpen} />);
    startDrag(threadDrag('$c'));
    const target = zone()!;
    // Mac Catalyst's WebKit lists a custom type as the drag starts and not again before the drop.
    const dataTransfer = dragData({});
    expect(fireEvent.dragEnter(target, { dataTransfer })).toBe(false);
    expect(fireEvent.dragOver(target, { dataTransfer })).toBe(false);
    expect(target.dataset.over).toBe('true');
    fireEvent.drop(target, { dataTransfer });
    expect(onOpen.mock.calls).toEqual([['!room:example.org', '$c']]);
  });

  it('takes no other drag for a thread whose drag the page did not hear end', () => {
    const onOpen = vi.fn();
    render(<SecondThreadDropZone widthKey={WIDTH_KEY} onOpen={onOpen} />);
    // A file dragged in from another app starts no drag on the page: the zone still shows.
    startDrag(threadDrag('$c'));
    const files = dragData({ Files: '' });
    expect(fireEvent.dragEnter(zone()!, { dataTransfer: files })).toBe(true);
    expect(fireEvent.dragOver(zone()!, { dataTransfer: files })).toBe(true);
    expect(zone()!.dataset.over).toBeUndefined();
    fireEvent.drop(zone()!, { dataTransfer: files });
    expect(onOpen).not.toHaveBeenCalled();
    // Any other drag that starts on the page ends the thread's.
    startDrag(threadDrag('$c'));
    expect(zone()).not.toBeNull();
    startDrag(dragData({ 'text/plain': 'example' }));
    expect(zone()).toBeNull();
  });

  it('takes no drop from a drag that started where the zone shows until it left the zone', () => {
    const onOpen = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(1000, 0, 480, 800)
    );
    render(<SecondThreadDropZone widthKey={WIDTH_KEY} onOpen={onOpen} />);
    // A card's end under the zone, picked up there.
    startDragAt(1200);
    const target = zone()!;
    const dataTransfer = threadDrag('$c');
    expect(fireEvent.dragEnter(target, { dataTransfer })).toBe(true);
    expect(fireEvent.dragOver(target, { dataTransfer })).toBe(true);
    expect(target.dataset.over).toBeUndefined();
    fireEvent.drop(target, { dataTransfer });
    expect(onOpen).not.toHaveBeenCalled();
    // Out of the zone and back, it takes the drop.
    startDragAt(1200);
    fireEvent.dragLeave(zone()!, { dataTransfer, relatedTarget: document.body });
    expect(fireEvent.dragEnter(zone()!, { dataTransfer })).toBe(false);
    fireEvent.drop(zone()!, { dataTransfer });
    expect(onOpen.mock.calls).toEqual([['!room:example.org', '$c']]);
    vi.restoreAllMocks();
  });

  it('takes the drop of a drag picked up under the zone that left it before the zone heard it', () => {
    const onOpen = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(1000, 0, 480, 800)
    );
    render(<SecondThreadDropZone widthKey={WIDTH_KEY} onOpen={onOpen} />);
    startDragAt(1200);
    // The drag moves over the room's messages first; the zone hears no leave.
    document.body.dispatchEvent(
      new MouseEvent('dragover', { bubbles: true, clientX: 400, clientY: 100 })
    );
    const dataTransfer = threadDrag('$c');
    expect(fireEvent.dragEnter(zone()!, { dataTransfer })).toBe(false);
    fireEvent.drop(zone()!, { dataTransfer });
    expect(onOpen.mock.calls).toEqual([['!room:example.org', '$c']]);
    vi.restoreAllMocks();
  });

  it('takes the drop of a drag picked up under the zone whose one move off it was an enter', () => {
    const onOpen = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(1000, 0, 480, 800)
    );
    render(<SecondThreadDropZone widthKey={WIDTH_KEY} onOpen={onOpen} />);
    startDragAt(1200);
    // One step onto the messages: an enter there, no move over them, no leave from the zone.
    document.body.dispatchEvent(
      new MouseEvent('dragenter', { bubbles: true, clientX: 400, clientY: 100 })
    );
    const dataTransfer = threadDrag('$c');
    expect(fireEvent.dragEnter(zone()!, { dataTransfer })).toBe(false);
    fireEvent.drop(zone()!, { dataTransfer });
    expect(onOpen.mock.calls).toEqual([['!room:example.org', '$c']]);
    vi.restoreAllMocks();
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
