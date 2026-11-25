import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  useCallback,
  useId,
  useLayoutEffect,
  useState,
} from 'react';
import { FocusTrap } from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Icon,
  IconButton,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
  Tooltip,
  type IconSrc,
} from 'folds';
import { useResizeObserver } from '../lib/hooks/useResizeObserver';
import { localDigits } from '../lib/localDigits';
import { DialogCloseButton } from './DialogChrome';
import { TooltipProvider } from './directional';
import { Header, Modal } from './glass/GlassPrimitives';
import { PageScroll } from './page/PageScroll';
import { headerDismissTrap } from './useHeaderPopup';
import * as css from './RoomDialogOverlay.css';

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

/** Shared room-header modal frame with icon, title, optional count badge, close button, and body. */
export function RoomDialogFrame({
  icon,
  title,
  count,
  closeLabel,
  onClose,
  modalRef,
  closeButtonRef,
  ref,
  children,
}: {
  icon: IconSrc;
  title: string;
  count?: number;
  closeLabel: string;
  onClose: () => void;
  modalRef?: RefObject<HTMLDivElement | null>;
  closeButtonRef?: Ref<HTMLButtonElement>;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  const { i18n } = useTranslation();
  const titleId = useId();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const setModalRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (modalRef) modalRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [modalRef, ref]
  );

  return (
    <Modal
      ref={setModalRef}
      size="400"
      flexHeight
      className={css.Dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <PageScroll
        header={
          <Header size="500" className={css.Header}>
            <Box grow="Yes" alignItems="Center" gap="200">
              <Icon size="200" src={icon} />
              <Text as="h2" id={titleId} size="H4">
                {title}
              </Text>
              {count !== undefined && (
                <span className={css.HeaderCount}>{localDigits(String(count), locale)}</span>
              )}
            </Box>
            <DialogCloseButton ref={closeButtonRef} label={closeLabel} onClick={onClose} />
          </Header>
        }
      >
        <Box direction="Column" gap="300" className={css.Content}>
          {children}
        </Box>
      </PageScroll>
    </Modal>
  );
}

/** Centered empty, loading, or error block inside a RoomDialogFrame. */
export function RoomDialogEmpty({
  title,
  hint,
  role,
  children,
  ...props
}: {
  title?: string;
  hint?: string;
  role?: 'alert' | 'status';
  'aria-busy'?: boolean;
  children?: ReactNode;
}) {
  return (
    <Box direction="Column" gap="200" className={css.Empty} role={role} {...props}>
      {title && <Text size="T400">{title}</Text>}
      {hint && (
        <Text size="T300" priority="300">
          {hint}
        </Text>
      )}
      {children}
    </Box>
  );
}
