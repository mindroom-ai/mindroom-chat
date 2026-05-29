import React, { ReactNode, useRef } from 'react';
import { Box, Header, Icon, IconButton, Icons, Modal, Overlay, OverlayBackdrop, Text } from 'folds';
import { FocusScope, mergeProps, useDialog, useOverlay, usePreventScroll } from 'react-aria';
import * as css from './FilterBarMobileSheet.css';

type FilterBarMobileSheetProps = {
  open: boolean;
  requestClose: () => void;
  children: ReactNode;
};

const MOBILE_SHEET_HEIGHT = 'min(85svh, 700px)';
const MOBILE_SHEET_STYLE: React.CSSProperties = {
  borderRadius: 'var(--radii-400) var(--radii-400) 0 0',
  height: MOBILE_SHEET_HEIGHT,
  maxHeight: MOBILE_SHEET_HEIGHT,
  maxWidth: '100vw',
  width: '100vw',
};

export function FilterBarMobileSheet({ open, requestClose, children }: FilterBarMobileSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const { overlayProps } = useOverlay(
    {
      isOpen: open,
      isDismissable: true,
      onClose: requestClose,
    },
    dialogRef
  );
  const { dialogProps } = useDialog({ 'aria-label': 'Thread filters' }, dialogRef);

  usePreventScroll({ isDisabled: !open });

  if (!open) return null;

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <div className={css.SheetContainer}>
        <FocusScope contain restoreFocus autoFocus>
          <Modal size="500" flexHeight variant="Background" style={MOBILE_SHEET_STYLE}>
            <div
              ref={dialogRef}
              style={{ display: 'flex', flex: '1 1 auto', flexDirection: 'column', minHeight: 0 }}
              {...mergeProps(overlayProps, dialogProps)}
            >
              <Header size="500">
                <Box grow="Yes">
                  <Text size="H4">Filters</Text>
                </Box>
                <IconButton
                  aria-label="Close thread filters"
                  size="300"
                  radii="300"
                  onClick={requestClose}
                >
                  <Icon src={Icons.Cross} />
                </IconButton>
              </Header>
              <div className={css.SheetBody}>{children}</div>
            </div>
          </Modal>
        </FocusScope>
      </div>
    </Overlay>
  );
}
