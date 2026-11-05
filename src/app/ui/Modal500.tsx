import { ComponentProps, ReactNode, useId, useLayoutEffect, useRef } from 'react';
import classNames from 'classnames';
import FocusTrap from 'focus-trap-react';
import { Overlay, OverlayBackdrop, OverlayCenter } from 'folds';
import { Modal } from './glass/GlassPrimitives';
import { glassOverBackdrop } from './styles/Glass.css';
import { stopPropagation } from '../lib/keyboard';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import * as css from './Modal500.css';

interface Modal500Props {
  /** Runs on Escape (outside a text field) and on a click outside the dialog. */
  requestClose: () => void;
  /**
   * On phones, fill the screen instead of floating inside a margin. Personal settings keep the
   * margin; the other large dialogs (room and space settings, the account switcher, creating a
   * room or space, "Seen by") fill the screen.
   */
  fillPhoneScreen?: boolean;
  children: ReactNode;
}

type TrapOptions = NonNullable<ComponentProps<typeof FocusTrap>['focusTrapOptions']>;

/** Focus stays in the dialog; any way of leaving it (Escape, outside click) means "close". */
const closingTrap = (onClose: () => void): TrapOptions => ({
  initialFocus: false,
  returnFocusOnDeactivate: true,
  clickOutsideDeactivates: true,
  escapeDeactivates: stopPropagation,
  onDeactivate: onClose,
});

/**
 * Names the dialog after the first heading inside it (the settings title, a room's name), which
 * changes as its pages do.
 */
const useNamedByHeading = () => {
  const ref = useRef<HTMLDivElement>(null);
  const fallbackId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    const heading = dialog?.querySelector?.<HTMLElement>('h1, h2, h3, [role="heading"]');
    if (!dialog || !heading) return;
    if (!heading.id) heading.id = `${fallbackId}-title`;
    dialog.setAttribute('aria-labelledby', heading.id);
  });
  return ref;
};

const centerClass = (phone: boolean, fillPhoneScreen: boolean): string => {
  if (!phone) return css.SafeOverlayCenter;
  return fillPhoneScreen ? css.PhoneOverlayCenter : css.PhoneInsetOverlayCenter;
};

/**
 * The large centered dialog that settings and the account switcher open in. On phones it keeps a
 * margin around it, or fills the screen with `fillPhoneScreen`. Keyboard focus is held inside
 * while it is open and goes back to where it was once it closes.
 */
export function Modal500({ requestClose, fillPhoneScreen = false, children }: Modal500Props) {
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const fullScreen = phone && fillPhoneScreen;
  const modalRef = useNamedByHeading();
  // The backdrop already dims the page, so the glass takes a lighter tint over it.
  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter className={centerClass(phone, fillPhoneScreen)}>
        <FocusTrap focusTrapOptions={closingTrap(requestClose)}>
          <Modal
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            variant="Background"
            size="500"
            className={classNames(glassOverBackdrop, fullScreen && css.PhoneModal)}
          >
            {children}
          </Modal>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
