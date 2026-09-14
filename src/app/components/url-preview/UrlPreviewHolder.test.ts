import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UrlPreviewHolder } from './UrlPreviewCard';

const mocks = vi.hoisted(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  notify: undefined as ((entries: IntersectionObserverEntry[]) => void) | undefined,
}));

vi.mock('folds', async (importOriginal) => {
  const original = await importOriginal<typeof import('folds')>();
  return {
    ...original,
    Scroll: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) =>
      React.createElement('div', { ...props, ref, 'data-scroll': true })
    ),
  };
});
vi.mock('./UrlPreviewCard.css', () => ({
  UrlPreviewHolderBtn: () => 'preview-button',
  UrlPreviewHolderGradient: () => 'preview-gradient',
}));
vi.mock('./UrlPreview', () => ({}));
vi.mock('../ImageOverlay', () => ({ ImageOverlay: () => null }));
vi.mock('../image-viewer', () => ({ ImageViewer: () => null }));
vi.mock('../../hooks/useIntersectionObserver', () => ({
  useIntersectionObserver: (callback: typeof mocks.notify) => {
    mocks.notify = callback;
    return mocks;
  },
  getIntersectionObserverEntry: (element: Element, entries: IntersectionObserverEntry[]) =>
    entries.find((entry) => entry.target === element),
}));

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('link preview navigation', () => {
  it.each(['ltr', 'rtl'])('reaches later previews and returns in %s layout', (direction) => {
    const scrollTo = vi.fn();
    const scroll = { offsetWidth: 260, scrollLeft: direction === 'rtl' ? -100 : 100, scrollTo };
    vi.stubGlobal('getComputedStyle', () => ({ direction }));
    act(() => {
      renderer = create(React.createElement(UrlPreviewHolder, null, 'previews'), {
        createNodeMock: (element) => (element.props['data-scroll'] ? scroll : {}),
      });
    });
    const [start, end] = mocks.observe.mock.calls.map(([element]) => element);
    act(() => {
      mocks.notify?.([
        { target: start, isIntersecting: false } as IntersectionObserverEntry,
        { target: end, isIntersecting: false } as IntersectionObserverEntry,
      ]);
    });
    const [previous, next] = renderer!.root.findAllByType('button');
    act(() => next.props.onClick());
    expect(scrollTo).toHaveBeenLastCalledWith({
      left: direction === 'rtl' ? -300 : 300,
      behavior: 'smooth',
    });
    act(() => previous.props.onClick());
    expect(scrollTo).toHaveBeenLastCalledWith({
      left: direction === 'rtl' ? 100 : -100,
      behavior: 'smooth',
    });
  });
});
