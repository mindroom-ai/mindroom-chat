// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelHeaderControls } from './PanelFrame';
import { PanelFrameProvider, type PanelFrame } from './panelFrameContext';
import { usePanelSlot } from './panelPresence';
import { ResizablePanel, SIDE_PANEL_MAX_WIDTH } from './ResizablePanel';
import type { PanelLayout } from './roomPanels';

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
 * At the end of a 1000 px row (or `rowWidth`) that keeps 360 px for the conversation: the panel is
 * at most 600 px wide (or `maxPanelWidth`), and stays so as a drag goes on over the conversation. It
 * starts 400 px wide.
 */
const renderPanel = ({
  framed = true,
  maxPanelWidth,
  rowWidth = 1000,
  paddingInlineEnd,
  onExpand,
  expandLabel,
  collapsible = true,
  collapseLabel = 'Close',
}: {
  framed?: boolean;
  maxPanelWidth?: number;
  rowWidth?: number;
  paddingInlineEnd?: string;
  onExpand?: () => void;
  expandLabel?: string;
  collapsible?: boolean;
  collapseLabel?: string | null;
} = {}) => {
  const setLayout = vi.fn<PanelFrame['setLayout']>();
  const onCollapse = vi.fn();
  const row = document.body.appendChild(document.createElement('div'));
  Object.defineProperty(row, 'clientWidth', { value: rowWidth });
  if (paddingInlineEnd) row.style.paddingInlineEnd = paddingInlineEnd;
  render(
    <PanelFrameProvider
      value={framed ? { label: 'Notes', layout: 'beside', setLayout } : undefined}
    >
      <ResizablePanel
        storageKey="test.width"
        resizeLabel="Resize"
        collapseLabel={collapseLabel ?? undefined}
        testId="panel"
        side="end"
        minContentWidth={360}
        maxPanelWidth={maxPanelWidth}
        onCollapse={collapsible ? onCollapse : undefined}
        onExpand={onExpand}
        expandLabel={expandLabel}
      >
        <p>content</p>
      </ResizablePanel>
    </PanelFrameProvider>,
    { container: row }
  );
  return { setLayout, onCollapse, row };
};

const renderStatefulPanel = ({
  rowWidth = 1000,
  paddingInlineEnd,
  initialLayout = 'beside',
}: {
  rowWidth?: number;
  paddingInlineEnd?: string;
  initialLayout?: PanelLayout;
} = {}) => {
  const row = document.body.appendChild(document.createElement('div'));
  Object.defineProperty(row, 'clientWidth', { configurable: true, get: () => rowWidth });
  if (paddingInlineEnd) row.style.paddingInlineEnd = paddingInlineEnd;
  let updateLayout: ((next: PanelLayout) => void) | undefined;
  function Harness() {
    const [layout, setLayout] = useState<PanelLayout>(initialLayout);
    updateLayout = setLayout;
    return (
      <PanelFrameProvider value={{ label: 'Notes', layout, setLayout }}>
        <ResizablePanel
          storageKey="test.width"
          resizeLabel="Resize"
          collapseLabel="Close"
          testId="panel"
          side="end"
          minContentWidth={360}
        >
          <div>
            <PanelHeaderControls />
            <p>content</p>
          </div>
        </ResizablePanel>
      </PanelFrameProvider>
    );
  }
  const rendered = render(<Harness />, { container: row });
  return {
    row,
    unmount: rendered.unmount,
    setLayout: (next: PanelLayout) => {
      act(() => updateLayout?.(next));
    },
  };
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

  it('stays at its widest as the pointer goes far over the conversation, and fills the room on release, keeping its width', () => {
    const { setLayout, onCollapse } = renderPanel();
    dragTo(900);
    expect(screen.getByTestId('panel').style.width).toBe('600px');
    expect(screen.getByTestId('panel').style.marginInlineStart).toBe('');
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

  it('out past the threshold and back, resizes as any drag does', () => {
    const { setLayout } = renderPanel();
    dragTo(900);
    fireEvent.pointerMove(separator(), { clientX: 500 - (500 - 400) });
    expect(screen.getByTestId('panel').dataset.expandPreview).toBeUndefined();
    expect(screen.getByTestId('panel').style.width).toBe('500px');
    expect(separator().getAttribute('aria-valuetext')).toBeNull();
    release();
    expect(setLayout).not.toHaveBeenCalled();
    expect(stored()).toBe(500);
  });

  it('does not fill when pulled back and let go before the panel re-renders', () => {
    const { setLayout } = renderPanel();
    dragTo(900);
    act(() => {
      separator().dispatchEvent(
        new TestPointerEvent('pointermove', { bubbles: true, clientX: 500 - (500 - 400) })
      );
      separator().dispatchEvent(new TestPointerEvent('pointerup', { bubbles: true }));
    });
    expect(setLayout).not.toHaveBeenCalled();
    expect(stored()).toBe(500);
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

  it.each([2400, 4800])(
    'on a %i px row, grows past the old caps until the conversation keeps 360 px, then fills',
    (rowWidth) => {
      const { setLayout } = renderPanel({ maxPanelWidth: SIDE_PANEL_MAX_WIDTH, rowWidth });
      // It stops where the conversation keeps its minimum, and fills only 40 px past that.
      const widest = rowWidth - 360;
      dragTo(1800);
      expect(screen.getByTestId('panel').style.width).toBe('1800px');
      expect(screen.getByTestId('panel').dataset.expandPreview).toBeUndefined();
      fireEvent.pointerMove(separator(), { clientX: 500 - (widest + 39 - 400) });
      expect(screen.getByTestId('panel').style.width).toBe(`${widest}px`);
      expect(screen.getByTestId('panel').dataset.expandPreview).toBeUndefined();
      fireEvent.pointerMove(separator(), { clientX: 500 - (widest + 60 - 400) });
      expect(screen.getByTestId('panel').style.width).toBe(`${widest}px`);
      expect(screen.getByTestId('panel').dataset.expandPreview).toBe('true');
      release();
      expect(setLayout.mock.calls).toEqual([['filled']]);
    }
  );

  it('outside a frame, stops at its widest', () => {
    const { onCollapse } = renderPanel({ framed: false });
    dragTo(700);
    expect(screen.getByTestId('panel').style.width).toBe('600px');
    expect(screen.getByTestId('panel').dataset.expandPreview).toBeUndefined();
    release();
    expect(onCollapse).not.toHaveBeenCalled();
    expect(stored()).toBe(600);
  });

  it('charges progressively past maxWidth while capping elastic pull at 3 px', () => {
    renderPanel();
    const panel = screen.getByTestId('panel');
    const pill = separator().querySelector('[data-panel-handle-pill]');
    expect(pill?.getAttribute('aria-hidden')).toBe('true');

    dragTo(610);
    expect(panel.style.width).toBe('600px');
    expect(panel.dataset.dragging).toBe('true');
    expect(panel.dataset.expandCharging).toBe('true');
    expect(panel.style.getPropertyValue('--mr-expand-progress')).toBe('0.25');
    expect(panel.style.getPropertyValue('--mr-expand-pull')).toBe(
      `${Math.round(3 * Math.tanh(10 / 28))}px`
    );
    expect(Number.parseFloat(panel.style.getPropertyValue('--mr-expand-pull'))).toBeLessThanOrEqual(
      3
    );
    expect(panel.dataset.expandHighlight).toBeUndefined();
    expect(panel.dataset.expandPreview).toBeUndefined();
    expect(panel.querySelector('[data-panel-expand-ghost]')).toBeNull();

    fireEvent.pointerMove(separator(), { clientX: 500 - (620 - 400) });
    expect(panel.style.width).toBe('600px');
    expect(panel.dataset.expandCharging).toBe('true');
    expect(panel.style.getPropertyValue('--mr-expand-progress')).toBe('0.5');
    expect(panel.dataset.expandHighlight).toBe('true');
    expect(panel.dataset.expandPreview).toBeUndefined();
    expect(panel.querySelector('[data-panel-expand-ghost]')).toBeNull();

    fireEvent.pointerMove(separator(), { clientX: 500 - (640 - 400) });
    expect(panel.dataset.expandPreview).toBeUndefined();
    expect(panel.style.getPropertyValue('--mr-expand-pull')).toBe('3px');
  });

  it('renders an unclipped full-row snap preview ghost and resets elastic pull to 0 px when armed', () => {
    renderPanel({ maxPanelWidth: 600, rowWidth: 2000, paddingInlineEnd: '8px' });
    const panel = screen.getByTestId('panel');
    dragTo(660);

    expect(panel.style.width).toBe('600px');
    expect(panel.dataset.expandPreview).toBe('true');
    expect(panel.dataset.expandHighlight).toBe('true');
    expect(panel.style.getPropertyValue('--mr-expand-progress')).toBe('1');
    expect(panel.style.getPropertyValue('--mr-expand-pull')).toBe('0px');
    // Unclipped by maxPanelWidth + minContentWidth (960) and inset by both card gaps (2 * 8).
    expect(panel.style.getPropertyValue('--mr-expand-target-width')).toBe('1984px');
    const ghost = panel.querySelector('[data-panel-expand-ghost]');
    expect(ghost?.getAttribute('aria-hidden')).toBe('true');
    expect(ghost?.querySelector('[data-panel-expand-ghost-badge]')?.textContent).toBe(
      'Fill the room with Notes'
    );
  });

  it('omits the ghost badge when expandText is undefined and uses flat row width without end gap', () => {
    renderPanel({ framed: false, maxPanelWidth: 600, rowWidth: 1800, onExpand: vi.fn() });
    const panel = screen.getByTestId('panel');
    dragTo(660);

    expect(panel.dataset.expandPreview).toBe('true');
    expect(panel.style.getPropertyValue('--mr-expand-target-width')).toBe('1800px');
    const ghost = panel.querySelector('[data-panel-expand-ghost]');
    expect(ghost).not.toBeNull();
    expect(ghost?.querySelector('[data-panel-expand-ghost-badge]')).toBeNull();
  });

  it('clears charging, highlight, preview, ghost and CSS vars when pulled back below maxWidth', () => {
    const { setLayout } = renderPanel();
    const panel = screen.getByTestId('panel');
    dragTo(660);
    expect(panel.dataset.expandCharging).toBe('true');
    expect(panel.dataset.expandHighlight).toBe('true');
    expect(panel.dataset.expandPreview).toBe('true');
    expect(panel.querySelector('[data-panel-expand-ghost]')).not.toBeNull();

    // Back into charging range: preview and ghost drop, charging and highlight remain.
    fireEvent.pointerMove(separator(), { clientX: 500 - (620 - 400) });
    expect(panel.dataset.expandPreview).toBeUndefined();
    expect(panel.querySelector('[data-panel-expand-ghost]')).toBeNull();
    expect(panel.dataset.expandCharging).toBe('true');
    expect(panel.dataset.expandHighlight).toBe('true');

    // Back inside normal width range: all overdrag state clears while drag continues.
    fireEvent.pointerMove(separator(), { clientX: 500 - (550 - 400) });
    expect(panel.dataset.dragging).toBe('true');
    expect(panel.dataset.expandCharging).toBeUndefined();
    expect(panel.dataset.expandHighlight).toBeUndefined();
    expect(panel.dataset.expandPreview).toBeUndefined();
    expect(panel.style.getPropertyValue('--mr-expand-progress')).toBe('');
    expect(panel.style.getPropertyValue('--mr-expand-pull')).toBe('');
    expect(panel.style.getPropertyValue('--mr-expand-target-width')).toBe('');

    release();
    expect(panel.dataset.dragging).toBeUndefined();
    expect(setLayout).not.toHaveBeenCalled();
    expect(stored()).toBe(550);
  });

  it('sets data-just-filled on fill, clears after timeout or un-fill, and skips initial mount, folded unfold, and reduced motion', () => {
    vi.useFakeTimers();
    try {
      const initial = renderStatefulPanel({ rowWidth: 1000, initialLayout: 'filled' });
      expect(screen.getByTestId('panel').dataset.justFilled).toBeUndefined();
      initial.unmount();

      const { setLayout } = renderStatefulPanel({ rowWidth: 1000 });
      const panel = screen.getByTestId('panel');
      const fillButton = () => screen.getByRole('button', { name: 'Fill the room with Notes' });
      expect(panel.dataset.justFilled).toBeUndefined();

      dragTo(660);
      release();
      expect(panel.dataset.justFilled).toBe('true');

      act(() => {
        vi.advanceTimersByTime(749);
      });
      expect(panel.dataset.justFilled).toBe('true');

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(panel.dataset.justFilled).toBeUndefined();

      // Shrink back, fill again via button, then un-fill early: clears immediately.
      fireEvent.click(fillButton());
      fireEvent.click(fillButton());
      expect(panel.dataset.justFilled).toBe('true');
      fireEvent.click(fillButton());
      expect(panel.dataset.justFilled).toBeUndefined();

      // Unfolding straight from folded into filled does not pulse.
      setLayout('folded');
      setLayout('filled');
      expect(panel.dataset.justFilled).toBeUndefined();

      // Reduced motion skips the pulse.
      setLayout('beside');
      vi.stubGlobal('matchMedia', () => ({ matches: true }));
      fireEvent.click(fillButton());
      expect(panel.dataset.justFilled).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('charges collapse progressively below minWidth, caps inward pull at 3 px, and arms the fold chip', () => {
    renderPanel();
    const panel = screen.getByTestId('panel');

    dragTo(190);
    expect(panel.style.width).toBe('200px');
    expect(panel.dataset.dragging).toBe('true');
    expect(panel.dataset.collapseCharging).toBe('true');
    expect(panel.dataset.collapsePreview).toBeUndefined();
    expect(panel.style.getPropertyValue('--mr-collapse-progress')).toBe('0.25');
    expect(panel.style.getPropertyValue('--mr-collapse-pull')).toBe(
      `${Math.round(3 * Math.tanh(10 / 28))}px`
    );
    expect(panel.style.getPropertyValue('--mr-expand-progress')).toBe('');
    expect(panel.querySelector('[data-panel-collapse-overlay]')).toBeNull();

    fireEvent.pointerMove(separator(), { clientX: 500 - (160 - 400) });
    expect(panel.style.width).toBe('200px');
    expect(panel.dataset.collapseCharging).toBe('true');
    expect(panel.dataset.collapsePreview).toBe('true');
    expect(panel.style.getPropertyValue('--mr-collapse-progress')).toBe('1');
    expect(panel.style.getPropertyValue('--mr-collapse-pull')).toBe('3px');
    const overlay = panel.querySelector('[data-panel-collapse-overlay]');
    expect(overlay?.getAttribute('aria-hidden')).toBe('true');
    expect(overlay?.querySelector('[data-panel-collapse-badge]')?.textContent).toBe('Close');

    fireEvent.pointerMove(separator(), { clientX: 500 - (0 - 400) });
    expect(Number.parseFloat(panel.style.getPropertyValue('--mr-collapse-pull'))).toBe(3);
  });

  it('clears fold chip, charging state, and CSS vars on drag-back and guards pre-render release', () => {
    const { onCollapse } = renderPanel();
    const panel = screen.getByTestId('panel');

    dragTo(150);
    expect(panel.dataset.collapsePreview).toBe('true');
    expect(panel.querySelector('[data-panel-collapse-overlay]')).not.toBeNull();

    fireEvent.pointerMove(separator(), { clientX: 500 - (180 - 400) });
    expect(panel.dataset.collapsePreview).toBeUndefined();
    expect(panel.querySelector('[data-panel-collapse-overlay]')).toBeNull();
    expect(panel.dataset.collapseCharging).toBe('true');
    expect(panel.style.getPropertyValue('--mr-collapse-progress')).toBe('0.5');

    fireEvent.pointerMove(separator(), { clientX: 500 - (260 - 400) });
    expect(panel.dataset.dragging).toBe('true');
    expect(panel.dataset.collapseCharging).toBeUndefined();
    expect(panel.dataset.collapsePreview).toBeUndefined();
    expect(panel.style.getPropertyValue('--mr-collapse-progress')).toBe('');
    expect(panel.style.getPropertyValue('--mr-collapse-pull')).toBe('');

    // Armed, then pulled back and released before React re-renders: must not collapse.
    fireEvent.pointerMove(separator(), { clientX: 500 - (150 - 400) });
    act(() => {
      separator().dispatchEvent(
        new TestPointerEvent('pointermove', { bubbles: true, clientX: 500 - (240 - 400) })
      );
      separator().dispatchEvent(new TestPointerEvent('pointerup', { bubbles: true }));
    });
    expect(onCollapse).not.toHaveBeenCalled();
    expect(stored()).toBe(240);
  });

  it('clears collapse overlay and charging on exit phase while gliding out from minWidth', () => {
    const animateCalls: Keyframe[][] = [];
    const animateMock = vi.fn((keyframes: Keyframe[]) => {
      animateCalls.push(keyframes);
      return {
        playState: 'running',
        cancel: vi.fn(),
        finished: new Promise(() => undefined),
      } as unknown as Animation;
    });
    function SlotHarness() {
      const [open, setOpen] = useState(true);
      return usePanelSlot(
        open ? (
          <ResizablePanel
            key="notes"
            storageKey="test.width"
            resizeLabel="Resize"
            collapseLabel="Close"
            testId="panel"
            side="end"
            minContentWidth={360}
            onCollapse={() => setOpen(false)}
          >
            <p>content</p>
          </ResizablePanel>
        ) : undefined
      );
    }
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: animateMock,
    });
    try {
      const row = document.body.appendChild(document.createElement('div'));
      Object.defineProperty(row, 'clientWidth', { value: 1000 });
      render(<SlotHarness />, { container: row });
      const panel = screen.getByTestId('panel');

      dragTo(150);
      expect(panel.dataset.collapseCharging).toBe('true');
      expect(panel.dataset.collapsePreview).toBe('true');
      expect(panel.querySelector('[data-panel-collapse-overlay]')).not.toBeNull();

      release();
      expect(panel.style.width).toBe('200px');
      expect(panel.dataset.collapseCharging).toBeUndefined();
      expect(panel.dataset.collapsePreview).toBeUndefined();
      expect(panel.dataset.dragging).toBeUndefined();
      expect(panel.style.getPropertyValue('--mr-collapse-progress')).toBe('');
      expect(panel.style.getPropertyValue('--mr-collapse-pull')).toBe('');
      expect(panel.querySelector('[data-panel-collapse-overlay]')).toBeNull();
      expect(animateCalls.at(-1)).toEqual([
        { width: '200px', marginInlineStart: '0px' },
        { width: '0px', marginInlineStart: '0px' },
      ]);
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    }
  });

  it('leaves non-collapsible panels unaffected and omits the fold badge without collapseLabel', () => {
    renderPanel({ collapsible: false });
    const panel = screen.getByTestId('panel');
    dragTo(120);
    expect(panel.style.width).toBe('200px');
    expect(panel.dataset.collapseCharging).toBeUndefined();
    expect(panel.dataset.collapsePreview).toBeUndefined();
    expect(panel.style.getPropertyValue('--mr-collapse-progress')).toBe('');
    expect(panel.querySelector('[data-panel-collapse-overlay]')).toBeNull();
    expect(separator().getAttribute('aria-valuetext')).toBeNull();
    release();
    expect(stored()).toBe(200);

    cleanup();
    localStorage.setItem('test.width', JSON.stringify(400));
    renderPanel({ collapseLabel: null });
    const unlabeled = screen.getByTestId('panel');
    dragTo(150);
    expect(unlabeled.dataset.collapsePreview).toBe('true');
    const overlay = unlabeled.querySelector('[data-panel-collapse-overlay]');
    expect(overlay).not.toBeNull();
    expect(overlay?.querySelector('[data-panel-collapse-badge]')).toBeNull();
  });
});
