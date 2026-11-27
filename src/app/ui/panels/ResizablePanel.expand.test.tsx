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
    const [open, setOpen] = useState(true);
    updateLayout = setLayout;
    return usePanelSlot(
      open ? (
        <PanelFrameProvider key="notes" value={{ label: 'Notes', layout, setLayout }}>
          <ResizablePanel
            storageKey="test.width"
            resizeLabel="Resize"
            collapseLabel="Close"
            testId="panel"
            side="end"
            minContentWidth={360}
            onCollapse={() => setOpen(false)}
          >
            <div>
              <PanelHeaderControls />
              <p>content</p>
            </div>
          </ResizablePanel>
        </PanelFrameProvider>
      ) : undefined
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

const panelEl = () => screen.getByTestId('panel');
const separator = () => screen.getByRole('separator', { name: 'Resize' });
const IDLE_COLLAPSE = {
  width: '200px',
  charging: undefined as string | undefined,
  preview: undefined as string | undefined,
  progress: '',
  pull: '',
  overlay: false,
};
const ARMED_COLLAPSE = {
  charging: 'true',
  preview: 'true',
  progress: '1',
  pull: '3px',
  overlay: true,
};
const expectCollapse = (expected: Partial<typeof IDLE_COLLAPSE> = {}) =>
  expect({
    width: panelEl().style.width,
    charging: panelEl().dataset.collapseCharging,
    preview: panelEl().dataset.collapsePreview,
    progress: panelEl().style.getPropertyValue('--mr-collapse-progress'),
    pull: panelEl().style.getPropertyValue('--mr-collapse-pull'),
    overlay: panelEl().querySelector('[data-panel-collapse-overlay]') !== null,
  }).toEqual({ ...IDLE_COLLAPSE, ...expected });
const stored = () => JSON.parse(localStorage.getItem('test.width') ?? 'null') as unknown;

const moveTo = (width: number) =>
  fireEvent.pointerMove(separator(), { clientX: 500 - (width - 400) });
/** Drags the splitter from 400 px wide to `width` (the panel is at the row's end) and holds it. */
const dragTo = (width: number) => {
  fireEvent.pointerDown(separator(), { button: 0, clientX: 500 });
  moveTo(width);
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
    moveTo(500);
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
      moveTo(widest + 39);
      expect(screen.getByTestId('panel').style.width).toBe(`${widest}px`);
      expect(screen.getByTestId('panel').dataset.expandPreview).toBeUndefined();
      moveTo(widest + 60);
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

    moveTo(620);
    expect(panel.style.width).toBe('600px');
    expect(panel.dataset.expandCharging).toBe('true');
    expect(panel.style.getPropertyValue('--mr-expand-progress')).toBe('0.5');
    expect(panel.dataset.expandHighlight).toBe('true');
    expect(panel.dataset.expandPreview).toBeUndefined();
    expect(panel.querySelector('[data-panel-expand-ghost]')).toBeNull();

    moveTo(640);
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
    moveTo(620);
    expect(panel.dataset.expandPreview).toBeUndefined();
    expect(panel.querySelector('[data-panel-expand-ghost]')).toBeNull();
    expect(panel.dataset.expandCharging).toBe('true');
    expect(panel.dataset.expandHighlight).toBe('true');

    // Back inside normal width range: all overdrag state clears while drag continues.
    moveTo(550);
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

  it('charges collapse below minWidth, arms and clears the fold chip on drag-back, and guards pre-render release', () => {
    const { onCollapse } = renderPanel();

    dragTo(190);
    expectCollapse({ charging: 'true', progress: '0.25', pull: '1px' });
    expect(panelEl().dataset.dragging).toBe('true');
    expect(panelEl().style.getPropertyValue('--mr-expand-progress')).toBe('');

    moveTo(160);
    expectCollapse(ARMED_COLLAPSE);
    const overlay = panelEl().querySelector('[data-panel-collapse-overlay]');
    expect(overlay?.getAttribute('aria-hidden')).toBe('true');
    expect(overlay?.querySelector('[data-panel-collapse-badge]')?.textContent).toBe('Close');

    moveTo(0);
    expectCollapse(ARMED_COLLAPSE);

    moveTo(180);
    expectCollapse({ charging: 'true', progress: '0.5', pull: '2px' });

    moveTo(260);
    expectCollapse({ width: '260px' });
    expect(panelEl().dataset.dragging).toBe('true');

    // Armed, then pulled back and released before React re-renders: must not collapse.
    moveTo(150);
    act(() => {
      const dispatch = (type: string, clientX?: number) =>
        separator().dispatchEvent(new TestPointerEvent(type, { bubbles: true, clientX }));
      dispatch('pointermove', 660);
      dispatch('pointerup');
    });
    expect(onCollapse).not.toHaveBeenCalled();
    expect(stored()).toBe(240);
  });

  it('clears collapse overlay and charging on exit phase while gliding out from minWidth', () => {
    const stub = { playState: 'running', cancel: vi.fn(), finished: new Promise(() => undefined) };
    const animate = vi.fn((_keyframes: Keyframe[]) => stub as unknown as Animation);
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
    try {
      renderStatefulPanel();
      dragTo(150);
      expectCollapse(ARMED_COLLAPSE);
      release();
      expectCollapse();
      expect(panelEl().dataset.dragging).toBeUndefined();
      expect(animate.mock.calls.at(-1)?.[0]).toEqual([
        { width: '200px', marginInlineStart: '0px' },
        { width: '0px', marginInlineStart: '0px' },
      ]);
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    }
  });

  it('leaves non-collapsible panels unaffected and omits the fold badge without collapseLabel', () => {
    renderPanel({ collapsible: false });
    dragTo(120);
    expectCollapse();
    expect(separator().getAttribute('aria-valuetext')).toBeNull();
    release();
    expect(stored()).toBe(200);

    cleanup();
    localStorage.setItem('test.width', JSON.stringify(400));
    renderPanel({ collapseLabel: null });
    dragTo(150);
    expectCollapse(ARMED_COLLAPSE);
    expect(panelEl().querySelector('[data-panel-collapse-badge]')).toBeNull();
  });
});
