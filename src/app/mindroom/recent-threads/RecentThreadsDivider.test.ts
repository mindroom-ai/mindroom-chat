import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn }),
  };
});

vi.mock('./recentThreads.css', () => ({
  Divider: 'Divider',
  DividerActive: 'DividerActive',
  DividerHandle: 'DividerHandle',
  DividerToggle: 'DividerToggle',
  DividerToggleHandle: 'DividerToggleHandle',
}));

import { RecentThreadsDivider } from './RecentThreadsDivider';

const getSeparator = (renderer: ReactTestRenderer) =>
  renderer.root.find((node) => typeof node.type === 'string' && node.props.role === 'separator');

const getToggleButton = (renderer: ReactTestRenderer) =>
  renderer.root.find((node) => typeof node.type === 'string' && node.type === 'button');

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

    it('uses current resize bounds while keeping one listener set across restarted drags', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
      const onPreviewHeightChange = vi.fn();
      const onCommitHeightChange = vi.fn();
      const onDraggingChange = vi.fn();

      act(() => {
        renderer = create(
          React.createElement(RecentThreadsDivider, {
            mode: 'resize',
            panelHeight: 120,
            minHeight: 80,
            maxHeight: 240,
            collapsedHeight: 32,
            onPreviewHeightChange,
            onCommitHeightChange,
            onDraggingChange,
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
      expect(onDraggingChange).toHaveBeenLastCalledWith(true);

      act(() => {
        separator.props.onPointerDown({
          pointerId: 2,
          clientY: 180,
          preventDefault: vi.fn(),
        });
      });

      expect(addEventListenerSpy).toHaveBeenCalledTimes(3);
      expect(removeEventListenerSpy).not.toHaveBeenCalled();

      act(() => {
        renderer?.update(
          React.createElement(RecentThreadsDivider, {
            mode: 'resize',
            panelHeight: 120,
            minHeight: 80,
            maxHeight: 160,
            collapsedHeight: 32,
            onPreviewHeightChange,
            onCommitHeightChange,
            onDraggingChange,
          })
        );
      });

      const getWindowListener = (eventName: string) =>
        addEventListenerSpy.mock.calls.find(([name]) => name === eventName)?.[1] as EventListener;

      act(() => {
        getWindowListener('pointermove')({ pointerId: 1, clientY: 0 } as PointerEvent);
        getWindowListener('pointermove')({ pointerId: 2, clientY: 0 } as PointerEvent);
      });

      expect(onPreviewHeightChange).toHaveBeenLastCalledWith(160);

      act(() => {
        getWindowListener('pointerup')({ pointerId: 2 } as PointerEvent);
      });

      expect(onCommitHeightChange).toHaveBeenLastCalledWith(160);
      expect(onDraggingChange).toHaveBeenLastCalledWith(false);
      expect(removeEventListenerSpy).toHaveBeenCalledTimes(3);
    });

    it('ends an active drag and removes listeners when switching to toggle mode', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
      const onDraggingChange = vi.fn();

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
            onDraggingChange,
          })
        );
      });

      act(() => {
        getSeparator(renderer!).props.onPointerDown({
          pointerId: 1,
          clientY: 200,
          preventDefault: vi.fn(),
        });
      });

      act(() => {
        renderer?.update(
          React.createElement(RecentThreadsDivider, {
            entryCount: 1,
            mode: 'toggle',
            isExpanded: true,
            onToggle: vi.fn(),
          })
        );
      });

      expect(onDraggingChange).toHaveBeenLastCalledWith(false);
      expect(removeEventListenerSpy).toHaveBeenCalledTimes(3);
    });

    it('ends an active drag and removes listeners when unmounted', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
      const onDraggingChange = vi.fn();

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
            onDraggingChange,
          })
        );
      });

      act(() => {
        getSeparator(renderer!).props.onPointerDown({
          pointerId: 1,
          clientY: 200,
          preventDefault: vi.fn(),
        });
      });

      act(() => {
        renderer?.unmount();
      });
      renderer = undefined;

      expect(onDraggingChange).toHaveBeenLastCalledWith(false);
      expect(removeEventListenerSpy).toHaveBeenCalledTimes(3);
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
