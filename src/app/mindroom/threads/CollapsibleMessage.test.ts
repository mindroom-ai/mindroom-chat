import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./CollapsibleMessage.css', () => ({
  CollapsibleContent: () => 'collapsible-content',
  CollapsibleGradientOverlay: 'collapsible-gradient-overlay',
  CollapsibleShowMore: 'collapsible-show-more',
  CollapsibleCloseButton: 'collapsible-close-button',
}));

import {
  collapseAllMessages,
  expandAllMessages,
  CollapsibleMessage,
} from './CollapsibleMessage';

type MockContentElement = Pick<HTMLDivElement, 'clientHeight' | 'scrollHeight'>;
type MockGradientElement = { focus: ReturnType<typeof vi.fn> };

let resizeObserverConstructed: ReturnType<typeof vi.fn>;
let intersectionObserverConstructed: ReturnType<typeof vi.fn>;
let lastIntersectionCallback: IntersectionObserverCallback | null;

class MockResizeObserver {
  public observe = vi.fn();

  public disconnect = vi.fn();

  public constructor(_callback: ResizeObserverCallback) {
    resizeObserverConstructed();
  }
}

class MockIntersectionObserver {
  public observe = vi.fn();

  public unobserve = vi.fn();

  public disconnect = vi.fn();

  public constructor(callback: IntersectionObserverCallback) {
    intersectionObserverConstructed();
    lastIntersectionCallback = callback;
  }
}

const getContentContainer = (renderer: ReactTestRenderer) =>
  renderer.root.find(
    (node) =>
      node.type === 'div' &&
      typeof node.props.className === 'string' &&
      node.props.className.startsWith('collapsible-content')
  );

const getExpandZone = (renderer: ReactTestRenderer) =>
  renderer.root.find(
    (node) => node.type === 'div' && node.props.role === 'button'
  );

const findExpandZones = (renderer: ReactTestRenderer) =>
  renderer.root.findAll(
    (node) => node.type === 'div' && node.props.role === 'button'
  );

const getCloseButton = (renderer: ReactTestRenderer) =>
  renderer.root.find(
    (node) => node.type === 'button' && node.props['aria-label'] === 'Collapse message'
  );

const findCloseButtons = (renderer: ReactTestRenderer) =>
  renderer.root.findAll(
    (node) => node.type === 'button' && node.props['aria-label'] === 'Collapse message'
  );

const findGradientOverlays = (renderer: ReactTestRenderer) =>
  renderer.root.findAll(
    (node) =>
      node.type === 'div' &&
      typeof node.props.className === 'string' &&
      node.props.className === 'collapsible-gradient-overlay'
  );

const renderCollapsibleMessage = (
  props: Omit<React.ComponentProps<typeof CollapsibleMessage>, 'children'>,
  contentElement: MockContentElement = {
    clientHeight: 72,
    scrollHeight: 160,
  },
  gradientElement: MockGradientElement = { focus: vi.fn() },
) => {
  let renderer!: ReactTestRenderer;

  act(() => {
    renderer = create(
      React.createElement(
        CollapsibleMessage as never,
        props as never,
        React.createElement('span', undefined, 'message')
      ),
      {
        createNodeMock: (element) => {
          if (
            element.type === 'div' &&
            typeof element.props.className === 'string' &&
            element.props.className.startsWith('collapsible-content')
          ) {
            return contentElement;
          }

          if (
            element.type === 'div' &&
            element.props.role === 'button' &&
            element.props['aria-label'] === 'Expand message'
          ) {
            return gradientElement;
          }

          return null;
        },
      }
    );
  });

  return renderer;
};

const createMeasuredContentElement = () => {
  let scrollHeightReads = 0;
  const contentElement = {
    clientHeight: 72,
    get scrollHeight() {
      scrollHeightReads += 1;
      return 160;
    },
  };

  return {
    contentElement,
    getScrollHeightReads: () => scrollHeightReads,
  };
};

beforeEach(() => {
  resizeObserverConstructed = vi.fn();
  intersectionObserverConstructed = vi.fn();
  lastIntersectionCallback = null;
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  vi.stubGlobal('getComputedStyle', () => ({ fontSize: '16px' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CollapsibleMessage', () => {
  it('starts collapsed in default mode with gradient expand zone when overflowing', () => {
    const renderer = renderCollapsibleMessage({ collapseMode: 'default' });
    const content = getContentContainer(renderer);
    const expandZone = getExpandZone(renderer);

    expect(content.props.style.maxHeight).toBe('4.5em');
    expect(content.props.style.overflow).toBe('hidden');
    expect(content.props['aria-expanded']).toBe(false);
    expect(content.props.role).toBeUndefined();
    expect(expandZone.props['aria-label']).toBe('Expand message');
    expect(resizeObserverConstructed).toHaveBeenCalledTimes(1);
    expect(findCloseButtons(renderer)).toHaveLength(0);

    act(() => {
      renderer.unmount();
    });
  });

  it('stays fully expanded in always-expanded mode and ignores collapse controls', () => {
    const renderer = renderCollapsibleMessage({ collapseMode: 'always-expanded' });
    const content = getContentContainer(renderer);

    expect(content.props.style.maxHeight).toBeUndefined();
    expect(content.props.style.overflow).toBeUndefined();
    expect(content.props.role).toBeUndefined();
    expect(content.props['aria-expanded']).toBeUndefined();
    expect(findCloseButtons(renderer)).toHaveLength(0);
    expect(findExpandZones(renderer)).toHaveLength(0);
    expect(resizeObserverConstructed).not.toHaveBeenCalled();

    act(() => {
      collapseAllMessages();
    });

    expect(getContentContainer(renderer).props.style.maxHeight).toBeUndefined();
    expect(findCloseButtons(renderer)).toHaveLength(0);

    act(() => {
      renderer.unmount();
    });
  });

  it('starts expanded once in initially-expanded mode, consumes the callback once, and responds to global collapse', () => {
    const onInitialExpandConsumed = vi.fn();
    const renderer = renderCollapsibleMessage({
      collapseMode: 'initially-expanded',
      onInitialExpandConsumed,
    });

    expect(onInitialExpandConsumed).toHaveBeenCalledTimes(1);
    expect(getContentContainer(renderer).props.style.maxHeight).toBeUndefined();
    expect(getContentContainer(renderer).props['aria-expanded']).toBe(true);
    expect(getCloseButton(renderer).props['aria-label']).toBe('Collapse message');

    act(() => {
      renderer.update(
        React.createElement(
          CollapsibleMessage as never,
          {
            collapseMode: 'initially-expanded',
            onInitialExpandConsumed,
          } as never,
          React.createElement('span', undefined, 'message')
        )
      );
    });

    expect(onInitialExpandConsumed).toHaveBeenCalledTimes(1);

    act(() => {
      collapseAllMessages();
    });

    const content = getContentContainer(renderer);
    expect(content.props.style.maxHeight).toBe('4.5em');
    expect(content.props.style.overflow).toBe('hidden');
    expect(content.props['aria-expanded']).toBe(false);
    expect(getExpandZone(renderer).props['aria-label']).toBe('Expand message');

    act(() => {
      renderer.unmount();
    });
  });

  it('expands when collapseMode switches to initially-expanded after mount', () => {
    const onInitialExpandConsumed = vi.fn();
    const renderer = renderCollapsibleMessage({
      collapseMode: 'default',
      onInitialExpandConsumed,
    });

    expect(getContentContainer(renderer).props.style.maxHeight).toBe('4.5em');

    act(() => {
      renderer.update(
        React.createElement(
          CollapsibleMessage as never,
          {
            collapseMode: 'initially-expanded',
            onInitialExpandConsumed,
          } as never,
          React.createElement('span', undefined, 'message')
        )
      );
    });

    expect(onInitialExpandConsumed).toHaveBeenCalledTimes(1);
    expect(getContentContainer(renderer).props.style.maxHeight).toBeUndefined();
    expect(getCloseButton(renderer).props['aria-label']).toBe('Collapse message');

    act(() => {
      renderer.unmount();
    });
  });

  it('expands when gradient overlay is clicked', () => {
    const renderer = renderCollapsibleMessage({ collapseMode: 'default' });
    const expandZone = getExpandZone(renderer);

    act(() => {
      expandZone.props.onClick();
    });

    const content = getContentContainer(renderer);
    expect(content.props.style.maxHeight).toBeUndefined();
    expect(content.props['aria-expanded']).toBe(true);
    expect(getCloseButton(renderer).props['aria-label']).toBe('Collapse message');

    act(() => {
      renderer.unmount();
    });
  });

  it('collapses when close button is clicked', () => {
    const renderer = renderCollapsibleMessage({ collapseMode: 'default' });

    act(() => {
      getExpandZone(renderer).props.onClick();
    });

    const closeButton = getCloseButton(renderer);
    act(() => {
      closeButton.props.onClick({
        stopPropagation: vi.fn(),
      });
    });

    const content = getContentContainer(renderer);
    expect(content.props.style.maxHeight).toBe('4.5em');
    expect(content.props.style.overflow).toBe('hidden');
    expect(content.props['aria-expanded']).toBe(false);

    act(() => {
      renderer.unmount();
    });
  });

  it('content wrapper has no click handler when collapsed (nested interactive elements safe)', () => {
    const renderer = renderCollapsibleMessage({ collapseMode: 'default' });
    const content = getContentContainer(renderer);

    expect(content.props.onClick).toBeUndefined();
    expect(content.props.onKeyDown).toBeUndefined();
    expect(content.props.role).toBeUndefined();
    expect(content.props.tabIndex).toBeUndefined();

    act(() => {
      renderer.unmount();
    });
  });

  it('expands on Enter key press on gradient', () => {
    const renderer = renderCollapsibleMessage({ collapseMode: 'default' });
    const expandZone = getExpandZone(renderer);

    act(() => {
      expandZone.props.onKeyDown({
        key: 'Enter',
        preventDefault: vi.fn(),
      });
    });

    expect(getContentContainer(renderer).props.style.maxHeight).toBeUndefined();
    expect(getContentContainer(renderer).props['aria-expanded']).toBe(true);

    act(() => {
      renderer.unmount();
    });
  });

  it('expands on Space key press on gradient', () => {
    const renderer = renderCollapsibleMessage({ collapseMode: 'default' });
    const expandZone = getExpandZone(renderer);

    act(() => {
      expandZone.props.onKeyDown({
        key: ' ',
        preventDefault: vi.fn(),
      });
    });

    expect(getContentContainer(renderer).props.style.maxHeight).toBeUndefined();

    act(() => {
      renderer.unmount();
    });
  });

  it('collapses on Enter key press on close button', () => {
    const renderer = renderCollapsibleMessage({ collapseMode: 'default' });

    act(() => {
      getExpandZone(renderer).props.onClick();
    });

    const closeButton = getCloseButton(renderer);
    act(() => {
      closeButton.props.onKeyDown({
        key: 'Enter',
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      });
    });

    expect(getContentContainer(renderer).props.style.maxHeight).toBe('4.5em');

    act(() => {
      renderer.unmount();
    });
  });

  it('collapses on Space key press on close button', () => {
    const renderer = renderCollapsibleMessage({ collapseMode: 'default' });

    act(() => {
      getExpandZone(renderer).props.onClick();
    });

    const closeButton = getCloseButton(renderer);
    act(() => {
      closeButton.props.onKeyDown({
        key: ' ',
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      });
    });

    expect(getContentContainer(renderer).props.style.maxHeight).toBe('4.5em');

    act(() => {
      renderer.unmount();
    });
  });

  it('non-overflowing content shows no expand controls, gradient, or close button', () => {
    const renderer = renderCollapsibleMessage(
      { collapseMode: 'default' },
      { clientHeight: 40, scrollHeight: 40 },
    );

    const content = getContentContainer(renderer);
    expect(content.props.style.maxHeight).toBe('4.5em');
    expect(content.props['aria-expanded']).toBe(false);
    expect(findExpandZones(renderer)).toHaveLength(0);
    expect(findGradientOverlays(renderer)).toHaveLength(0);
    expect(findCloseButtons(renderer)).toHaveLength(0);

    act(() => {
      renderer.unmount();
    });
  });

  it('expandAllMessages expands collapsed content', () => {
    const renderer = renderCollapsibleMessage({ collapseMode: 'default' });

    expect(getContentContainer(renderer).props.style.maxHeight).toBe('4.5em');
    expect(getContentContainer(renderer).props['aria-expanded']).toBe(false);

    act(() => {
      expandAllMessages();
    });

    const content = getContentContainer(renderer);
    expect(content.props.style.maxHeight).toBeUndefined();
    expect(content.props['aria-expanded']).toBe(true);
    expect(getCloseButton(renderer).props['aria-label']).toBe('Collapse message');

    act(() => {
      renderer.unmount();
    });
  });

  it('moves focus to gradient after collapse', () => {
    const gradientMock = { focus: vi.fn() };
    const renderer = renderCollapsibleMessage(
      { collapseMode: 'default' },
      { clientHeight: 72, scrollHeight: 160 },
      gradientMock,
    );

    // Expand via gradient click
    act(() => {
      getExpandZone(renderer).props.onClick();
    });

    // Collapse via close button
    act(() => {
      getCloseButton(renderer).props.onClick({ stopPropagation: vi.fn() });
    });

    expect(gradientMock.focus).toHaveBeenCalled();

    act(() => {
      renderer.unmount();
    });
  });

  it('preserves overflowing=true when scrollHeight is 0 (off-screen element)', () => {
    const renderer = renderCollapsibleMessage(
      { collapseMode: 'default' },
      { clientHeight: 0, scrollHeight: 0 },
    );

    // overflowing defaults to true; scrollHeight=0 guard prevents checkOverflow
    // from setting it to false, so gradient is shown
    const content = getContentContainer(renderer);
    expect(content.props.style.maxHeight).toBe('4.5em');
    expect(content.props.style.overflow).toBe('hidden');
    expect(findExpandZones(renderer)).toHaveLength(1);
    expect(getExpandZone(renderer).props['aria-label']).toBe('Expand message');

    act(() => {
      renderer.unmount();
    });
  });

  it('IntersectionObserver re-checks overflow when element enters viewport', () => {
    // Start with scrollHeight=0 (simulates off-screen element with unknown layout)
    const contentElement = { clientHeight: 0, scrollHeight: 0 };
    const renderer = renderCollapsibleMessage(
      { collapseMode: 'default' },
      contentElement,
    );

    // Gradient is shown (overflowing defaults to true, scrollHeight=0 guard preserves it)
    expect(findExpandZones(renderer)).toHaveLength(1);
    expect(intersectionObserverConstructed).toHaveBeenCalled();

    // Simulate element entering viewport with real dimensions
    contentElement.scrollHeight = 160;
    contentElement.clientHeight = 72;
    act(() => {
      lastIntersectionCallback!(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    // Overflow confirmed — gradient still shown
    expect(findExpandZones(renderer)).toHaveLength(1);
    expect(getContentContainer(renderer).props.style.maxHeight).toBe('4.5em');

    act(() => {
      renderer.unmount();
    });
  });

  it('IntersectionObserver clears overflowing for short content entering viewport', () => {
    // Start with scrollHeight=0
    const contentElement = { clientHeight: 0, scrollHeight: 0 };
    const renderer = renderCollapsibleMessage(
      { collapseMode: 'default' },
      contentElement,
    );

    expect(findExpandZones(renderer)).toHaveLength(1);

    // Simulate element entering viewport — content is short, doesn't overflow
    contentElement.scrollHeight = 40;
    contentElement.clientHeight = 40;
    act(() => {
      lastIntersectionCallback!(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    // No overflow — gradient removed
    expect(findExpandZones(renderer)).toHaveLength(0);
    expect(findGradientOverlays(renderer)).toHaveLength(0);
    expect(findCloseButtons(renderer)).toHaveLength(0);

    act(() => {
      renderer.unmount();
    });
  });

  it('does not rerun overflow measurement when rerendered with the same measurement key', () => {
    const { contentElement, getScrollHeightReads } = createMeasuredContentElement();
    const renderer = renderCollapsibleMessage(
      {
        collapseMode: 'default',
        measurementKey: '$message|active||default',
      },
      contentElement,
    );
    const readsAfterMount = getScrollHeightReads();

    act(() => {
      renderer.update(
        React.createElement(
          CollapsibleMessage as never,
          {
            collapseMode: 'default',
            measurementKey: '$message|active||default',
          } as never,
          React.createElement('span', undefined, 'message')
        )
      );
    });

    expect(getScrollHeightReads()).toBe(readsAfterMount);

    act(() => {
      renderer.unmount();
    });
  });

  it('reruns overflow measurement when the measurement key changes', () => {
    const { contentElement, getScrollHeightReads } = createMeasuredContentElement();
    const renderer = renderCollapsibleMessage(
      {
        collapseMode: 'default',
        measurementKey: '$message|active||default',
      },
      contentElement,
    );
    const readsAfterMount = getScrollHeightReads();

    act(() => {
      renderer.update(
        React.createElement(
          CollapsibleMessage as never,
          {
            collapseMode: 'default',
            measurementKey: '$message|active|$edit|default',
          } as never,
          React.createElement('span', undefined, 'message')
        )
      );
    });

    expect(getScrollHeightReads()).toBeGreaterThan(readsAfterMount);

    act(() => {
      renderer.unmount();
    });
  });

  it('does not disable scroll anchoring on the wrapper', () => {
    const renderer = renderCollapsibleMessage({ collapseMode: 'default' });
    const wrapper = renderer.root.findAllByType('div')[0];

    expect(wrapper.props.style?.overflowAnchor).toBeUndefined();

    act(() => {
      renderer.unmount();
    });
  });
});
