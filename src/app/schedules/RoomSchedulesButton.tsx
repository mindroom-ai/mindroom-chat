import {
  type CSSProperties,
  type MouseEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import type { Room } from 'matrix-js-sdk';
import {
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
  Tooltip,
} from 'folds';
import { TooltipProvider } from '../ui/directional';
import { MenuEntry } from '../ui/MenuEntry';
import { useScheduledTaskEvents } from './useScheduledTaskEvents';
import { getPendingRoomSchedules } from './roomSchedules';
import { RoomSchedulesDialog } from './RoomSchedulesDialog';
import * as css from './roomSchedules.css';

/** The horizontal center of `element` in viewport pixels while `active`, following layout changes. */
function useCenterX(element: Element | null, active: boolean): number | undefined {
  const [centerX, setCenterX] = useState<number>();
  useLayoutEffect(() => {
    if (!active || !element) return undefined;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setCenterX(rect.left + rect.width / 2);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [active, element]);
  return active ? centerX : undefined;
}

type RoomSchedulesOverlayProps = {
  room: Room;
  /** The room view's horizontal center in viewport pixels, which the list sits over. */
  centerX?: number;
  onClose: () => void;
  onOpenThread: (threadId: string) => void;
};

/** The room's pending scheduled tasks over the room view; it follows the room state while open. */
export function RoomSchedulesOverlay({
  room,
  centerX,
  onClose,
  onOpenThread,
}: RoomSchedulesOverlayProps) {
  const events = useScheduledTaskEvents(room);
  const tasks = useMemo(() => getPendingRoomSchedules(events), [events]);
  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter
        style={
          centerX === undefined
            ? undefined
            : ({ [css.ROOM_VIEW_CENTER]: `${centerX}px` } as CSSProperties)
        }
      >
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            returnFocusOnDeactivate: true,
            clickOutsideDeactivates: true,
            onDeactivate: onClose,
            // Escape closes the list only; the room's own Escape (mark as read) must not see it.
            escapeDeactivates: (event: KeyboardEvent) => {
              event.stopPropagation();
              return true;
            },
          }}
        >
          <RoomSchedulesDialog
            roomId={room.roomId}
            tasks={tasks}
            onClose={onClose}
            onOpenThread={(threadId) => {
              onClose();
              onOpenThread(threadId);
            }}
          />
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

/** The room menu's entry for the scheduled tasks, with their count, on phones. */
export function RoomSchedulesMenuEntry({ room, onSelect }: { room: Room; onSelect: () => void }) {
  const { t } = useTranslation();
  const events = useScheduledTaskEvents(room);
  const total = useMemo(() => getPendingRoomSchedules(events), [events]).length;
  return (
    <MenuEntry
      icon={Icons.Clock}
      label={t('roomSchedules.openLabel', { total })}
      aria-haspopup="dialog"
      onSelect={onSelect}
    />
  );
}

type RoomSchedulesButtonProps = {
  room: Room;
  onOpenThread: (threadId: string) => void;
};

/**
 * The room header's scheduled-tasks button. It counts the room's pending tasks and opens their
 * list, which follows the room state while it is open.
 */
export function RoomSchedulesButton({ room, onOpenThread }: RoomSchedulesButtonProps) {
  const { t } = useTranslation();
  const events = useScheduledTaskEvents(room);
  const tasks = useMemo(() => getPendingRoomSchedules(events), [events]);
  const [openRoomId, setOpenRoomId] = useState<string>();
  // The list is for one room: switching rooms closes it rather than showing another room's tasks.
  const open = openRoomId === room.roomId;
  // The room header spans the room view, which the list sits over.
  const [roomHeader, setRoomHeader] = useState<Element | null>(null);
  const roomViewCenter = useCenterX(roomHeader, open);

  useEffect(() => {
    if (openRoomId !== undefined && openRoomId !== room.roomId) setOpenRoomId(undefined);
  }, [openRoomId, room.roomId]);

  const label = t('roomSchedules.openLabel', { total: tasks.length });
  const close = () => setOpenRoomId(undefined);

  const tooltip = (
    <Tooltip>
      <Text size="T300">{label}</Text>
    </Tooltip>
  );

  return (
    <>
      <TooltipProvider position="Bottom" offset={4} tooltip={tooltip}>
        {(triggerRef) => (
          <IconButton
            ref={triggerRef}
            className={css.Trigger}
            variant="Surface"
            fill="None"
            aria-label={label}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={(event: MouseEvent<HTMLButtonElement>) => {
              setRoomHeader(event.currentTarget.closest('header'));
              setOpenRoomId(room.roomId);
            }}
          >
            <Icon size="400" src={Icons.Clock} />
            {tasks.length > 0 && (
              <span className={css.Count} aria-hidden="true">
                {tasks.length}
              </span>
            )}
          </IconButton>
        )}
      </TooltipProvider>
      {open && (
        <RoomSchedulesOverlay
          room={room}
          centerX={roomViewCenter}
          onClose={close}
          onOpenThread={onOpenThread}
        />
      )}
    </>
  );
}
