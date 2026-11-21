import { type CSSProperties, useLayoutEffect, useMemo, useState } from 'react';
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
import type { ParsedScheduledTask } from '../matrix/protocol/scheduledTaskContract';
import { getPendingRoomSchedules, getRoomScheduleCount } from './roomSchedules';
import { RoomSchedulesDialog } from './RoomSchedulesDialog';
import * as css from './roomSchedules.css';

/** Pending tasks from the room's current state, shared by the header and its clock button. */
export function usePendingRoomSchedules(room: Room): ParsedScheduledTask[] {
  const events = useScheduledTaskEvents(room);
  return useMemo(() => getPendingRoomSchedules(events), [events]);
}

/** The horizontal center of the header in viewport pixels, following layout changes. */
function useCenterX(element: HTMLElement | null): number | undefined {
  const [centerX, setCenterX] = useState<number>();
  useLayoutEffect(() => {
    if (!element) return undefined;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setCenterX(rect.left + rect.width / 2);
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [element]);
  return element ? centerX : undefined;
}

type RoomSchedulesOverlayProps = {
  roomId: string;
  tasks: readonly ParsedScheduledTask[];
  openThreadId?: string;
  /** The room header spans the room view, which the list sits over. */
  roomHeader: HTMLElement | null;
  onClose: () => void;
  onOpenThread: (threadId: string) => void;
};

/** The room's pending scheduled tasks over the room view; it follows the room state while open. */
export function RoomSchedulesOverlay({
  roomId,
  tasks,
  openThreadId,
  roomHeader,
  onClose,
  onOpenThread,
}: RoomSchedulesOverlayProps) {
  const centerX = useCenterX(roomHeader);
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
            roomId={roomId}
            tasks={tasks}
            openThreadId={openThreadId}
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
export function RoomSchedulesMenuEntry({
  total,
  onSelect,
}: {
  total: number;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
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
  countThreadId?: string;
  open: boolean;
  onOpen: () => void;
};

/** Counts the room's pending tasks, or only this thread's when promoted inside a phone thread. */
export function RoomSchedulesButton({
  room,
  countThreadId,
  open,
  onOpen,
}: RoomSchedulesButtonProps) {
  const { t } = useTranslation();
  const tasks = usePendingRoomSchedules(room);
  const total = getRoomScheduleCount(tasks, countThreadId);
  const label = t('roomSchedules.openLabel', { total });

  const tooltip = (
    <Tooltip>
      <Text size="T300">{label}</Text>
    </Tooltip>
  );

  return (
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
          onClick={onOpen}
        >
          <Icon size="400" src={Icons.Clock} />
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
