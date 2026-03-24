import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collapseAllMessages,
  CollapsibleMessage,
} from './CollapsibleMessage';

type MockContentElement = Pick<HTMLDivElement, 'clientHeight' | 'scrollHeight'>;

let resizeObserverConstructed: ReturnType<typeof vi.fn>;

class MockResizeObserver {
  public observe = vi.fn();

  public disconnect = vi.fn();

  public constructor(_callback: ResizeObserverCallback) {
    resizeObserverConstructed();
  }
}

const getContentContainer = (renderer: ReactTestRenderer) =>
  renderer.root.find(
    (node) => node.type === 'div' && node.props.style?.position === 'relative'
  );

const getToggle = (renderer: ReactTestRenderer) => renderer.root.findByType('a');

const renderCollapsibleMessage = (
  props: Omit<React.ComponentProps<typeof CollapsibleMessage>, 'children'>,
  contentElement: MockContentElement = {
    clientHeight: 72,
    scrollHeight: 160,
  }
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
          if (element.type === 'div' && element.props.style?.position === 'relative') {
            return contentElement;
          }

          return null;
        },
      }
    );
  });

  return renderer;
};

beforeEach(() => {
  resizeObserverConstructed = vi.fn();
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  vi.stubGlobal('getComputedStyle', () => ({ fontSize: '16px' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CollapsibleMessage', () => {
  it('starts collapsed in default mode and shows the expand toggle when overflowing', () => {
    const renderer = renderCollapsibleMessage({ collapseMode: 'default' });
    const content = getContentContainer(renderer);

    expect(content.props.style.maxHeight).toBe('4.5em');
    expect(content.props.style.overflow).toBe('hidden');
    expect(getToggle(renderer).children).toEqual(['[+]']);
    expect(resizeObserverConstructed).toHaveBeenCalledTimes(1);

    act(() => {
      renderer.unmount();
    });
  });

  it('stays fully expanded in always-expanded mode and ignores collapse controls', () => {
    const renderer = renderCollapsibleMessage({ collapseMode: 'always-expanded' });
    const content = getContentContainer(renderer);

    expect(content.props.style.maxHeight).toBeUndefined();
    expect(content.props.style.overflow).toBeUndefined();
    expect(renderer.root.findAllByType('a')).toHaveLength(0);
    expect(resizeObserverConstructed).not.toHaveBeenCalled();

    act(() => {
      collapseAllMessages();
    });

    expect(getContentContainer(renderer).props.style.maxHeight).toBeUndefined();
    expect(renderer.root.findAllByType('a')).toHaveLength(0);

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
    expect(getToggle(renderer).children).toEqual(['[-]']);

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

    expect(getContentContainer(renderer).props.style.maxHeight).toBe('4.5em');
    expect(getContentContainer(renderer).props.style.overflow).toBe('hidden');
    expect(getToggle(renderer).children).toEqual(['[+]']);

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
    expect(getToggle(renderer).children).toEqual(['[-]']);

    act(() => {
      renderer.unmount();
    });
  });
});
