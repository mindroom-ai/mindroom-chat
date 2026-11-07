// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelFrameProvider, type PanelFrame } from './PanelFrame';
import { ResizablePanel } from './ResizablePanel';
import type { PanelLayout } from './roomPanels';

// A room's side panel in its frame (ResizablePanel inside a PanelFrameProvider), in each layout.

const renderFramed = (layout: PanelLayout | undefined) => {
  const setLayout = vi.fn<PanelFrame['setLayout']>();
  // A row wide enough for the panel at its default width.
  const row = document.body.appendChild(document.createElement('div'));
  Object.defineProperty(row, 'clientWidth', { value: 3000 });
  render(
    <PanelFrameProvider value={layout && { label: 'Notes', layout, setLayout }}>
      <ResizablePanel
        storageKey="test.width"
        defaultWidth={300}
        resizeLabel="Resize"
        collapseLabel="Close"
        testId="panel"
        side="end"
        minContentWidth={0}
      >
        <p>content</p>
      </ResizablePanel>
    </PanelFrameProvider>,
    { container: row }
  );
  return setLayout;
};

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

  it('filling the room, takes its full width with no splitter, and Fill brings it back', async () => {
    const setLayout = renderFramed('filled');
    expect(panel().style.width).toBe('100%');
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
    expect(content().style.display).toBe('none');
    const tab = screen.getByRole('button', { name: 'Unfold Notes' });
    expect(tab.textContent).toBe('Notes');
    expect(screen.getAllByRole('button')).toEqual([tab]);
    await act(async () => tab.click());
    expect(setLayout).toHaveBeenLastCalledWith('beside');
  });
});
