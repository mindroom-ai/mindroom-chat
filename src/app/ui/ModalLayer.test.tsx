// @vitest-environment jsdom
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DialogOpenerContext, ModalLayer } from './ModalLayer';

// jsdom lays nothing out, so focus-trap finds no tabbable node; the trap is not under test here.
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

afterEach(cleanup);

describe('ModalLayer in a pop-out that opened it', () => {
  it('hides the opener while the dialog is open', () => {
    const show = vi.fn();
    const hide = vi.fn(() => show);
    const layer = (open: boolean) => (
      <DialogOpenerContext.Provider value={hide}>
        <ModalLayer open={open} onClose={vi.fn()}>
          <div role="dialog">Details</div>
        </ModalLayer>
      </DialogOpenerContext.Provider>
    );

    const { rerender, unmount } = render(layer(false));
    expect(hide).not.toHaveBeenCalled();

    rerender(layer(true));
    expect(hide).toHaveBeenCalledTimes(1);
    expect(show).not.toHaveBeenCalled();

    rerender(layer(false));
    expect(show).toHaveBeenCalledTimes(1);

    // An entry that closes the pop-out with its dialog unmounts the layer while it is open.
    rerender(layer(true));
    unmount();
    expect(hide).toHaveBeenCalledTimes(2);
    expect(show).toHaveBeenCalledTimes(2);
  });
});
