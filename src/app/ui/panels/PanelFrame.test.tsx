// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelFrameProvider, type PanelFrame } from './PanelFrame';
import { usePanelSlot } from './panelPresence';
import { ResizablePanel } from './ResizablePanel';
import type { PanelLayout } from './roomPanels';

// A room's side panel in its frame (ResizablePanel inside a PanelFrameProvider), in each layout.

/** The panel in a frame of `layout` (none when undefined), keyed as the room keys it. */
const framed = (
  layout: PanelLayout | undefined,
  setLayout: PanelFrame['setLayout'],
  minContentWidth = 0
) => (
  <PanelFrameProvider key="notes" value={layout && { label: 'Notes', layout, setLayout }}>
    <ResizablePanel
      storageKey="test.width"
      defaultWidth={300}
      resizeLabel="Resize"
      collapseLabel="Close"
      testId="panel"
      side="end"
      minContentWidth={minContentWidth}
    >
      <p>content</p>
    </ResizablePanel>
  </PanelFrameProvider>
);

/** A row wide enough for the panel at its default width, unless `width` says otherwise. */
const row = (width = 3000) => {
  const element = document.body.appendChild(document.createElement('div'));
  Object.defineProperty(element, 'clientWidth', { value: width });
  return element;
};

const renderFramed = (layout: PanelLayout | undefined) => {
  const setLayout = vi.fn<PanelFrame['setLayout']>();
  render(framed(layout, setLayout), { container: row() });
  return setLayout;
};

/** The room's place for its side panel, which moves a panel in and out. */
function Slot({ panel }: { panel?: ReactElement }) {
  return <>{usePanelSlot(panel)}</>;
}

const panel = () => screen.getByTestId('panel');
const content = () => screen.getByText('content').parentElement!;
const separator = () => screen.queryByRole('separator');

describe('the frame of a side panel', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('draws nothing of its own around a panel outside a frame', () => {
    renderFramed(undefined);
    expect(panel().style.width).toBe('300px');
    expect(content().style.getPropertyValue('--mr-panel-content-width')).toBe('300px');
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(separator()).not.toBeNull();
  });

  it('beside the conversation, keeps the resizable column and offers Fill and Fold', async () => {
    const setLayout = renderFramed('beside');
    expect(panel().style.width).toBe('300px');
    // The strip at the start edge takes its width from the content.
    expect(content().style.getPropertyValue('--mr-panel-content-width')).toBe('260px');
    expect(separator()).not.toBeNull();
    const fill = screen.getByRole('button', { name: 'Fill the room with Notes' });
    expect(fill.getAttribute('aria-pressed')).toBe('false');
    await act(async () => fill.click());
    expect(setLayout).toHaveBeenLastCalledWith('filled');
    await act(async () => screen.getByRole('button', { name: 'Fold Notes to the edge' }).click());
    expect(setLayout).toHaveBeenLastCalledWith('folded');
  });

  it('keeps the content as wide as an unframed panel allows at its narrowest', () => {
    localStorage.setItem('test.width', JSON.stringify(100));
    renderFramed('beside');
    // The strip adds its width to the smallest panel, so the content keeps its own smallest width.
    expect(panel().style.width).toBe('240px');
    expect(content().style.getPropertyValue('--mr-panel-content-width')).toBe('200px');
    expect(separator()?.getAttribute('aria-valuemin')).toBe('240');
  });

  it('keeps that smallest width in a room too narrow for the panel and the conversation', () => {
    render(framed('beside', vi.fn(), 360), { container: row(500) });
    expect(panel().style.width).toBe('240px');
    expect(content().style.getPropertyValue('--mr-panel-content-width')).toBe('200px');
  });

  it('filling the room, takes its full width with no splitter, and Fill brings it back', async () => {
    const setLayout = renderFramed('filled');
    expect(panel().style.width).toBe('100%');
    // The content takes the room's width but for the strip, so its end edge stays in view.
    expect(content().style.getPropertyValue('--mr-panel-content-width')).toBe('calc(100% - 40px)');
    expect(separator()).toBeNull();
    const fill = screen.getByRole('button', { name: 'Fill the room with Notes' });
    expect(fill.getAttribute('aria-pressed')).toBe('true');
    await act(async () => fill.click());
    expect(setLayout).toHaveBeenLastCalledWith('beside');
  });

  it('folded, shows only its tab and keeps its content mounted out of sight', async () => {
    const setLayout = renderFramed('folded');
    expect(panel().style.width).toBe('');
    expect(separator()).toBeNull();
    // Its styles hide the content beside the tab (PanelFrame.css.ts).
    expect(panel().dataset.folded).toBe('true');
    expect(content().firstElementChild?.textContent).toBe('Notes');
    const tab = screen.getByRole('button', { name: 'Unfold Notes' });
    expect(tab.textContent).toBe('Notes');
    expect(screen.getAllByRole('button')).toEqual([tab]);
    await act(async () => tab.click());
    expect(setLayout).toHaveBeenLastCalledWith('beside');
  });

  it.each(['filled', 'folded'] as const)(
    'drops a drag that the %s layout cut short, so the splitter drags again once back',
    (layout) => {
      const pointer = { button: 0, isPrimary: true, clientX: 500 };
      // jsdom has no pointer events or pointer capture.
      class TestPointerEvent extends MouseEvent {
        readonly pointerId: number;

        readonly isPrimary: boolean;

        constructor(type: string, init: PointerEventInit = {}) {
          super(type, init);
          this.pointerId = init.pointerId ?? 0;
          this.isPrimary = init.isPrimary ?? false;
        }
      }
      vi.stubGlobal('PointerEvent', TestPointerEvent);
      Object.assign(HTMLElement.prototype, {
        setPointerCapture: () => undefined,
        hasPointerCapture: () => false,
        releasePointerCapture: () => undefined,
      });
      try {
        const container = row();
        const { rerender } = render(framed('beside', vi.fn()), { container });
        fireEvent.pointerDown(separator()!, { ...pointer, pointerId: 1 });
        // Filled, the splitter goes away with the drag still on it; back beside, a new drag works.
        rerender(framed(layout, vi.fn()));
        rerender(framed('beside', vi.fn()));
        fireEvent.pointerDown(separator()!, { ...pointer, pointerId: 2 });
        fireEvent.pointerMove(separator()!, { ...pointer, pointerId: 2, clientX: 450 });
        expect(separator()?.getAttribute('aria-valuenow')).toBe('350');
      } finally {
        for (const name of ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture']) {
          Reflect.deleteProperty(HTMLElement.prototype, name);
        }
      }
    }
  );

  it('folded, closes at once instead of moving out from its width beside the conversation', () => {
    // jsdom has no Web Animations; a panel beside the conversation would move out with them.
    const animate = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
    try {
      const { rerender } = render(<Slot panel={framed('folded', vi.fn())} />, {
        container: row(),
      });
      rerender(<Slot />);
      expect(animate).not.toHaveBeenCalled();
      expect(screen.queryByTestId('panel')).toBeNull();
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    }
  });
});
