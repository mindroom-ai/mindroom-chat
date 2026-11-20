import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import {
  Box,
  config,
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  PopOutContainerProvider,
  Text,
} from 'folds';
import { FocusScope, mergeProps, useDialog, useModalOverlay } from 'react-aria';
import { PageScroll } from './page/PageScroll';
import { Header, Modal } from './glass/GlassPrimitives';
import * as css from './BottomSheet.css';

type BottomSheetProps = {
  /** The sheet's title, which also names the dialog. */
  title: string;
  /** The close button's label. */
  closeLabel: string;
  requestClose: () => void;
  /** Only as tall as its content, up to the usual height. */
  fitContent?: boolean;
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
 * Menus its content opens (a chip's) open inside it, where taps and focus count as the sheet's.
 */
export function BottomSheet({
  title,
  closeLabel,
  requestClose,
  fitContent,
  children,
}: BottomSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [menus, setMenus] = useState<HTMLDivElement | null>(null);
  // Modal to assistive tech too: what is outside the sheet (and its menus) is hidden and inert.
  const { modalProps } = useModalOverlay(
    { isDismissable: true },
    // It reads only these two of an overlay's state.
    { isOpen: true, close: requestClose } as Parameters<typeof useModalOverlay>[1],
    dialogRef
  );
  // A menu the content opened takes Escape itself: its focus trap closes just the menu.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) =>
    menus?.hasChildNodes() || modalProps.onKeyDown?.(event);
  const { dialogProps } = useDialog({ 'aria-label': title }, dialogRef);

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <div
        ref={dialogRef}
        className={css.SheetContainer}
        {...mergeProps(dialogProps, { ...modalProps, onKeyDown })}
      >
        <FocusScope contain restoreFocus autoFocus>
          <Modal
            size="500"
            flexHeight
            variant="Background"
            style={fitContent ? { ...SHEET_STYLE, height: 'auto' } : SHEET_STYLE}
          >
            <div
              style={{ display: 'flex', flex: '1 1 auto', flexDirection: 'column', minHeight: 0 }}
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
                <div className={css.SheetBody}>
                  <PopOutContainerProvider value={menus ?? undefined}>
                    {children}
                  </PopOutContainerProvider>
                </div>
              </PageScroll>
            </div>
          </Modal>
          <div ref={setMenus} />
        </FocusScope>
      </div>
    </Overlay>
  );
}
