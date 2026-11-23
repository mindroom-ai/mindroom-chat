// @vitest-environment jsdom

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResizablePanel, SIDE_PANEL_MAX_WIDTH } from './ResizablePanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('./ResizablePanel.css', () => ({ Panel: 'panel', Handle: 'handle' }));

let container: HTMLDivElement;
let root: Root;

const render = (props: Partial<React.ComponentProps<typeof ResizablePanel>>) =>
  act(() => {
    root.render(
      <ResizablePanel
        storageKey="test.width"
        resizeLabel="Resize"
        collapseLabel="Close"
        testId="panel"
        side="end"
        minContentWidth={0}
        {...props}
      >
        <div>content</div>
      </ResizablePanel>
    );
  });

const panel = () => container.querySelector('[data-testid="panel"]') as HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}

      disconnect() {}
    }
  );
  container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { configurable: true, value: 3000 });
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('ResizablePanel width bounds', () => {
  it('keeps stored widths within the default 600 px', () => {
    localStorage.setItem('test.width', JSON.stringify(1200));
    render({});
    expect(panel().style.width).toBe('600px');
  });

  it('lets a panel opt into a wider maximum', () => {
    localStorage.setItem('test.width', JSON.stringify(1200));
    render({ maxPanelWidth: 1600 });
    expect(panel().style.width).toBe('1200px');
  });

  it('lays out at its stored width from the first commit, before it measures the row', () => {
    localStorage.setItem('test.width', JSON.stringify(400));
    const firstWidths: string[] = [];
    function Probe() {
      React.useLayoutEffect(() => {
        firstWidths.push(panel().style.width);
      }, []);
      return null;
    }
    act(() => {
      root.render(
        <ResizablePanel
          storageKey="test.width"
          resizeLabel="Resize"
          collapseLabel="Close"
          testId="panel"
        >
          <Probe />
        </ResizablePanel>
      );
    });
    expect(firstWidths).toEqual(['400px']);
    expect(panel().style.width).toBe('400px');
  });

  it('with no ceiling, stays finite before it measures the row', () => {
    localStorage.setItem('test.width', JSON.stringify(400));
    const firstMax: (string | null | undefined)[] = [];
    function Probe() {
      React.useLayoutEffect(() => {
        firstMax.push(container.querySelector('[role="separator"]')?.getAttribute('aria-valuemax'));
      }, []);
      return null;
    }
    act(() => {
      root.render(
        <ResizablePanel
          storageKey="test.width"
          resizeLabel="Resize"
          testId="panel"
          maxPanelWidth={SIDE_PANEL_MAX_WIDTH}
        >
          <Probe />
        </ResizablePanel>
      );
    });
    expect(firstMax).toEqual(['400']);
    expect(panel().style.width).toBe('400px');
    expect(container.querySelector('[role="separator"]')?.getAttribute('aria-valuemax')).toBe(
      '2680'
    );
  });

  it('renders no box and no handle in passthrough mode', () => {
    render({ passthrough: true });
    expect(panel().style.display).toBe('contents');
    expect(container.querySelector('[role="separator"]')).toBeNull();
  });

  it('measures and observes the layout parent through a display: contents wrapper', () => {
    const observed: Element[] = [];
    let resizeCallback: (() => void) | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resizeCallback = callback;
        }

        observe(target: Element) {
          observed.push(target);
        }

        disconnect() {}
      }
    );

    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 1200 });
    localStorage.setItem('test.width', JSON.stringify(400));

    act(() => {
      root.render(
        <div style={{ display: 'contents' }} data-testid="passthrough-host">
          <ResizablePanel
            storageKey="test.width"
            defaultWidth={400}
            minContentWidth={320}
            maxPanelWidth={SIDE_PANEL_MAX_WIDTH}
            resizeLabel="Resize"
            collapseLabel="Close"
            testId="panel"
          >
            <div>content</div>
          </ResizablePanel>
        </div>
      );
    });

    const host = container.querySelector('[data-testid="passthrough-host"]') as HTMLDivElement;
    // A display: contents wrapper reports clientWidth 0; ResizablePanel must skip it.
    expect(host.clientWidth).toBe(0);
    expect(panel().style.width).toBe('400px');
    expect(container.querySelector('[role="separator"]')?.getAttribute('aria-valuemax')).toBe(
      '880'
    );
    expect(observed).toEqual([container]);

    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 900 });
    act(() => resizeCallback?.());
    expect(container.querySelector('[role="separator"]')?.getAttribute('aria-valuemax')).toBe(
      '580'
    );
  });
});

describe('ResizablePanel overlay', () => {
  it('renders after the content and before the splitter, with the content width', () => {
    render({ side: 'start', overlay: <i data-overlay /> });
    const parts = [...panel().children] as HTMLElement[];
    const overlay = parts.findIndex((part) => part.querySelector('[data-overlay]'));
    const splitter = parts.findIndex((part) => part.getAttribute('role') === 'separator');

    expect(overlay).toBe(1);
    expect(splitter).toBe(2);
    expect(parts[overlay]?.style.getPropertyValue('--mr-panel-content-width')).toMatch(/px$/);
  });
});
