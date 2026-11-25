// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelHeaderControls } from './PanelFrame';
import { PanelFrameProvider, type PanelFrame } from './panelFrameContext';
import { animatePanelFill, PANEL_MOTION_EASING, PANEL_MOTION_MS } from './panelPresence';
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
}: {
  framed?: boolean;
  maxPanelWidth?: number;
  rowWidth?: number;
  paddingInlineEnd?: string;
  onExpand?: () => void;
  expandLabel?: string;
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
        collapseLabel="Close"
        testId="panel"
        side="end"
        minContentWidth={360}
        maxPanelWidth={maxPanelWidth}
        onCollapse={onCollapse}
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
  let width = rowWidth;
  Object.defineProperty(row, 'clientWidth', { configurable: true, get: () => width });
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
    setRowWidth: (next: number) => {
      width = next;
    },
    setLayout: (next: PanelLayout) => {
      act(() => updateLayout?.(next));
    },
  };
};

type ControlledAnimation = {
  cancel: ReturnType<typeof vi.fn>;
  playState: AnimationPlayState;
  finished: Promise<Animation>;
  resolve: () => void;
};

const createControlledAnimate = () => {
  const animations: ControlledAnimation[] = [];
  const animate = vi.fn(() => {
    let resolveFinished!: () => void;
    const finished = new Promise<Animation>((resolve) => {
      resolveFinished = () => resolve(anim as unknown as Animation);
    });
    const anim: ControlledAnimation = {
      playState: 'running',
      finished,
      cancel: vi.fn(() => {
        anim.playState = 'idle';
      }),
      resolve: () => {
        anim.playState = 'finished';
        resolveFinished();
      },
    };
    animations.push(anim);
    return anim as unknown as Animation;
  });
  return { animate, animations };
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

  it('interpolates paddingInlineStart in animatePanelFill to avoid the 8 px floating-card jump', () => {
    const { animate } = createControlledAnimate();
    const panel = document.body.appendChild(document.createElement('div'));
    panel.style.paddingInlineStart = '8px';
    Object.defineProperty(panel, 'animate', { configurable: true, value: animate });

    animatePanelFill(panel, 600, 1092, 'end');
    expect(animate).toHaveBeenCalledWith(
      [
        { width: '600px', marginInlineStart: '492px', paddingInlineStart: '0px' },
        { width: '1092px', marginInlineStart: '0px', paddingInlineStart: '8px' },
      ],
      { duration: PANEL_MOTION_MS, easing: PANEL_MOTION_EASING, fill: 'none' }
    );
  });

  it('glides with WAAPI on fill and restore, toggles data-fill-glide, lands pulse on finish, and respects reduced motion', async () => {
    const { animate, animations } = createControlledAnimate();
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const w = this.style.width === '100%' ? 1000 : Number.parseFloat(this.style.width) || 0;
        return { width: w } as DOMRect;
      });
    try {
      const { setRowWidth } = renderStatefulPanel({ rowWidth: 1000 });
      const panel = screen.getByTestId('panel');
      const fillButton = () => screen.getByRole('button', { name: 'Fill the room with Notes' });

      dragTo(660);
      release();
      expect(animate).toHaveBeenCalledTimes(1);
      expect(animate).toHaveBeenLastCalledWith(
        [
          { width: '600px', marginInlineStart: '400px', paddingInlineStart: '0px' },
          { width: '1000px', marginInlineStart: '0px', paddingInlineStart: '0px' },
        ],
        { duration: PANEL_MOTION_MS, easing: PANEL_MOTION_EASING, fill: 'none' }
      );
      // Landing pulse waits until the fill glide finishes.
      expect(panel.dataset.justFilled).toBeUndefined();
      await act(async () => {
        animations[0]!.resolve();
      });
      expect(panel.dataset.justFilled).toBe('true');

      // Window resizes while filled: restore measures the live parent row width directly.
      setRowWidth(1200);
      fireEvent.click(fillButton());
      expect(panel.dataset.justFilled).toBeUndefined();
      expect(animate).toHaveBeenCalledTimes(2);
      expect(animate).toHaveBeenLastCalledWith(
        [{ width: '1200px', marginInlineStart: '0px', offset: 0 }],
        { duration: PANEL_MOTION_MS, easing: PANEL_MOTION_EASING, fill: 'none' }
      );
      expect(panel.dataset.fillGlide).toBe('true');

      await act(async () => {
        animations[1]!.resolve();
      });
      expect(panel.dataset.fillGlide).toBeUndefined();

      // Reduced motion skips both glide animations and the landing pulse.
      animate.mockClear();
      vi.stubGlobal('matchMedia', () => ({ matches: true }));
      fireEvent.click(fillButton());
      expect(animate).not.toHaveBeenCalled();
      expect(panel.dataset.justFilled).toBeUndefined();
      fireEvent.click(fillButton());
      expect(animate).not.toHaveBeenCalled();
      expect(panel.dataset.fillGlide).toBeUndefined();
    } finally {
      rectSpy.mockRestore();
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    }
  });

  it('guards data-just-filled against mid-glide un-fill and never glides or pulses from folded or initial mount', async () => {
    const { animate, animations } = createControlledAnimate();
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
    let midFlightWidth: number | undefined;
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (midFlightWidth !== undefined && this.dataset.testid === 'panel') {
          return { width: midFlightWidth } as DOMRect;
        }
        const w = this.style.width === '100%' ? 1000 : Number.parseFloat(this.style.width) || 0;
        return { width: w } as DOMRect;
      });
    try {
      // Initial mount in filled layout neither glides nor pulses.
      const initial = renderStatefulPanel({ rowWidth: 1000, initialLayout: 'filled' });
      expect(animate).not.toHaveBeenCalled();
      expect(screen.getByTestId('panel').dataset.justFilled).toBeUndefined();
      initial.unmount();

      // Un-filling before the fill glide finishes reverses from live width and suppresses stale pulse.
      const { setLayout } = renderStatefulPanel({ rowWidth: 1000 });
      const panel = screen.getByTestId('panel');
      const fillButton = () => screen.getByRole('button', { name: 'Fill the room with Notes' });
      fireEvent.click(fillButton());
      expect(panel.dataset.justFilled).toBeUndefined();
      const fillAnim = animations[0]!;
      midFlightWidth = 750;
      fireEvent.click(fillButton());
      midFlightWidth = undefined;
      expect(fillAnim.cancel).toHaveBeenCalledOnce();
      expect(animate).toHaveBeenLastCalledWith(
        [{ width: '750px', marginInlineStart: '0px', offset: 0 }],
        { duration: PANEL_MOTION_MS, easing: PANEL_MOTION_EASING, fill: 'none' }
      );
      expect(panel.dataset.fillGlide).toBe('true');
      await act(async () => {
        fillAnim.resolve();
      });
      expect(panel.dataset.justFilled).toBeUndefined();
      await act(async () => {
        animations[1]!.resolve();
      });
      expect(panel.dataset.fillGlide).toBeUndefined();

      // Unfolding straight from folded into filled neither glides nor pulses.
      animate.mockClear();
      setLayout('folded');
      setLayout('filled');
      expect(animate).not.toHaveBeenCalled();
      expect(panel.dataset.justFilled).toBeUndefined();
    } finally {
      rectSpy.mockRestore();
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    }
  });

  it('sets data-just-filled immediately when WAAPI is unavailable and clears after timeout or un-fill', () => {
    vi.useFakeTimers();
    try {
      renderStatefulPanel({ rowWidth: 1000 });
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

      // Reduced motion still skips the pulse even when WAAPI is unavailable.
      vi.stubGlobal('matchMedia', () => ({ matches: true }));
      fireEvent.click(fillButton());
      expect(panel.dataset.justFilled).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
