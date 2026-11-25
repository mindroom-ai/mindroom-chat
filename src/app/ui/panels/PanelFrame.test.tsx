// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IconButton } from 'folds';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelHeaderControls } from './PanelFrame';
import { ControlPill, HeaderPill } from './PanelFrame.css';
import { PanelFrameProvider, type PanelFrame } from './panelFrameContext';
import { usePanelSlot } from './panelPresence';
import { ResizablePanel } from './ResizablePanel';
import type { PanelLayout } from './roomPanels';

// A room's side panel in its frame (ResizablePanel + PanelHeaderControls inside a
// PanelFrameProvider), in each layout.

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
      <div>
        <PanelHeaderControls />
        <p>content</p>
      </div>
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
const content = () => screen.getByText('content').parentElement!.parentElement!;
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

  it('beside the conversation, uses full panel width with no open strip and offers Fill and Fold', async () => {
    const setLayout = renderFramed('beside');
    expect(panel().style.width).toBe('300px');
    expect(content().style.getPropertyValue('--mr-panel-content-width')).toBe('300px');
    expect(separator()).not.toBeNull();
    const fill = screen.getByRole('button', { name: 'Fill the room with Notes' });
    expect(fill.getAttribute('aria-pressed')).toBe('false');
    expect(fill.hasAttribute('data-panel-fill-button')).toBe(true);
    await act(async () => fill.click());
    expect(setLayout).toHaveBeenLastCalledWith('filled');
    await act(async () => screen.getByRole('button', { name: 'Fold Notes to the edge' }).click());
    expect(setLayout).toHaveBeenLastCalledWith('folded');
  });

  it('keeps the panel at its minimum width without adding an open strip width', () => {
    localStorage.setItem('test.width', JSON.stringify(100));
    renderFramed('beside');
    expect(panel().style.width).toBe('200px');
    expect(content().style.getPropertyValue('--mr-panel-content-width')).toBe('200px');
    expect(separator()?.getAttribute('aria-valuemin')).toBe('200');
  });

  it('keeps that smallest width in a room too narrow for the panel and the conversation', () => {
    render(framed('beside', vi.fn(), 360), { container: row(500) });
    expect(panel().style.width).toBe('200px');
    expect(content().style.getPropertyValue('--mr-panel-content-width')).toBe('200px');
  });

  it('filling the room, takes 100% width with no splitter, and Fill brings it back', async () => {
    const setLayout = renderFramed('filled');
    expect(panel().style.width).toBe('100%');
    expect(content().style.getPropertyValue('--mr-panel-content-width')).toBe('100%');
    expect(separator()).toBeNull();
    const fill = screen.getByRole('button', { name: 'Fill the room with Notes' });
    expect(fill.getAttribute('aria-pressed')).toBe('true');
    await act(async () => fill.click());
    expect(setLayout).toHaveBeenLastCalledWith('beside');
  });

  it('folded, shows only its edge tab and keeps its content mounted out of sight', async () => {
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
  it('renders an open Fill/Fold strip when openStrip is enabled for legacy own-title panels', () => {
    const setLayout = vi.fn<PanelFrame['setLayout']>();
    render(
      <PanelFrameProvider value={{ label: 'Pull Request', layout: 'beside', setLayout }}>
        <ResizablePanel
          side="end"
          openStrip
          storageKey="panel-open-strip"
          defaultWidth={320}
          minContentWidth={300}
          maxPanelWidth={600}
          resizeLabel="Resize panel"
          testId="panel"
        >
          <p>PR body</p>
        </ResizablePanel>
      </PanelFrameProvider>,
      { container: row() }
    );
    expect(
      (panel().firstElementChild as HTMLElement).style.getPropertyValue('--mr-panel-content-width')
    ).toBe('280px');
    fireEvent.click(screen.getByRole('button', { name: 'Fill the room with Pull Request' }));
    expect(setLayout).toHaveBeenLastCalledWith('filled');
    fireEvent.click(screen.getByRole('button', { name: 'Fold Pull Request to the edge' }));
    expect(setLayout).toHaveBeenLastCalledWith('folded');
  });
});

describe('PanelHeaderControls', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders panel actions, frame controls, and close as flat Surface/None controls', () => {
    const onClose = vi.fn();
    const setLayout = vi.fn<PanelFrame['setLayout']>();
    const { container: expectedIcon } = render(
      <IconButton size="300" radii="300" variant="Surface" fill="None" />
    );
    const surfaceNoneClass = expectedIcon.querySelector('button')!.className;
    cleanup();

    const { container } = render(
      <PanelFrameProvider value={{ label: 'Notes', layout: 'beside', setLayout }}>
        <PanelHeaderControls onClose={onClose} closeLabel="Close Notes">
          <button type="button">Extra</button>
        </PanelHeaderControls>
      </PanelFrameProvider>
    );

    expect(ControlPill.split(' ')).not.toContain(HeaderPill);
    expect(container.firstElementChild?.classList.contains(HeaderPill)).toBe(false);

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      'Extra',
      'Fill the room with Notes',
      'Fold Notes to the edge',
      'Close Notes',
    ]);
    for (const button of buttons.slice(1)) {
      expect(button.className).toBe(surfaceNoneClass);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Close Notes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('prefers host-supplied fillLabel and foldLabel when present', () => {
    render(
      <PanelFrameProvider
        value={{
          label: 'Notes',
          layout: 'beside',
          fillLabel: 'Expand Notes',
          foldLabel: 'Dock Notes',
          setLayout: vi.fn(),
        }}
      >
        <PanelHeaderControls />
      </PanelFrameProvider>
    );
    expect(screen.getByRole('button', { name: 'Expand Notes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dock Notes' })).toBeTruthy();
  });

  it('omits Fill and Fold when showFrame is false or outside a PanelFrameProvider', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <PanelFrameProvider value={{ label: 'Notes', layout: 'beside', setLayout: vi.fn() }}>
        <PanelHeaderControls onClose={onClose} closeLabel="Close Notes" showFrame={false} />
      </PanelFrameProvider>
    );
    expect(screen.queryByRole('button', { name: 'Fill the room with Notes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fold Notes to the edge' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close Notes' })).toBeTruthy();

    rerender(<PanelHeaderControls onClose={onClose} closeLabel="Close Notes" />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
