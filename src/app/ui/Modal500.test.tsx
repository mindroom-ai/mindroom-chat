// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { Modal500 } from './Modal500';

vi.mock('./Modal500.css', () => ({
  SafeOverlayCenter: 'center-safe',
  PhoneInsetOverlayCenter: 'center-phone-inset',
  PhoneOverlayCenter: 'center-phone-fill',
  PhoneModal: 'modal-phone-fill',
}));
vi.unmock('./glass/GlassPrimitives');
// jsdom lays nothing out, so focus-trap finds no tabbable node; the trap is not under test here.
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const open = (screenSize: ScreenSize, fillPhoneScreen?: boolean) => {
  render(
    <ScreenSizeProvider value={screenSize}>
      <Modal500 requestClose={vi.fn()} fillPhoneScreen={fillPhoneScreen}>
        <h2>Settings</h2>
        <button type="button">Close</button>
      </Modal500>
    </ScreenSizeProvider>
  );
  const dialog = screen.getByRole('dialog');
  return { dialog, center: dialog.parentElement as HTMLElement };
};

afterEach(cleanup);

describe('Modal500', () => {
  it('offers a notice place inside the dialog, after its content', () => {
    const { dialog } = open(ScreenSize.Desktop);
    // Inside, the focus the dialog holds reaches a notice; last, its first control stays first.
    expect(dialog.lastElementChild?.getAttribute('aria-live')).toBe('polite');
  });
});

describe('Modal500 name', () => {
  // A room's settings on a phone: the menu with the room's name, or a page in its place.
  const settings = (menu: boolean) => (
    <ScreenSizeProvider value={ScreenSize.Mobile}>
      <Modal500 requestClose={vi.fn()}>
        {menu && <h2>Lobby</h2>}
        <span data-page-title="">MindRoom</span>
        <h3 data-settings-heading="">Agents</h3>
      </Modal500>
    </ScreenSizeProvider>
  );

  it('is the page title where no heading of the dialog shows, never a settings card heading', async () => {
    const { rerender } = render(settings(false));
    expect(screen.getByRole('dialog', { name: 'MindRoom' })).toBeTruthy();

    rerender(settings(true));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Lobby' })).toBeTruthy());
    rerender(settings(false));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'MindRoom' })).toBeTruthy());
  });
});

describe('Modal500 on phones', () => {
  it('keeps a margin around the dialog unless asked to fill the screen', () => {
    const { dialog, center } = open(ScreenSize.Mobile);
    expect(center.className).toContain('center-phone-inset');
    expect(center.className).not.toContain('center-phone-fill');
    expect(dialog.className).toContain('glass-dense-over-backdrop');
    expect(dialog.className).not.toContain('modal-phone-fill');
  });

  it('fills the screen with fillPhoneScreen', () => {
    const { dialog, center } = open(ScreenSize.Mobile, true);
    expect(center.className).toContain('center-phone-fill');
    expect(dialog.className).toContain('modal-phone-fill');
  });

  it('floats centered on larger screens either way', () => {
    for (const fill of [false, true]) {
      const { dialog, center } = open(ScreenSize.Desktop, fill);
      expect(center.className).toContain('center-safe');
      expect(dialog.className).not.toContain('modal-phone-fill');
      expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
      cleanup();
    }
  });
});
