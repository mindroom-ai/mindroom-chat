import { type RefObject, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Icons } from 'folds';
import { MenuEntry } from '../ui/MenuEntry';
import { useScheduledTaskEvents } from './useScheduledTaskEvents';
import type { ParsedScheduledTask } from '../matrix/protocol/scheduledTaskContract';
import { getPendingRoomSchedules } from './roomSchedules';
import { RoomDialogOverlay, RoomHeaderCountButton } from './RoomDialogOverlay';
import { type EditScheduledTaskResult, RoomSchedulesDialog } from './RoomSchedulesDialog';

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

/** Opens pending schedules from the room header, with the count for the current scope. */
export function RoomSchedulesButton(props: {
  total: number;
  open: boolean;
  onOpen: (opener: HTMLButtonElement) => void;
}) {
  const { t } = useTranslation();
  return (
    <RoomHeaderCountButton
      {...props}
      icon={Icons.Clock}
      label={t('roomSchedules.openLabel', { total: props.total })}
    />
  );
}
