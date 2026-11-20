// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installOverlayFocus } from '../lib/overlayFocus';
import { hasBlockingPortalOverlay } from '../lib/portalOverlay';
import { openOverlay } from '../shortcuts/shortcutDom';
import { PopOut } from './directional';
import { BottomSheet } from './BottomSheet';

/** A filter and a menu, as the agent card has; the menu closes itself on Escape, as a trap does. */
function Content() {
  const [menu, setMenu] = useState(false);
  return (
    <>
      <input aria-label="Filter" />
      <PopOut
        anchor={menu ? { x: 0, y: 0, width: 10, height: 10 } : undefined}
        content={
          <button type="button" onKeyDown={(event) => event.key === 'Escape' && setMenu(false)}>
            Power
          </button>
        }
      >
        <button type="button" onClick={() => setMenu(true)}>
          Moderator
        </button>
      </PopOut>
    </>
  );
}

const open = () => {
  const close = vi.fn();
  render(
    <>
      <main>Room</main>
      <BottomSheet title="Helper" closeLabel="Close" requestClose={close}>
        <Content />
      </BottomSheet>
    </>
  );
  return close;
};

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  }
);
afterEach(cleanup);

describe('BottomSheet', () => {
  it('closes on Escape, but not while a menu of its content is open or a word is composed', () => {
    const close = open();
    fireEvent.click(screen.getByText('Moderator'));
    const menu = screen.getByText('Power');
    expect(screen.getByRole('dialog', { name: 'Helper' }).contains(menu)).toBe(true);
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByText('Power')).toBeNull();
    expect(close).not.toHaveBeenCalled();

    const filter = screen.getByLabelText('Filter');
    fireEvent.keyDown(filter, { key: 'Escape', isComposing: true });
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(filter, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('moves focus into a menu that Enter opened, and back to its chip when Escape closes it', async () => {
    // jsdom lays nothing out; every connected element counts as shown.
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function rects(
      this: HTMLElement
    ) {
      return (this.isConnected ? [{}] : []) as unknown as DOMRectList;
    });
    const uninstall = installOverlayFocus(document);
    const close = open();
    const chip = screen.getByText('Moderator');
    // Past the sheet's own focus on open.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    chip.focus();
    fireEvent.keyDown(chip, { key: 'Enter' });
    fireEvent.click(chip);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('Power')));

    fireEvent.keyDown(screen.getByText('Power'), { key: 'Escape' });
    expect(screen.queryByText('Power')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(chip));
    expect(close).not.toHaveBeenCalled();
    uninstall();
    vi.restoreAllMocks();
  });

  it('hides what is behind it from assistive tech', () => {
    open();
    expect(screen.getByText('Room').closest('[inert], [aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole('dialog', { name: 'Helper' }).closest('[inert]')).toBeNull();
  });

  it('holds global shortcuts (the command palette among them) while open, and only then', () => {
    expect([hasBlockingPortalOverlay(), openOverlay()]).toEqual([false, 'none']);
    open();
    expect([hasBlockingPortalOverlay(), openOverlay()]).toEqual([true, 'other']);
    cleanup();
    expect([hasBlockingPortalOverlay(), openOverlay()]).toEqual([false, 'none']);
  });
});
