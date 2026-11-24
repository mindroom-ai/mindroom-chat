import { type MouseEvent, type RefObject, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Icon, IconButton, Icons, Text, Tooltip } from 'folds';
import { TooltipProvider } from '../ui/directional';
import { MenuEntry } from '../ui/MenuEntry';
import { useScheduledTaskEvents } from './useScheduledTaskEvents';
import type { ParsedScheduledTask } from '../matrix/protocol/scheduledTaskContract';
import { getPendingRoomSchedules } from './roomSchedules';
import { RoomDialogOverlay } from './RoomDialogOverlay';
import { type EditScheduledTaskResult, RoomSchedulesDialog } from './RoomSchedulesDialog';
import * as css from './roomSchedules.css';

/** Pending tasks from the room's current state, shared by its header, menu and dialog. */
export function usePendingRoomSchedules(room: Room): ParsedScheduledTask[] {
  const events = useScheduledTaskEvents(room);
  return useMemo(() => getPendingRoomSchedules(events), [events]);
}

type RoomSchedulesOverlayProps = {
  roomId: string;
  tasks: readonly ParsedScheduledTask[];
  openThreadId?: string;
  /** The room header spans the room view, which the list sits over. */
  headerRef?: RefObject<HTMLElement | null>;
  onClose: (dismissed?: boolean) => void;
  onOpenThread: (threadId: string) => void;
  onCancelTask?: (task: ParsedScheduledTask) => Promise<void>;
  onEditTask?: (task: ParsedScheduledTask) => EditScheduledTaskResult;
};

/** The room's pending scheduled tasks over the room view; it follows the room state while open. */
export function RoomSchedulesOverlay({
  roomId,
  tasks,
  openThreadId,
  headerRef,
  onClose,
  onOpenThread,
  onCancelTask,
  onEditTask,
}: RoomSchedulesOverlayProps) {
  return (
    <RoomDialogOverlay headerRef={headerRef} onClose={onClose}>
      <RoomSchedulesDialog
        roomId={roomId}
        tasks={tasks}
        openThreadId={openThreadId}
        onClose={() => onClose(true)}
        onOpenThread={(threadId) => {
          onClose();
          onOpenThread(threadId);
        }}
        onCancelTask={onCancelTask}
        onEditTask={onEditTask}
      />
    </RoomDialogOverlay>
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
  total: number;
  open: boolean;
  onOpen: (opener: HTMLButtonElement) => void;
};

/** Opens pending schedules from the room header, with the count for the current scope. */
export function RoomSchedulesButton({ total, open, onOpen }: RoomSchedulesButtonProps) {
  const { t } = useTranslation();
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
          onClick={(event: MouseEvent<HTMLButtonElement>) => onOpen(event.currentTarget)}
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
