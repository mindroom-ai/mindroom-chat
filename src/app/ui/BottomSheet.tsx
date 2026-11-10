import { useRef, type CSSProperties, type ReactNode } from 'react';
import { Box, config, Icon, IconButton, Icons, Overlay, OverlayBackdrop, Text } from 'folds';
import { FocusScope, mergeProps, useDialog, useOverlay, usePreventScroll } from 'react-aria';
import { PageScroll } from './page/PageScroll';
import { Header, Modal } from './glass/GlassPrimitives';
import * as css from './BottomSheet.css';

type BottomSheetProps = {
  /** The sheet's title, which also names the dialog. */
  title: string;
  /** The close button's label. */
  closeLabel: string;
  requestClose: () => void;
  children: ReactNode;
};

const SHEET_HEIGHT = 'min(85svh, 700px)';
const SHEET_STYLE: CSSProperties = {
  borderStartStartRadius: config.radii.R400,
  borderStartEndRadius: config.radii.R400,
  borderEndStartRadius: 0,
  borderEndEndRadius: 0,
  height: SHEET_HEIGHT,
  maxHeight: SHEET_HEIGHT,
  maxWidth: '100vw',
  width: '100vw',
};

/**
 * A dialog that slides up from a phone's bottom edge, with its title over scrolling content. A
 * tap on the backdrop, Escape and the close button close it; the focus returns to its opener.
 */
export function BottomSheet({ title, closeLabel, requestClose, children }: BottomSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const { overlayProps } = useOverlay(
    { isOpen: true, isDismissable: true, onClose: requestClose },
    dialogRef
  );
  const { dialogProps } = useDialog({ 'aria-label': title }, dialogRef);
  usePreventScroll();

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <div className={css.SheetContainer}>
        <FocusScope contain restoreFocus autoFocus>
          <Modal size="500" flexHeight variant="Background" style={SHEET_STYLE}>
            <div
              ref={dialogRef}
              style={{ display: 'flex', flex: '1 1 auto', flexDirection: 'column', minHeight: 0 }}
              {...mergeProps(overlayProps, dialogProps)}
            >
              <PageScroll
                header={
                  <Header size="500">
                    <Box grow="Yes">
                      <Text size="H4">{title}</Text>
                    </Box>
                    <IconButton
                      aria-label={closeLabel}
                      size="300"
                      radii="300"
                      onClick={requestClose}
                    >
                      <Icon src={Icons.Cross} />
                    </IconButton>
                  </Header>
                }
              >
                <div className={css.SheetBody}>{children}</div>
              </PageScroll>
            </div>
          </Modal>
        </FocusScope>
      </div>
    </Overlay>
  );
}
