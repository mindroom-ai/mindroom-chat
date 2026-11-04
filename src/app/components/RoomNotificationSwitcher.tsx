import React, { type MouseEvent, type ReactNode, useState } from 'react';
import { PopOut, type RectCords } from 'folds';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { useAlive } from '../hooks/useAlive';
import {
  RoomNotificationMode,
  setRoomNotificationPreference,
} from '../hooks/useRoomsNotificationPreferences';
import { ChoiceMenu } from './ChoiceMenu';

/** The modes in the order the menu lists them, each with its label key. */
const MODE_CHOICES = [
  [RoomNotificationMode.Unset, 'sharedUi.roomNotificationSwitcher.option0'],
  [RoomNotificationMode.AllMessages, 'sharedUi.roomNotificationSwitcher.option1'],
  [RoomNotificationMode.SpecialMessages, 'sharedUi.roomNotificationSwitcher.option2'],
  [RoomNotificationMode.Mute, 'sharedUi.roomNotificationSwitcher.option3'],
] as const;

/** Opens the mode menu beside the control that was clicked. */
type OpenModeMenu = (click?: MouseEvent<HTMLElement>) => void;

/** Draws the control; `storing` is true while the server takes a newly picked mode. */
type ModeControl = (openMenu: OpenModeMenu, menuShown: boolean, storing: boolean) => ReactNode;

type RoomNotificationModeSwitcherProps = {
  roomId: string;
  /** The room's current mode, from the account's push rules. */
  value: RoomNotificationMode;
  children: ModeControl;
  /** Called once a mode is picked, before the server has stored it. */
  onChange?: (mode: RoomNotificationMode) => void;
  /** The side of the control the menu opens on; menus at the window's right edge open left. */
  side?: 'Left' | 'Right';
};

/**
 * Picks how a room notifies: the account default, every message, only mentions and keywords, or
 * never. The menu opens beside the control and shows the current mode checked.
 */
export function RoomNotificationModeSwitcher({
  roomId,
  value,
  children,
  onChange,
  side = 'Left',
}: RoomNotificationModeSwitcherProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const [anchor, setAnchor] = useState<RectCords>();
  // The mode being stored; the menu shows it as current until the push rules catch up.
  const [pending, setPending] = useState<RoomNotificationMode>();

  const openMenu: OpenModeMenu = (click) => {
    const rect = click?.currentTarget.getBoundingClientRect();
    setAnchor(rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined);
  };
  const close = () => setAnchor(undefined);

  const choose = (index: number) => {
    const [next] = MODE_CHOICES[index];
    close();
    if (next === value) return;
    onChange?.(next);
    setPending(next);
    setRoomNotificationPreference(client, roomId, next, value)
      .catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[notifications] could not change the room notification mode', error);
      })
      .finally(() => {
        if (alive()) setPending(undefined);
      });
  };

  const shown = pending ?? value;
  const current = MODE_CHOICES.findIndex(([mode]) => mode === shown);

  return (
    <PopOut
      anchor={anchor}
      position={side}
      align="Start"
      offset={4}
      content={
        <ChoiceMenu
          label={t('featureUi.roomNav.roomNavItem.notifications')}
          choices={MODE_CHOICES.map(([, key]) => ({ name: t(key) }))}
          current={current}
          onChoose={choose}
          onDismiss={close}
        />
      }
    >
      {children(openMenu, anchor !== undefined, pending !== undefined)}
    </PopOut>
  );
}
