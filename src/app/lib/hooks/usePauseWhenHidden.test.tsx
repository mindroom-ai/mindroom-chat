// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaneCollapsedContext } from './usePaneCollapsed';
import { useActiveWhenVisible, usePauseAnimationWhenHidden } from './usePauseWhenHidden';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('usePauseWhenHidden', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let hidden = false;

  const setHidden = (value: boolean) => {
    hidden = value;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  afterEach(() => {
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    vi.unstubAllGlobals();
  });

  it('pauses animations and active flag when off-screen, tab-hidden, or collapsed', () => {
    let notify: IntersectionObserverCallback | undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          notify = callback;
        }
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      }
    );

    const activeStates: boolean[] = [];
    function Probe({ collapsed }: { collapsed: boolean }) {
      return (
        <PaneCollapsedContext.Provider value={collapsed}>
          <Inner />
        </PaneCollapsedContext.Provider>
      );
    }
    function Inner() {
      const ref = useRef<HTMLDivElement>(null);
      usePauseAnimationWhenHidden(ref);
      const active = useActiveWhenVisible(ref);
      activeStates.push(active);
      return <div ref={ref} data-testid="probe" />;
    }

    container = document.createElement('div');
    document.body.append(container);
    act(() => {
      root = createRoot(container!);
      root.render(<Probe collapsed={false} />);
    });
    const el = container.querySelector<HTMLDivElement>('[data-testid="probe"]')!;
    expect(el.dataset.animationPaused).toBeUndefined();
    expect(activeStates.at(-1)).toBe(true);

    // Scrolled off-screen pauses animation and active timer flag.
    act(() => {
      notify?.(
        [{ target: el, isIntersecting: false } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });
    expect(el.dataset.animationPaused).toBe('true');
    expect(activeStates.at(-1)).toBe(false);

    // Back on-screen resumes.
    act(() => {
      notify?.(
        [{ target: el, isIntersecting: true } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });
    expect(el.dataset.animationPaused).toBeUndefined();
    expect(activeStates.at(-1)).toBe(true);

    // Hidden tab pauses, visible tab resumes.
    act(() => setHidden(true));
    expect(el.dataset.animationPaused).toBe('true');
    expect(activeStates.at(-1)).toBe(false);
    act(() => setHidden(false));
    expect(el.dataset.animationPaused).toBeUndefined();
    expect(activeStates.at(-1)).toBe(true);

    // Collapsed pane pauses, uncollapsed resumes.
    act(() => root?.render(<Probe collapsed />));
    expect(el.dataset.animationPaused).toBe('true');
    expect(activeStates.at(-1)).toBe(false);
    act(() => root?.render(<Probe collapsed={false} />));
    expect(el.dataset.animationPaused).toBeUndefined();
    expect(activeStates.at(-1)).toBe(true);
  });
});
