// @vitest-environment jsdom
import type { HTMLAttributes, ReactNode } from 'react';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../../lib/hooks/useScreenSize';
import { PhoneModal, PhoneOverlayCenter } from '../../ui/Modal500.css';
import { ViewerOverlay } from './FileContent';
import { ImageOverlay } from './ImageOverlay';
import { useViewerFrame } from './viewerFrame';

vi.mock('focus-trap-react', () => ({
  FocusTrap: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock('../../ui/Modal500.css', () => ({
  PhoneModal: 'phone-modal',
  PhoneOverlayCenter: 'phone-center',
}));
vi.mock('../../ui/glass/GlassPrimitives', () => ({
  Modal: ({
    children,
    appearance,
    className,
    role,
    'aria-label': ariaLabel,
  }: HTMLAttributes<HTMLDivElement> & { appearance?: string }) => (
    <div role={role} aria-label={ariaLabel} className={className} data-appearance={appearance}>
      {children}
    </div>
  ),
}));
vi.mock('../viewers/ImageViewer', () => ({ ImageViewer: () => null }));

describe('useViewerFrame and viewer overlays', () => {
  beforeEach(() => {
    vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('returns plain modalAppearance on desktop and keeps PhoneModal on mobile', () => {
    const readFrame = (size: ScreenSize) =>
      renderHook(() => useViewerFrame(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <ScreenSizeProvider value={size}>{children}</ScreenSizeProvider>
        ),
      }).result.current;

    expect(readFrame(ScreenSize.Desktop)).toMatchObject({
      modalAppearance: 'plain',
      modalStyle: { width: '90vw', height: '90vh' },
    });
    const mobile = readFrame(ScreenSize.Mobile);
    expect(mobile).toEqual({
      centerClassName: PhoneOverlayCenter,
      modalClassName: PhoneModal,
    });
    expect(mobile.modalAppearance).toBeUndefined();
  });

  it.each([
    [
      'ImageOverlay',
      'Test image',
      () => <ImageOverlay src="blob:test" alt="Test image" requestClose={vi.fn()} />,
    ],
    [
      'ViewerOverlay',
      'notes.txt',
      () => (
        <ViewerOverlay label="notes.txt" onClose={vi.fn()}>
          <div />
        </ViewerOverlay>
      ),
    ],
  ])(
    '%s passes appearance="plain" on desktop and omits it with PhoneModal on mobile',
    (_name, label, renderOverlay) => {
      const mount = (size: ScreenSize) =>
        render(
          <Provider store={createStore()}>
            <ScreenSizeProvider value={size}>{renderOverlay()}</ScreenSizeProvider>
          </Provider>
        );

      mount(ScreenSize.Desktop);
      expect(screen.getByRole('dialog', { name: label }).getAttribute('data-appearance')).toBe(
        'plain'
      );
      cleanup();

      mount(ScreenSize.Mobile);
      const mobileModal = screen.getByRole('dialog', { name: label });
      expect(mobileModal.getAttribute('data-appearance')).toBeNull();
      expect(mobileModal.className).toContain(PhoneModal);
    }
  );
});
