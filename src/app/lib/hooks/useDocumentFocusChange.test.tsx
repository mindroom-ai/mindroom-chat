// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBridge, DesktopShellEvent } from '../desktopBridge';
import { useDocumentFocusChange } from './useDocumentFocusChange';

const setDesktopBridge = (bridge: Partial<DesktopBridge> | undefined): void => {
  if (bridge === undefined) {
    Reflect.deleteProperty(window, 'mindroomDesktop');
  } else {
    Object.defineProperty(window, 'mindroomDesktop', { configurable: true, value: bridge });
  }
};

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  setDesktopBridge(undefined);
  vi.restoreAllMocks();
});

function Probe({ onChange }: { onChange: (inFocus: boolean) => void }) {
  useDocumentFocusChange(onChange);
  return null;
}

describe('useDocumentFocusChange', () => {
  it('follows window focus/blur and desktop window-focus shell events', () => {
    let windowFocused = false;
    let shellListener: ((event: DesktopShellEvent) => void) | undefined;
    const unsubscribe = vi.fn(() => {
      shellListener = undefined;
    });
    setDesktopBridge({
      isWindowFocused: () => windowFocused,
      onShellEvent: (listener) => {
        shellListener = listener;
        return unsubscribe;
      },
    });
    const hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const onChange = vi.fn();

    act(() => {
      renderer = create(<Probe onChange={onChange} />);
    });

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(onChange).toHaveBeenLastCalledWith(false);

    windowFocused = true;
    act(() => {
      shellListener?.({ type: 'window-hidden' });
    });
    expect(onChange).toHaveBeenCalledTimes(1);

    act(() => {
      shellListener?.({ type: 'window-focus', focused: true });
    });
    expect(onChange).toHaveBeenLastCalledWith(true);

    windowFocused = false;
    act(() => {
      shellListener?.({ type: 'window-focus', focused: false });
    });
    expect(onChange).toHaveBeenLastCalledWith(false);

    windowFocused = true;
    hasFocusSpy.mockReturnValue(false);
    act(() => {
      shellListener?.({ type: 'window-focus', focused: true });
    });
    expect(onChange).toHaveBeenLastCalledWith(false);

    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(onChange).toHaveBeenLastCalledWith(false);

    act(() => renderer?.unmount());
    renderer = undefined;
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
