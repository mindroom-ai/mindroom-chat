// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResizablePanel } from './ResizablePanel';
import { RESIZING } from './ResizablePanel.css';

class TestPointerEvent extends MouseEvent {
  pointerId: number;

  isPrimary: boolean;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.isPrimary = init.isPrimary ?? true;
  }
}

const panel = (props: Partial<React.ComponentProps<typeof ResizablePanel>> = {}) => (
  <ResizablePanel storageKey="test.width" resizeLabel="Resize" testId="panel" side="end" {...props}>
    <p>content</p>
  </ResizablePanel>
);

/** Whether a press on the page would start a selection now. */
const selects = () =>
  !document.documentElement.hasAttribute(RESIZING) &&
  document.body.dispatchEvent(new Event('selectstart', { cancelable: true }));

beforeEach(() => {
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}

      disconnect() {}
    }
  );
  Object.assign(HTMLElement.prototype, {
    setPointerCapture: () => undefined,
    hasPointerCapture: () => false,
    releasePointerCapture: () => undefined,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a splitter drag', () => {
  it('keeps the page from selecting until the drag ends, however it ends', () => {
    const view = render(panel());
    const handle = () => view.getByRole('separator');
    fireEvent.pointerDown(handle(), { clientX: 500, button: 0 });
    expect(selects()).toBe(false);
    fireEvent.pointerUp(handle(), { clientX: 400 });
    expect(selects()).toBe(true);

    fireEvent.pointerDown(handle(), { clientX: 500, button: 0 });
    fireEvent.lostPointerCapture(handle());
    expect(selects()).toBe(true);

    // The panel stops being resizable mid-drag (it fills the room), and then goes away mid-drag.
    fireEvent.pointerDown(handle(), { clientX: 500, button: 0 });
    view.rerender(panel({ fullWidth: true }));
    expect(selects()).toBe(true);
    view.rerender(panel());
    fireEvent.pointerDown(handle(), { clientX: 500, button: 0 });
    expect(selects()).toBe(false);
    view.unmount();
    expect(selects()).toBe(true);
  });
});
