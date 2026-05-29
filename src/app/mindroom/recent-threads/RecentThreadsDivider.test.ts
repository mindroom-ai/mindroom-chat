import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./recentThreads.css', () => ({
  Divider: 'Divider',
  DividerActive: 'DividerActive',
  DividerHandle: 'DividerHandle',
  DividerToggle: 'DividerToggle',
  DividerToggleHandle: 'DividerToggleHandle',
}));

import { RecentThreadsDivider } from './RecentThreadsDivider';

const getSeparator = (renderer: ReactTestRenderer) =>
  renderer.root.find(
    (node) => typeof node.type === 'string' && node.props.role === 'separator'
  );

const getToggleButton = (renderer: ReactTestRenderer) =>
  renderer.root.find(
    (node) => typeof node.type === 'string' && node.type === 'button'
  );

describe('RecentThreadsDivider', () => {
  let renderer: ReactTestRenderer | undefined;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
  });

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
    }
    renderer = undefined;
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  });

  describe('mode=resize', () => {
    it('exposes keyboard-accessible separator semantics and arrow-key resizing', () => {
      const onPreviewHeightChange = vi.fn();
      const onCommitHeightChange = vi.fn();

      act(() => {
        renderer = create(
          React.createElement(RecentThreadsDivider, {
            mode: 'resize',
            panelHeight: 32,
            minHeight: 80,
            maxHeight: 240,
            collapsedHeight: 32,
            onPreviewHeightChange,
            onCommitHeightChange,
          })
        );
      });

      const separator = getSeparator(renderer!);
      expect(separator.props.tabIndex).toBe(0);
      expect(separator.props['aria-valuemin']).toBe(32);
      expect(separator.props['aria-valuemax']).toBe(240);
      expect(separator.props['aria-valuenow']).toBe(32);

      const preventDefault = vi.fn();
      act(() => {
        separator.props.onKeyDown({
          key: 'ArrowUp',
          preventDefault,
        });
      });

      expect(preventDefault).toHaveBeenCalledOnce();
      expect(onPreviewHeightChange).toHaveBeenLastCalledWith(80);
      expect(onCommitHeightChange).toHaveBeenLastCalledWith(80);

      act(() => {
        renderer?.update(
          React.createElement(RecentThreadsDivider, {
            mode: 'resize',
            panelHeight: 80,
            minHeight: 80,
            maxHeight: 240,
            collapsedHeight: 32,
            onPreviewHeightChange,
            onCommitHeightChange,
          })
        );
      });

      act(() => {
        getSeparator(renderer!).props.onKeyDown({
          key: 'ArrowDown',
          preventDefault: vi.fn(),
        });
      });

      expect(onPreviewHeightChange).toHaveBeenLastCalledWith(32);
      expect(onCommitHeightChange).toHaveBeenLastCalledWith(32);
    });

    it('cleans up the previous window listeners before starting a second drag', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      act(() => {
        renderer = create(
          React.createElement(RecentThreadsDivider, {
            mode: 'resize',
            panelHeight: 120,
            minHeight: 80,
            maxHeight: 240,
            collapsedHeight: 32,
            onPreviewHeightChange: vi.fn(),
            onCommitHeightChange: vi.fn(),
          })
        );
      });

      const separator = getSeparator(renderer!);

      act(() => {
        separator.props.onPointerDown({
          pointerId: 1,
          clientY: 200,
          preventDefault: vi.fn(),
        });
      });

      expect(addEventListenerSpy).toHaveBeenCalledTimes(3);

      act(() => {
        separator.props.onPointerDown({
          pointerId: 2,
          clientY: 180,
          preventDefault: vi.fn(),
        });
      });

      expect(removeEventListenerSpy).toHaveBeenCalledTimes(3);
      expect(removeEventListenerSpy).toHaveBeenNthCalledWith(
        1,
        'pointermove',
        expect.any(Function)
      );
      expect(removeEventListenerSpy).toHaveBeenNthCalledWith(2, 'pointerup', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenNthCalledWith(
        3,
        'pointercancel',
        expect.any(Function)
      );
    });
  });

  describe('mode=toggle', () => {
    it('renders a single labeled toggle button with heading semantics and click toggle behavior', () => {
      const onToggle = vi.fn();

      act(() => {
        renderer = create(
          React.createElement(RecentThreadsDivider, {
            entryCount: 3,
            mode: 'toggle',
            isExpanded: false,
            onToggle,
          })
        );
      });

      const button = getToggleButton(renderer!);
      const heading = renderer!.root.find((node) => node.props.role === 'heading');

      expect(button.props['aria-label']).toBe('Recent Threads');
      expect(button.props['aria-expanded']).toBe(false);
      expect(heading.props['aria-level']).toBe(2);

      act(() => {
        button.props.onClick();
      });

      expect(onToggle).toHaveBeenCalledOnce();
    });

    it('does not attach a custom keydown handler to the native toggle button', () => {
      act(() => {
        renderer = create(
          React.createElement(RecentThreadsDivider, {
            entryCount: 0,
            mode: 'toggle',
            isExpanded: true,
            onToggle: vi.fn(),
          })
        );
      });

      expect(getToggleButton(renderer!).props.onKeyDown).toBeUndefined();
    });
  });
});
