import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useState,
} from 'react';
import { FocusTrap } from 'focus-trap-react';
import {
  Icon,
  IconButton,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
  Tooltip,
  type IconSrc,
} from 'folds';
import { TooltipProvider } from '../ui/directional';
import { headerDismissTrap } from '../ui/useHeaderPopup';
import { useResizeObserver } from '../lib/hooks/useResizeObserver';
import * as css from './roomSchedules.css';

function useCenterX(headerRef?: RefObject<HTMLElement | null>): number | undefined {
  const [centerX, setCenterX] = useState<number>();
  const header = useCallback(() => headerRef?.current, [headerRef]);
  const measure = useCallback(() => {
    const rect = header()?.getBoundingClientRect();
    if (rect) setCenterX(rect.left + rect.width / 2);
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

/** Centers a room-header modal over the room view with backdrop and focus-trap dismissal. */
export function RoomDialogOverlay({
  headerRef,
  onClose,
  children,
}: {
  headerRef?: RefObject<HTMLElement | null>;
  onClose: (dismissed?: boolean) => void;
  children: ReactNode;
}) {
  const centerX = useCenterX(headerRef);
  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter
        style={
          centerX === undefined
            ? undefined
            : ({ [css.ROOM_VIEW_CENTER]: `${centerX}px` } as CSSProperties)
        }
      >
        <FocusTrap focusTrapOptions={headerDismissTrap(onClose)}>{children}</FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

/** A room-header icon button with a corner count badge that opens a room dialog. */
export function RoomHeaderCountButton({
  icon,
  label,
  total,
  open,
  onOpen,
}: {
  icon: IconSrc;
  label: string;
  total: number;
  open: boolean;
  onOpen: (opener: HTMLButtonElement) => void;
}) {
  return (
    <TooltipProvider
      position="Bottom"
      offset={4}
      tooltip={
        <Tooltip>
          <Text size="T300">{label}</Text>
        </Tooltip>
      }
    >
      {(triggerRef) => (
        <IconButton
          ref={triggerRef}
          className={css.Trigger}
          variant="Surface"
          fill="None"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={(event: MouseEvent<HTMLButtonElement>) => onOpen(event.currentTarget)}
        >
          <Icon size="400" src={icon} />
          {total > 0 && (
            <span className={css.Count} aria-hidden="true">
              {total}
            </span>
          )}
        </IconButton>
      )}
    </TooltipProvider>
  );
}
