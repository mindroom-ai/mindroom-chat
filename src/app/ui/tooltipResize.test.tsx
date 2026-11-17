// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from './directional';

// Exercise Folds' real positioning, not a stand-in for the tooltip provider.
class Resize implements ResizeObserver {
  static active = new Set<Resize>();
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    Resize.active.add(this);
  }
  unobserve() {}
  disconnect() {
    Resize.active.delete(this);
  }
  static deliver() {
    Resize.active.forEach((observer) => observer.callback([], observer));
  }
}

const show = () =>
  render(
    <TooltipProvider position="Right" align="Start" delay={0} tooltip={<span>Details</span>}>
      {(ref) => <button ref={ref}>Thread</button>}
    </TooltipProvider>
  );
const hover = (button: HTMLElement) => {
  fireEvent.mouseEnter(button);
  act(() => {
    vi.runAllTimers();
  });
};

describe('resizing an open tooltip', () => {
  let height = 80;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', Resize);
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000);
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(800);
    height = 80;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function bounds(
      this: HTMLElement
    ) {
      return this.tagName === 'BUTTON'
        ? new DOMRect(200, 600, 200, 30)
        : new DOMRect(408, 600, 300, height);
    });
  });
  afterEach(() => {
    cleanup();
    Resize.active.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('repositions when late details grow beyond the viewport edge', () => {
    const view = show();
    hover(view.getByRole('button'));
    const tooltip = view.getByRole('tooltip');
    expect(tooltip.style.top).toBe('600px');

    height = 300;
    act(() => Resize.deliver());

    expect(tooltip.style.top).toBe('465px');
    expect(Number.parseFloat(tooltip.style.top) + height).toBeLessThanOrEqual(800);
  });

  it('observes only while open and disconnects on close and unmount', () => {
    const view = show();
    expect(Resize.active.size).toBe(0);
    hover(view.getByRole('button'));
    expect(Resize.active.size).toBe(1);
    fireEvent.mouseLeave(view.getByRole('button'));
    expect(Resize.active.size).toBe(0);
    hover(view.getByRole('button'));
    view.unmount();
    expect(Resize.active.size).toBe(0);
  });

  it('still opens without ResizeObserver support', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const view = show();
    hover(view.getByRole('button'));
    expect(view.getByRole('tooltip').style.top).toBe('600px');
  });
});
