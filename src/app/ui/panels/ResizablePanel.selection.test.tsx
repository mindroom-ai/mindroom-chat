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

/** Both halves of the block, each on its own: the root's attribute and the selectstart listener. */
const blocked = () => ({
  attribute: document.documentElement.hasAttribute(RESIZING),
  selectstart: !document.body.dispatchEvent(new Event('selectstart', { cancelable: true })),
});
const ON = { attribute: true, selectstart: true };
const OFF = { attribute: false, selectstart: false };

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
    const view = render(panel(), { wrapper: React.StrictMode });
    const handle = () => view.getByRole('separator');
    expect(blocked()).toEqual(OFF);
    const end = (finish: () => void) => {
      fireEvent.pointerDown(handle(), { clientX: 500, button: 0 });
      expect(blocked()).toEqual(ON);
      finish();
      expect(blocked()).toEqual(OFF);
    };
    end(() => fireEvent.pointerUp(handle(), { clientX: 400 }));
    end(() => fireEvent.pointerCancel(handle()));
    end(() => fireEvent.lostPointerCapture(handle()));
    // The panel stops being resizable mid-drag (it fills the room), and goes away mid-drag.
    end(() => view.rerender(panel({ fullWidth: true })));
    view.rerender(panel());
    end(() => view.unmount());
  });

  it('keeps the page from selecting until the last of two drags ends', () => {
    const view = render(
      <>
        {panel({ testId: 'first' })}
        {panel({ testId: 'second', storageKey: 'test.second' })}
      </>,
      { wrapper: React.StrictMode }
    );
    const first = view.getByTestId('first').querySelector('[role="separator"]')!;
    const second = view.getByTestId('second').querySelector('[role="separator"]')!;
    // A mouse and a pen are each primary for their own kind of pointer.
    fireEvent.pointerDown(first, { clientX: 500, button: 0, pointerId: 1 });
    fireEvent.pointerDown(second, { clientX: 500, button: 0, pointerId: 2 });
    fireEvent.pointerUp(first, { pointerId: 1 });
    // A second end of the drag that ended changes nothing.
    fireEvent.lostPointerCapture(first, { pointerId: 1 });
    expect(blocked()).toEqual(ON);
    fireEvent.pointerUp(second, { pointerId: 2 });
    expect(blocked()).toEqual(OFF);
    fireEvent.pointerDown(first, { clientX: 500, button: 0, pointerId: 1 });
    view.unmount();
    expect(blocked()).toEqual(OFF);
  });
});
