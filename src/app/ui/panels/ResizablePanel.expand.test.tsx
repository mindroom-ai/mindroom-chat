// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelFrameProvider, type PanelFrame } from './panelFrameContext';
import { ResizablePanel } from './ResizablePanel';

// A side panel in its frame fills the room when its splitter is let go past its widest, as the
// frame's Fill does, and still closes when dragged to nothing.

// jsdom has no pointer events or pointer capture.
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;

  readonly isPrimary: boolean;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.isPrimary = init.isPrimary ?? true;
  }
}

/**
 * At the end of a 1000 px row that keeps 360 px for the conversation: the panel is at most 600 px
 * wide, and a drag over the conversation reaches 960 px. It starts 400 px wide.
 */
const renderPanel = ({ framed = true }: { framed?: boolean } = {}) => {
  const setLayout = vi.fn<PanelFrame['setLayout']>();
  const onCollapse = vi.fn();
  const row = document.body.appendChild(document.createElement('div'));
  Object.defineProperty(row, 'clientWidth', { value: 1000 });
  render(
    <PanelFrameProvider
      value={framed ? { label: 'Notes', layout: 'beside', setLayout } : undefined}
    >
      <ResizablePanel
        storageKey="test.width"
        resizeLabel="Resize"
        collapseLabel="Close"
        testId="panel"
        side="end"
        minContentWidth={360}
        onCollapse={onCollapse}
      >
        <p>content</p>
      </ResizablePanel>
    </PanelFrameProvider>,
    { container: row }
  );
  return { setLayout, onCollapse };
};

const separator = () => screen.getByRole('separator', { name: 'Resize' });
const stored = () => JSON.parse(localStorage.getItem('test.width') ?? 'null') as unknown;

/** Drags the splitter from 400 px wide to `width` (the panel is at the row's end) and holds it. */
const dragTo = (width: number) => {
  fireEvent.pointerDown(separator(), { button: 0, clientX: 500 });
  fireEvent.pointerMove(separator(), { clientX: 500 - (width - 400) });
};
const release = () => fireEvent.pointerUp(separator());

describe('dragging a side panel past its widest', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('test.width', JSON.stringify(400));
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    Object.assign(HTMLElement.prototype, {
      setPointerCapture: () => undefined,
      hasPointerCapture: () => false,
      releasePointerCapture: () => undefined,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    for (const name of ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture']) {
      Reflect.deleteProperty(HTMLElement.prototype, name);
    }
  });

  it('follows the pointer over the conversation and fills the room, keeping its width', () => {
    const { setLayout, onCollapse } = renderPanel();
    dragTo(700);
    expect(screen.getByTestId('panel').style.width).toBe('700px');
    expect(screen.getByTestId('panel').dataset.expandPreview).toBe('true');
    expect(separator().getAttribute('aria-valuenow')).toBe('600');
    expect(separator().getAttribute('aria-valuetext')).toBe('Fill the room with Notes');
    release();
    expect(setLayout.mock.calls).toEqual([['filled']]);
    expect(onCollapse).not.toHaveBeenCalled();
    // Shrink brings it back at the width it had before the drag.
    expect(stored()).toBe(400);
    expect(screen.getByTestId('panel').style.width).toBe('400px');
  });

  it('keeps its widest when let go short of the threshold', () => {
    const { setLayout } = renderPanel();
    dragTo(630);
    expect(screen.getByTestId('panel').dataset.expandPreview).toBeUndefined();
    expect(separator().getAttribute('aria-valuetext')).toBeNull();
    release();
    expect(setLayout).not.toHaveBeenCalled();
    expect(stored()).toBe(600);
  });

  it('still closes when dragged to nothing', () => {
    const { setLayout, onCollapse } = renderPanel();
    dragTo(100);
    expect(separator().getAttribute('aria-valuetext')).toBe('Close');
    release();
    expect(onCollapse).toHaveBeenCalledOnce();
    expect(setLayout).not.toHaveBeenCalled();
    expect(stored()).toBe(400);
  });

  it('outside a frame, stops at its widest', () => {
    const { onCollapse } = renderPanel({ framed: false });
    dragTo(700);
    expect(screen.getByTestId('panel').style.width).toBe('600px');
    expect(screen.getByTestId('panel').dataset.expandPreview).toBeUndefined();
    release();
    expect(onCollapse).not.toHaveBeenCalled();
    expect(stored()).toBe(600);
  });
});
