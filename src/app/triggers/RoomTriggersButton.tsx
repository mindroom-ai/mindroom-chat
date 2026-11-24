import type { MouseEvent, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, IconButton, Text, Tooltip } from 'folds';
import { TooltipProvider } from '../ui/directional';
import { MenuEntry } from '../ui/MenuEntry';
import { RoomDialogOverlay } from '../schedules/RoomDialogOverlay';
import * as schedCss from '../schedules/roomSchedules.css';
import { RoomTriggersDialog, type RoomTriggersDialogProps } from './RoomTriggersDialog';
import { TriggersIcon } from './TriggersIcon';

type RoomTriggersOverlayProps = Omit<RoomTriggersDialogProps, 'onClose'> & {
  headerRef?: RefObject<HTMLElement | null>;
  onClose: (dismissed?: boolean) => void;
};

/** The room's triggers dialog centered over the room view. */
export function RoomTriggersOverlay({
  headerRef,
  onClose,
  onOpenThread,
  ...dialogProps
}: RoomTriggersOverlayProps) {
  return (
    <RoomDialogOverlay headerRef={headerRef} onClose={onClose}>
      <RoomTriggersDialog
        {...dialogProps}
        onClose={() => onClose(true)}
        onOpenThread={(threadId, targetRoomId) => {
          onClose();
          onOpenThread(threadId, targetRoomId);
        }}
      />
    </RoomDialogOverlay>
  );
}

/** The room menu's entry for room triggers when overflowed into the menu. */
export function RoomTriggersMenuEntry({
  total,
  onSelect,
}: {
  total: number;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <MenuEntry
      icon={TriggersIcon}
      label={t('roomTriggers.openLabel', { total })}
      aria-haspopup="dialog"
      onSelect={onSelect}
    />
  );
}

/** Opens room triggers from the room header, with the room's trigger count. */
export function RoomTriggersButton({
  total,
  open,
  onOpen,
}: {
  total: number;
  open: boolean;
  onOpen: (opener: HTMLButtonElement) => void;
}) {
  const { t } = useTranslation();
  const label = t('roomTriggers.openLabel', { total });
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
          className={schedCss.Trigger}
          variant="Surface"
          fill="None"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={(event: MouseEvent<HTMLButtonElement>) => onOpen(event.currentTarget)}
        >
          <Icon size="400" src={TriggersIcon} />
          {total > 0 && (
            <span className={schedCss.Count} aria-hidden="true">
              {total}
            </span>
          )}
        </IconButton>
      )}
    </TooltipProvider>
  );
}
