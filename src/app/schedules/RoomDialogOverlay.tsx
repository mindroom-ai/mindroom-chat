import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useState,
} from 'react';
import { FocusTrap } from 'focus-trap-react';
import { Overlay, OverlayBackdrop, OverlayCenter } from 'folds';
import { headerDismissTrap } from '../ui/useHeaderPopup';
import { useResizeObserver } from '../lib/hooks/useResizeObserver';
import { ROOM_VIEW_CENTER } from './roomSchedules.css';

/** The horizontal center of the header in viewport pixels, following layout changes. */
function useCenterX(headerRef?: RefObject<HTMLElement | null>): number | undefined {
  const [centerX, setCenterX] = useState<number>();
  const header = useCallback(() => headerRef?.current, [headerRef]);
  const measure = useCallback(() => {
    const element = header();
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setCenterX(rect.left + rect.width / 2);
  }, [header]);
  useLayoutEffect(() => {
    if (!header()) return undefined;
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [header, measure]);
  useResizeObserver(measure, header);
  return centerX;
}

type RoomDialogOverlayProps = {
  /** The room header spans the room view, which the dialog sits over. */
  headerRef?: RefObject<HTMLElement | null>;
  onClose: (dismissed?: boolean) => void;
  children: ReactNode;
};

/** Centers a room-header modal over the room view with backdrop and focus-trap dismissal. */
export function RoomDialogOverlay({ headerRef, onClose, children }: RoomDialogOverlayProps) {
  const centerX = useCenterX(headerRef);
  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter
        style={
          centerX === undefined
            ? undefined
            : ({ [ROOM_VIEW_CENTER]: `${centerX}px` } as CSSProperties)
        }
      >
        <FocusTrap focusTrapOptions={headerDismissTrap(onClose)}>{children}</FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
