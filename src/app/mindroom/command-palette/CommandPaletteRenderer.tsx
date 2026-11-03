import React, { useCallback, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import { isKeyHotkey } from 'is-hotkey';
import { FocusScope, mergeProps, useDialog, useOverlay, usePreventScroll } from 'react-aria';
import { Overlay, OverlayBackdrop, OverlayCenter, config } from 'folds';
import { Modal } from '../../components/glass/GlassPrimitives';
import { LogoutDialog } from '../../components/LogoutDialog';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { CommandPalette } from './CommandPalette';
import { useCommandPaletteSource } from './commandPaletteItems';
import { commandPaletteOpenAtom } from './commandPaletteState';
import { useCommandPaletteHotkey } from './useCommandPaletteHotkey';

const matchesPaletteShortcut = isKeyHotkey('mod+k');

// A bottom sheet on phones: as tall as most of the small viewport, so the on-screen keyboard
// and browser bars never push the search field out of reach.
const MOBILE_SHEET_HEIGHT = 'min(85svh, 700px)';

type PaletteDialogProps = {
  mobile: boolean;
  requestClose: () => void;
  onLogout: () => void;
};

function PaletteDialog({ mobile, requestClose, onLogout }: PaletteDialogProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const source = useCommandPaletteSource({ onLogout });
  const { overlayProps } = useOverlay(
    { isOpen: true, onClose: requestClose, isDismissable: true, isKeyboardDismissDisabled: false },
    ref
  );
  const { dialogProps } = useDialog({ 'aria-label': t('commandPalette.inputAria') }, ref);
  usePreventScroll();

  const modal = (
    <Modal
      size="500"
      flexHeight
      variant="Surface"
      style={
        mobile
          ? {
              borderRadius: config.radii.R400,
              height: MOBILE_SHEET_HEIGHT,
              maxHeight: MOBILE_SHEET_HEIGHT,
              maxWidth: '100vw',
              width: '100vw',
            }
          : undefined
      }
    >
      <CommandPalette requestClose={requestClose} source={source} mobileSheet={mobile} />
    </Modal>
  );

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <FocusScope contain restoreFocus autoFocus>
        {mobile ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              alignItems: 'center',
              minHeight: '100svh',
              height: '100dvh',
            }}
          >
            <div ref={ref} {...mergeProps(overlayProps, dialogProps)}>
              {modal}
            </div>
          </div>
        ) : (
          <OverlayCenter>
            <div ref={ref} {...mergeProps(overlayProps, dialogProps)}>
              {modal}
            </div>
          </OverlayCenter>
        )}
      </FocusScope>
    </Overlay>
  );
}

/**
 * The command palette, opened from anywhere with Mod+K or the sidebar's search button. Its
 * query lives only while it is open. Logging out from it asks for confirmation first.
 */
export function CommandPaletteRenderer() {
  const [open, setOpen] = useAtom(commandPaletteOpenAtom);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  const close = useCallback(() => setOpen(false), [setOpen]);

  useCommandPaletteHotkey(open, setOpen, matchesPaletteShortcut);

  return (
    <>
      {open && (
        <PaletteDialog mobile={mobile} requestClose={close} onLogout={() => setLogoutOpen(true)} />
      )}



















