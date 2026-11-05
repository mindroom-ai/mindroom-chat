import { useCallback, useRef, useState } from 'react';
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
import type { CommandPaletteTab } from './commandPaletteTypes';
import { useCommandPaletteHotkey } from './useCommandPaletteHotkey';
import { useCommandPaletteMessages } from './useCommandPaletteMessages';

const matchesPaletteShortcut = isKeyHotkey('mod+k');

// A sheet at the bottom on phones: as tall as most of the small viewport, so the on-screen
// keyboard and browser bars never push the search field out of reach. It keeps the rounded
// corners of the desktop palette on every side.
const MOBILE_SHEET_HEIGHT = 'min(85svh, 700px)';

const mobileSheetStyle = {
  borderRadius: config.radii.R400,
  height: MOBILE_SHEET_HEIGHT,
  maxHeight: MOBILE_SHEET_HEIGHT,
  maxWidth: '100vw',
  width: '100vw',
} as const;

// Pins the sheet to the bottom of the viewport.
const mobileSheetFrameStyle = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-end',
  alignItems: 'center',
  minHeight: '100svh',
  height: '100dvh',
} as const;

// On wider screens the palette hangs from a line near the top instead of the middle, so message
// hits that arrive later grow it downward and the rows already on screen stay where they are.
const desktopFrameStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  height: '100%',
  boxSizing: 'border-box',
  paddingBlockStart: 'min(12vh, 96px)',
  paddingBlockEnd: config.space.S400,
  paddingInline: config.space.S400,
} as const;

// The dialog fills its glass shell, so the results scroll inside the shell's corners.
const dialogStyle = {
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
  minHeight: 0,
} as const;

type PaletteDialogProps = {
  mobile: boolean;
  initialTab: CommandPaletteTab;
  requestClose: () => void;
  onLogout: () => void;
};

function PaletteDialog({ mobile, initialTab, requestClose, onLogout }: PaletteDialogProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const source = useCommandPaletteSource({ onLogout });
  const { overlayProps } = useOverlay(
    { isOpen: true, onClose: requestClose, isDismissable: true, isKeyboardDismissDisabled: false },
    ref
  );
  const { dialogProps } = useDialog({ 'aria-label': t('commandPalette.inputAria') }, ref);
  usePreventScroll();

  // The glass shell holds the dialog, so the dialog's parent carries the palette's corners.
  const shell = (
    <Modal size="500" flexHeight variant="Surface" style={mobile ? mobileSheetStyle : undefined}>
      <div ref={ref} style={dialogStyle} {...mergeProps(overlayProps, dialogProps)}>
        <CommandPalette
          requestClose={requestClose}
          source={source}
          useMessages={useCommandPaletteMessages}
          initialTab={initialTab}
          mobileSheet={mobile}
        />
      </div>
    </Modal>
  );

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <FocusScope contain restoreFocus autoFocus>
        <div style={mobile ? mobileSheetFrameStyle : desktopFrameStyle}>{shell}</div>
      </FocusScope>
    </Overlay>
  );
}

/**
 * The command palette, opened from anywhere with Mod+K or the sidebar's search button on All,
 * and from the sidebar's Message Search on Messages. Its query and tab live only while it is
 * open. Logging out from it asks for confirmation first.
 */
export function CommandPaletteRenderer() {
  const [openTab, setOpenTab] = useAtom(commandPaletteOpenAtom);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  const close = useCallback(() => setOpenTab(undefined), [setOpenTab]);
  const setOpen = useCallback(
    (nextOpen: boolean) => setOpenTab(nextOpen ? 'all' : undefined),
    [setOpenTab]
  );
  const closeLogout = useCallback(() => setLogoutOpen(false), []);

  useCommandPaletteHotkey(openTab !== undefined, setOpen, matchesPaletteShortcut);

  return (
    <>
      {openTab !== undefined && (
        <PaletteDialog
          mobile={mobile}
          initialTab={openTab}
          requestClose={close}
          onLogout={() => setLogoutOpen(true)}
        />
      )}
      {logoutOpen && (
        <Overlay open backdrop={<OverlayBackdrop />}>
          <OverlayCenter>
            {/* Escape or a click beside the confirmation cancels the logout. */}
            <FocusTrap
              focusTrapOptions={{
                clickOutsideDeactivates: true,
                onDeactivate: closeLogout,
              }}
            >
              <LogoutDialog handleClose={closeLogout} />
            </FocusTrap>
          </OverlayCenter>
        </Overlay>
      )}
    </>
  );
}
