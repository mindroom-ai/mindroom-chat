import FocusTrap from 'focus-trap-react';
import { Modal, Overlay, OverlayBackdrop, OverlayCenter } from 'folds';
import { useAtom } from 'jotai';
import { isKeyHotkey } from 'is-hotkey';
import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FocusScope, mergeProps, useDialog, useOverlay, usePreventScroll } from 'react-aria';
import { LogoutDialog } from '../../components/LogoutDialog';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { stopPropagation } from '../../utils/keyboard';
import { CommandPalette } from './CommandPalette';
import { commandPaletteOpenAtom } from './commandPaletteState';
import { useCommandPaletteSource } from './commandPaletteItems';
import { useCommandPaletteHotkey } from './useCommandPaletteHotkey';

type RenderPaletteProps = {
  mobileSheet: boolean;
  requestClose: () => void;
  children: React.ReactNode;
};

const MOBILE_SHEET_HEIGHT = 'min(85svh, 700px)';
// CINNY-132: viewport units track the layout viewport, which iOS does not
// shrink for the keyboard. A bottom-docked sheet sized in `dvh`/`svh` docks
// below the visible window — behind the keyboard it just summoned by focusing
// its own search input. `--app-height` is the visible window; see src/index.css.
const MOBILE_SHEET_CONTAINER_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-end',
  minHeight: 'var(--app-height, 100svh)',
  height: 'var(--app-height, 100dvh)',
  width: '100vw',
};
const MOBILE_SHEET_STYLE: React.CSSProperties = {
  borderRadius: 'var(--radii-400) var(--radii-400) 0 0',
  height: MOBILE_SHEET_HEIGHT,
  maxHeight: MOBILE_SHEET_HEIGHT,
  maxWidth: '100vw',
  width: '100vw',
};
const DESKTOP_MODAL_STYLE: React.CSSProperties = {
  maxHeight: 'calc(var(--app-height, 100dvh) - 32px)',
};

function RenderPalette({ mobileSheet, requestClose, children }: RenderPaletteProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const { overlayProps } = useOverlay(
    {
      isOpen: true,
      isDismissable: true,
      onClose: requestClose,
    },
    dialogRef
  );
  const { dialogProps } = useDialog(
    {
      'aria-label': t('commandPalette.inputAria'),
    },
    dialogRef
  );

  usePreventScroll();

  const modal = (
    <FocusScope contain restoreFocus autoFocus>
      <Modal
        size="500"
        flexHeight
        variant="Background"
        style={mobileSheet ? MOBILE_SHEET_STYLE : DESKTOP_MODAL_STYLE}
      >
        <div
          ref={dialogRef}
          style={{ display: 'flex', flex: '1 1 auto', flexDirection: 'column', minHeight: 0 }}
          {...mergeProps(overlayProps, dialogProps)}
        >
          {children}
        </div>
      </Modal>
    </FocusScope>
  );

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      {mobileSheet ? (
        <div style={MOBILE_SHEET_CONTAINER_STYLE}>{modal}</div>
      ) : (
        <OverlayCenter>{modal}</OverlayCenter>
      )}
    </Overlay>
  );
}

type RenderLogoutDialogProps = {
  requestClose: () => void;
};

function RenderLogoutDialog({ requestClose }: RenderLogoutDialogProps) {
  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            onDeactivate: requestClose,
            clickOutsideDeactivates: true,
            escapeDeactivates: stopPropagation,
          }}
        >
          <LogoutDialog handleClose={requestClose} />
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

type OpenCommandPaletteProps = {
  requestClose: () => void;
  onLogout?: () => void;
};

function OpenCommandPalette({ requestClose, onLogout }: OpenCommandPaletteProps) {
  const source = useCommandPaletteSource({
    onLogout,
  });
  const screenSize = useScreenSizeContext();
  const mobileSheet = screenSize === ScreenSize.Mobile;

  return (
    <RenderPalette mobileSheet={mobileSheet} requestClose={requestClose}>
      <CommandPalette requestClose={requestClose} source={source} mobileSheet={mobileSheet} />
    </RenderPalette>
  );
}

export function CommandPaletteRenderer() {
  const [open, setOpen] = useAtom(commandPaletteOpenAtom);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const handleLogout = useCallback(() => setLogoutOpen(true), []);
  // Simple mode hides the palette's visible triggers (sidebar tab, room
  // header button) but deliberately keeps mod+k working as an unadvertised
  // power-user path, so the renderer and hotkey stay ungated.
  useCommandPaletteHotkey(
    open,
    setOpen,
    useCallback((event: KeyboardEvent) => isKeyHotkey('mod+k', event), [])
  );

  return (
    <>
      {open && (
        <OpenCommandPalette
          requestClose={() => setOpen(false)}
          onLogout={handleLogout}
        />
      )}
      {logoutOpen && <RenderLogoutDialog requestClose={() => setLogoutOpen(false)} />}
    </>
  );
}
