import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadTagPicker } from './ThreadTagPicker';
import * as css from '../ThreadContextBanner.css';

vi.mock('../ThreadContextBanner.css', () => ({
  TagPickerInput: 'tag-picker-input',
  TagPickerInputContainer: 'tag-picker-input-container',
}));

vi.mock('folds', () => ({
  Box: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement('div', props, children),
  Menu: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement('div', props, children),
  MenuItem: ({
    children,
    onClick,
    ...props
  }: React.PropsWithChildren<Record<string, unknown> & { onClick?: () => void }>) =>
    React.createElement('button', { ...props, type: 'button', onClick }, children),
  PopOut: ({ anchor, content }: { anchor?: unknown; content: React.ReactNode }) =>
    anchor ? React.createElement(React.Fragment, null, content) : null,
  Text: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement('span', props, children),
  config: {
    space: {
      S100: '4px',
      S200: '8px',
      S300: '12px',
    },
  },
  color: {
    SurfaceVariant: {
      ContainerLine: '#333',
    },
  },
}));

vi.mock('focus-trap-react', () => ({
  default: ({ children }: React.PropsWithChildren) =>
    React.createElement(React.Fragment, null, children),
}));

describe('ThreadTagPicker', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the shared themed input class when opened', () => {
    const onAddTag = vi.fn();
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        React.createElement(ThreadTagPicker, {
          availableTags: ['bug', 'feature'],
          onAddTag,
        })
      );
    });

    const addButton = renderer.root.findByProps({ 'aria-label': 'Add tag' });

    act(() => {
      addButton.props.onClick({
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
        },
      });
    });

    const input = renderer.root.findByProps({ 'aria-label': 'Filter or create tag' });

    expect(input.props.className).toBe(css.TagPickerInput);
    expect(input.props.placeholder).toBe('Filter / new...');
    expect(input.parent).not.toBeNull();
    expect(input.parent?.props.className).toBe(css.TagPickerInputContainer);
  });

  it('says when it opens and closes, also when it goes while open', () => {
    const onOpenChange = vi.fn();
    const picker = (onAddTag = vi.fn()) =>
      React.createElement(ThreadTagPicker, { availableTags: ['bug'], onAddTag, onOpenChange });
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(picker());
    });
    const open = () =>
      act(() => {
        renderer.root.findByProps({ 'aria-label': 'Add tag' }).props.onClick({
          currentTarget: {
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
          },
        });
      });
    expect(onOpenChange).not.toHaveBeenCalled();
    open();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    // Chosen: closed.
    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Filter or create tag' }).props.onChange({
        target: { value: 'bug' },
      });
    });
    act(() => {
      renderer.root
        .findByProps({ 'aria-label': 'Filter or create tag' })
        .props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() });
    });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    // Unmounted while open: closed.
    open();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    act(() => renderer.unmount());
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onOpenChange).toHaveBeenCalledTimes(4);
  });
});
