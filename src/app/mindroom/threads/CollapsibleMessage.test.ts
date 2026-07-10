import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./CollapsibleMessage.css', () => ({
  CollapsibleContent: () => 'collapsible-content',
  CollapsibleGradientOverlay: 'collapsible-gradient-overlay',
  CollapsibleShowMore: 'collapsible-show-more',
  CollapsibleStickyFooter: 'collapsible-sticky-footer',
  CollapsiblePill: 'collapsible-pill',
}));

import {
  collapseAllMessages,
  expandAllMessages,
  ExpandAllInitContext,
  CollapsibleMessage,
  ManualExpansionStateContext,
  rememberManualExpansionState,
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
  renderer.root.find((node) => node.type === 'div' && node.props.role === 'button');

const findExpandZones = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.type === 'div' && node.props.role === 'button');

const getCloseButton = (renderer: ReactTestRenderer) =>
  renderer.root.find((node) => node.type === 'button' && node.props['aria-label'] === 'Show less');

const findCloseButtons = (renderer: ReactTestRenderer) =>
  renderer.root.findAll(
    (node) => node.type === 'button' && node.props['aria-label'] === 'Show less'
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
  children: React.ReactNode = React.createElement('span', undefined, 'message'),
  expandAllInit: boolean | undefined = undefined,
  manualExpansionState: Map<string, boolean> | undefined = undefined
) => {
  let renderer!: ReactTestRenderer;

  const element = React.createElement(CollapsibleMessage as never, props as never, children);
  // Only wrap when an override is provided; an undefined provider is equivalent
  // to the default context, and leaving the element unwrapped keeps the root
  // type stable for tests that drive their own renderer.update(...).
  let tree: React.ReactElement =
    expandAllInit === undefined
      ? element
      : React.createElement(ExpandAllInitContext.Provider, { value: expandAllInit }, element);
  if (manualExpansionState !== undefined) {
    tree = React.createElement(
      ManualExpansionStateContext.Provider,
      { value: manualExpansionState },
      tree
    );
  }

  act(() => {
    renderer = create(tree, {
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
          element.props['aria-label'] === 'Show more'
        ) {
          return gradientElement;
        }

        return null;
      },
    });
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
  it('passes collapsed and expanded state to render-prop children', () => {
    const states: boolean[] = [];
    const renderer = renderCollapsibleMessage(
      { collapseMode: 'default' },
      { clientHeight: 72, scrollHeight: 160 },
      { focus: vi.fn() },
      ({ expanded }: { expanded: boolean }) => {
        states.push(expanded);
        return React.createElement('span', undefined, expanded ? 'expanded' : 'collapsed');
      }
    );

    expect(states[states.length - 1]).toBe(false);

    act(() => {
      getExpandZone(renderer).props.onClick();
    });

    expect(states[states.length - 1]).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain('expanded');

    act(() => {
      renderer.unmount();
    });
  });

  it('loads full content after entering the viewport while staying collapsed', () => {
    const states: Array<{ expanded: boolean; loadFullContent: boolean }> = [];
    const renderer = renderCollapsibleMessage(
      { collapseMode: 'default', forceOverflowing: true },
      { clientHeight: 72, scrollHeight: 160 },
      { focus: vi.fn() },
      (state: { expanded: boolean; loadFullContent: boolean }) => {
        states.push(state);
        return React.createElement('span', undefined, 'message');
      }
    );

    expect(states[states.length - 1]).toEqual({
      expanded: false,
      loadFullContent: false,
    });
    expect(getContentContainer(renderer).props['aria-expanded']).toBe(false);
    expect(intersectionObserverConstructed).toHaveBeenCalledTimes(1);

    act(() => {
      lastIntersectionCallback!(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    expect(states[states.length - 1]).toEqual({
      expanded: false,
      loadFullContent: true,
    });
    expect(getContentContainer(renderer).props['aria-expanded']).toBe(false);

    act(() => {
      renderer.unmount();
    });
  });

  it('can force the overflow affordance for lazily hydrated collapsed content', () => {
    const renderer = renderCollapsibleMessage(
      { collapseMode: 'default', forceOverflowing: true },
      { clientHeight: 72, scrollHeight: 24 }
    );

    expect(findExpandZones(renderer)).toHaveLength(1);
    expect(resizeObserverConstructed).not.toHaveBeenCalled();
    expect(intersectionObserverConstructed).not.toHaveBeenCalled();

    act(() => {
      renderer.unmount();
    });
  });

  it('starts collapsed in default mode with gradient expand zone when overflowing', () => {
    const renderer = renderCollapsibleMessage({ collapseMode: 'default' });
    const content = getContentContainer(renderer);
    const expandZone = getExpandZone(renderer);

    expect(content.props.style.maxHeight).toBe('4.5em');
    expect(content.props.style.overflow).toBe('hidden');
    expect(content.props['aria-expanded']).toBe(false);
    expect(content.props.role).toBeUndefined();
    expect(expandZone.props['aria-label']).toBe('Show more');
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
    expect(getCloseButton(renderer).props['aria-label']).toBe('Show less');

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
    expect(getExpandZone(renderer).props['aria-label']).toBe('Show more');

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
    expect(getCloseButton(renderer).props['aria-label']).toBe('Show less');

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
    expect(getCloseButton(renderer).props['aria-label']).toBe('Show less');

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
      { clientHeight: 40, scrollHeight: 40 }
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
    expect(getCloseButton(renderer).props['aria-label']).toBe('Show less');

    act(() => {
      renderer.unmount();
    });
  });

  it('moves focus to gradient after collapse', () => {
    const gradientMock = { focus: vi.fn() };
    const renderer = renderCollapsibleMessage(
      { collapseMode: 'default' },
      { clientHeight: 72, scrollHeight: 160 },
      gradientMock
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
      { clientHeight: 0, scrollHeight: 0 }
    );

    // overflowing defaults to true; scrollHeight=0 guard prevents checkOverflow
    // from setting it to false, so gradient is shown
    const content = getContentContainer(renderer);
    expect(content.props.style.maxHeight).toBe('4.5em');
    expect(content.props.style.overflow).toBe('hidden');
    expect(findExpandZones(renderer)).toHaveLength(1);
    expect(getExpandZone(renderer).props['aria-label']).toBe('Show more');

    act(() => {
      renderer.unmount();
    });
  });

  it('IntersectionObserver re-checks overflow when element enters viewport', () => {
    // Start with scrollHeight=0 (simulates off-screen element with unknown layout)
    const contentElement = { clientHeight: 0, scrollHeight: 0 };
    const renderer = renderCollapsibleMessage({ collapseMode: 'default' }, contentElement);

    // Gradient is shown (overflowing defaults to true, scrollHeight=0 guard preserves it)
    expect(findExpandZones(renderer)).toHaveLength(1);
    expect(intersectionObserverConstructed).toHaveBeenCalled();

    // Simulate element entering viewport with real dimensions
    contentElement.scrollHeight = 160;
    contentElement.clientHeight = 72;
    act(() => {
      lastIntersectionCallback!(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
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
    const renderer = renderCollapsibleMessage({ collapseMode: 'default' }, contentElement);

    expect(findExpandZones(renderer)).toHaveLength(1);

    // Simulate element entering viewport — content is short, doesn't overflow
    contentElement.scrollHeight = 40;
    contentElement.clientHeight = 40;
    act(() => {
      lastIntersectionCallback!(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
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
      contentElement
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
      contentElement
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

  it('collapsed gradient renders a non-interactive Show more pill child', () => {
    const renderer = renderCollapsibleMessage({ collapseMode: 'default' });
    const expandZone = getExpandZone(renderer);

    // The gradient remains the single tab stop.
    expect(expandZone.props.tabIndex).toBe(0);
    expect(expandZone.props.role).toBe('button');

    // The pill child labels the action with "Show more" text.
    const pill = renderer.root.find(
      (node) => node.type === 'span' && node.props.className === 'collapsible-show-more'
    );
    const pillTextNode = pill.find(
      (node) =>
        node.type === 'span' &&
        typeof node.children?.[0] === 'string' &&
        node.children[0] === 'Show more'
    );
    expect(pillTextNode).toBeDefined();

    // The pill child must not be a button or a second tab stop.
    expect(pill.type).not.toBe('button');
    const buttonsInsideGradient = expandZone.findAll(
      (node) => node.type === 'button' || node.props.role === 'button',
      { deep: true }
    );
    // Only the outer gradient itself qualifies, so no extra interactive descendants.
    const nestedInteractive = buttonsInsideGradient.filter((node) => node !== expandZone);
    expect(nestedInteractive).toHaveLength(0);

    act(() => {
      renderer.unmount();
    });
  });

  it('expanded close control renders a sticky footer wrapper containing a Show less pill', () => {
    const renderer = renderCollapsibleMessage({ collapseMode: 'default' });

    act(() => {
      getExpandZone(renderer).props.onClick();
    });

    const closeButton = getCloseButton(renderer);
    expect(closeButton.props.className).toBe('collapsible-pill');

    // The button has visible "Show less" text.
    const labelNode = closeButton.find(
      (node) =>
        node.type === 'span' &&
        typeof node.children?.[0] === 'string' &&
        node.children[0] === 'Show less'
    );
    expect(labelNode).toBeDefined();

    // The button is wrapped by the sticky footer container.
    const stickyFooters = renderer.root.findAll(
      (node) =>
        node.type === 'div' &&
        typeof node.props.className === 'string' &&
        node.props.className === 'collapsible-sticky-footer'
    );
    expect(stickyFooters).toHaveLength(1);
    const stickyFooter = stickyFooters[0];
    const buttonInsideFooter = stickyFooter.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Show less'
    );
    expect(buttonInsideFooter).toBe(closeButton);

    // The legacy absolute close-button style class is no longer used.
    const legacy = renderer.root.findAll(
      (node) =>
        typeof node.props?.className === 'string' &&
        node.props.className === 'collapsible-close-button'
    );
    expect(legacy).toHaveLength(0);

    act(() => {
      renderer.unmount();
    });
  });

  it('mounts later instances expanded when the expand-all override is active', () => {
    const renderer = renderCollapsibleMessage(
      { collapseMode: 'default' },
      undefined,
      undefined,
      undefined,
      true
    );
    const content = getContentContainer(renderer);

    expect(content.props.style.maxHeight).toBeUndefined();
    expect(content.props['aria-expanded']).toBe(true);
    expect(getCloseButton(renderer).props['aria-label']).toBe('Show less');

    act(() => {
      renderer.unmount();
    });
  });

  it('mounts later instances collapsed when the collapse-all override is active', () => {
    const renderer = renderCollapsibleMessage(
      { collapseMode: 'default' },
      undefined,
      undefined,
      undefined,
      false
    );
    const content = getContentContainer(renderer);

    expect(content.props.style.maxHeight).toBe('4.5em');
    expect(content.props['aria-expanded']).toBe(false);

    act(() => {
      renderer.unmount();
    });
  });

  it('mounts later instances with default behavior when no expand-all override is set', () => {
    const renderer = renderCollapsibleMessage(
      { collapseMode: 'default' },
      undefined,
      undefined,
      undefined,
      undefined
    );
    const content = getContentContainer(renderer);

    expect(content.props.style.maxHeight).toBe('4.5em');
    expect(content.props['aria-expanded']).toBe(false);

    act(() => {
      renderer.unmount();
    });
  });

  it('keeps initially-expanded semantics for new instances while a collapse-all override is active', () => {
    const onInitialExpandConsumed = vi.fn();
    // Record every rendered expanded state: the FIRST render must already be
    // expanded (a post-paint effect correction would flash collapsed on
    // virtualized mounts).
    const renderedStates: boolean[] = [];
    const renderer = renderCollapsibleMessage(
      {
        collapseMode: 'initially-expanded',
        onInitialExpandConsumed,
      },
      undefined,
      undefined,
      ({ expanded }: { expanded: boolean }) => {
        renderedStates.push(expanded);
        return React.createElement('span', undefined, 'message');
      },
      false
    );

    expect(renderedStates[0]).toBe(true);
    expect(onInitialExpandConsumed).toHaveBeenCalledTimes(1);
    expect(getContentContainer(renderer).props['aria-expanded']).toBe(true);

    act(() => {
      renderer.unmount();
    });
  });

  it('does not render the sticky footer when collapsed or for always-expanded mode', () => {
    const collapsedRenderer = renderCollapsibleMessage({ collapseMode: 'default' });
    expect(
      collapsedRenderer.root.findAll(
        (node) => node.props?.className === 'collapsible-sticky-footer'
      )
    ).toHaveLength(0);
    act(() => {
      collapsedRenderer.unmount();
    });

    const exemptRenderer = renderCollapsibleMessage({ collapseMode: 'always-expanded' });
    expect(
      exemptRenderer.root.findAll((node) => node.props?.className === 'collapsible-sticky-footer')
    ).toHaveLength(0);
    act(() => {
      exemptRenderer.unmount();
    });
  });

  // Task #127: the overflow verdict is remembered per measurementKey so
  // a virtualized REMOUNT renders its final height in one pass. The
  // old always-true initial guess made every remount of a short row
  // render capped-with-banner first and shrink a layout pass later —
  // the per-remount height flip behind the scroll-position oscillation
  // and the mid-scroll momentum-killing corrections on mobile.
  it('remounts with the remembered non-overflowing verdict (single-pass height)', () => {
    const shortContent = { clientHeight: 40, scrollHeight: 40 };
    const key = `verdict-cache-${Date.now()}`;

    // First encounter: initial guess is overflowing (gradient shown),
    // layout measurement corrects to non-overflowing.
    const first = renderCollapsibleMessage({ measurementKey: key }, shortContent);
    expect(findExpandZones(first)).toHaveLength(0);
    act(() => {
      first.unmount();
    });

    // Remount (virtualized re-entry): must initialize from the cached
    // verdict — no expand zone even BEFORE any measurement runs, which
    // we force by giving the content zero layout (scrollHeight 0 makes
    // isContentOverflowing return null, so only the initial state can
    // decide).
    const unmeasured = { clientHeight: 0, scrollHeight: 0 };
    const second = renderCollapsibleMessage({ measurementKey: key }, unmeasured);
    expect(findExpandZones(second)).toHaveLength(0);
    expect(findGradientOverlays(second)).toHaveLength(0);
    act(() => {
      second.unmount();
    });
  });

  it('forceOverflowing overrides a cached non-overflowing verdict on remount', () => {
    const shortContent = { clientHeight: 40, scrollHeight: 40 };
    const key = `verdict-cache-force-${Date.now()}`;

    // Seed the cache with a non-overflowing verdict for this key.
    const first = renderCollapsibleMessage({ measurementKey: key }, shortContent);
    expect(findExpandZones(first)).toHaveLength(0);
    act(() => {
      first.unmount();
    });

    // Remount with forceOverflowing: the affordance must show despite
    // the cached `false` (greptile PR #77: force override must win over
    // a stale cached verdict). Zero layout so only initial state decides.
    const unmeasured = { clientHeight: 0, scrollHeight: 0 };
    const forced = renderCollapsibleMessage(
      { measurementKey: key, forceOverflowing: true },
      unmeasured
    );
    expect(findExpandZones(forced)).toHaveLength(1);
    act(() => {
      forced.unmount();
    });
  });

  it('remounts with the remembered overflowing verdict as well', () => {
    const longContent = { clientHeight: 72, scrollHeight: 160 };
    const key = `verdict-cache-long-${Date.now()}`;

    const first = renderCollapsibleMessage({ measurementKey: key }, longContent);
    expect(findExpandZones(first)).toHaveLength(1);
    act(() => {
      first.unmount();
    });

    const unmeasured = { clientHeight: 0, scrollHeight: 0 };
    const second = renderCollapsibleMessage({ measurementKey: key }, unmeasured);
    expect(findExpandZones(second)).toHaveLength(1);
    act(() => {
      second.unmount();
    });
  });

  it('keeps a manually expanded message expanded across a virtualized remount', () => {
    const expansionKey = '$manual-expansion';
    const manualExpansionState = new Map<string, boolean>();
    const first = renderCollapsibleMessage(
      {
        collapseMode: 'default',
        expansionKey,
        measurementKey: '$manual-expansion|active|$edit-1|default',
      },
      undefined,
      undefined,
      undefined,
      undefined,
      manualExpansionState
    );

    act(() => {
      getExpandZone(first).props.onClick();
    });
    expect(getContentContainer(first).props['aria-expanded']).toBe(true);
    act(() => {
      first.unmount();
    });

    const second = renderCollapsibleMessage(
      {
        collapseMode: 'default',
        expansionKey,
        measurementKey: '$manual-expansion|active|$edit-2|default',
      },
      { clientHeight: 0, scrollHeight: 0 },
      undefined,
      undefined,
      undefined,
      manualExpansionState
    );
    expect(getContentContainer(second).props['aria-expanded']).toBe(true);
    expect(getCloseButton(second).props['aria-label']).toBe('Show less');
    act(() => {
      second.unmount();
    });
  });

  it('remembers Show less and keeps other messages isolated', () => {
    const expansionKey = '$manual-collapse';
    const manualExpansionState = new Map<string, boolean>();
    const first = renderCollapsibleMessage(
      { collapseMode: 'default', expansionKey },
      undefined,
      undefined,
      undefined,
      undefined,
      manualExpansionState
    );

    act(() => {
      getExpandZone(first).props.onClick();
    });
    act(() => {
      getCloseButton(first).props.onClick({ stopPropagation: vi.fn() });
    });
    expect(manualExpansionState.get(expansionKey)).toBe(false);
    act(() => {
      first.unmount();
    });

    const sameMessage = renderCollapsibleMessage(
      { collapseMode: 'default', expansionKey },
      undefined,
      undefined,
      undefined,
      undefined,
      manualExpansionState
    );
    expect(getContentContainer(sameMessage).props['aria-expanded']).toBe(false);
    act(() => {
      sameMessage.unmount();
    });

    rememberManualExpansionState(manualExpansionState, expansionKey, true);
    const otherMessage = renderCollapsibleMessage(
      { collapseMode: 'default', expansionKey: '$other-message' },
      undefined,
      undefined,
      undefined,
      undefined,
      manualExpansionState
    );
    expect(getContentContainer(otherMessage).props['aria-expanded']).toBe(false);
    act(() => {
      otherMessage.unmount();
    });
  });

  it('lets newer manual choices override the expand-all baseline', () => {
    const expansionKey = '$manual-after-global';
    const manualExpansionState = new Map<string, boolean>([[expansionKey, true]]);
    const expanded = renderCollapsibleMessage(
      { collapseMode: 'default', expansionKey },
      undefined,
      undefined,
      undefined,
      false,
      manualExpansionState
    );
    expect(getContentContainer(expanded).props['aria-expanded']).toBe(true);
    act(() => {
      expanded.unmount();
    });

    rememberManualExpansionState(manualExpansionState, expansionKey, false);
    const collapsed = renderCollapsibleMessage(
      { collapseMode: 'default', expansionKey },
      undefined,
      undefined,
      undefined,
      true,
      manualExpansionState
    );
    expect(getContentContainer(collapsed).props['aria-expanded']).toBe(false);
    act(() => {
      collapsed.unmount();
    });
  });

  it('bounds manual expansion state by evicting the oldest key', () => {
    const state = new Map<string, boolean>();
    rememberManualExpansionState(state, '$oldest', true, 2);
    rememberManualExpansionState(state, '$middle', false, 2);
    rememberManualExpansionState(state, '$newest', true, 2);

    expect(state.get('$oldest')).toBeUndefined();
    expect(state.get('$middle')).toBe(false);
    expect(state.get('$newest')).toBe(true);
  });
});
