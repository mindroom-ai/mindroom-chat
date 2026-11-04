import { useEffect, useMemo, useState } from 'react';
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
import { TooltipProvider } from '../../components/directional';
import { useScheduledTaskEvents } from '../threads/useScheduledTaskEvents';
import { getPendingRoomSchedules } from './roomSchedules';
import { RoomSchedulesDialog } from './RoomSchedulesDialog';
import * as css from './roomSchedules.css';

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
            onClick={() => setOpenRoomId(room.roomId)}
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
        <Overlay open backdrop={<OverlayBackdrop />}>
          <OverlayCenter>
            <FocusTrap
              focusTrapOptions={{
                initialFocus: false,
                returnFocusOnDeactivate: true,
                clickOutsideDeactivates: true,
                onDeactivate: close,
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
                onClose={close}
                onOpenThread={(threadId) => {
                  close();
                  onOpenThread(threadId);
                }}
              />
            </FocusTrap>
          </OverlayCenter>
        </Overlay>
      )}
    </>
  );
}
