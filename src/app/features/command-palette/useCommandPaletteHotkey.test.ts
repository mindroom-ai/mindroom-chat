import React, { useState } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommandPaletteHotkey } from './useCommandPaletteHotkey';

const hookState: {
  callback?: (event: KeyboardEvent) => void;
} = {};

vi.mock('../../hooks/useKeyDown', () => ({
  useKeyDown: (_target: Window, callback: (event: KeyboardEvent) => void) => {
    hookState.callback = callback;
  },
}));

type Snapshot = {
  open: boolean;
};

const createKeyboardEvent = (): KeyboardEvent =>
  ({
    key: 'k',
    ctrlKey: true,
    preventDefault: vi.fn(),
  }) as unknown as KeyboardEvent;

const renderHookHarness = (portalChildren: unknown[] = []) => {
  const snapshot: Snapshot = {
    open: false,
  };

  vi.stubGlobal('document', {
    getElementById: (id: string) =>
      id === 'portalContainer'
        ? {
            children: portalChildren,
          }
        : null,
  });
  vi.stubGlobal('window', {});

  function Harness() {
    const [open, setOpen] = useState(false);
    snapshot.open = open;
    useCommandPaletteHotkey(open, setOpen, (event) => event.key === 'k' && event.ctrlKey);
    return null;
  }

  const renderer = create(React.createElement(Harness));

  return {
    renderer,
    getSnapshot: () => snapshot,
    dispatchShortcut: (event = createKeyboardEvent()) => {
      act(() => {
        hookState.callback?.(event);
      });
      return event;
    },
  };
};

describe('useCommandPaletteHotkey', () => {
  beforeEach(() => {
    hookState.callback = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens on the palette shortcut', () => {
    const { renderer, getSnapshot, dispatchShortcut } = renderHookHarness();

    const event = dispatchShortcut();

    expect(getSnapshot().open).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });

  it('closes on a second shortcut press when already open', () => {
    const { renderer, getSnapshot, dispatchShortcut } = renderHookHarness();

    dispatchShortcut();
    expect(getSnapshot().open).toBe(true);

    const secondEvent = dispatchShortcut();

    expect(getSnapshot().open).toBe(false);
    expect(secondEvent.preventDefault).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });

  it('does not open while another portal overlay is mounted', () => {
    const { renderer, getSnapshot, dispatchShortcut } = renderHookHarness([{}]);

    const event = dispatchShortcut();

    expect(getSnapshot().open).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    renderer.unmount();
  });
});
