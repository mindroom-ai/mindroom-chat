import { Modal500 } from '../../ui/Modal500';
import { RoomSettingsDialog } from '../../ui/settings/frame.css';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useCloseRoomSettings, useRoomSettingsState } from '../../navigation/useRoomSettingsState';
import { RoomSettings } from './RoomSettings';

/**
 * Shows the settings dialog of the room or space that asked for it, while this client knows it.
 * Each request opens the dialog afresh on its page, even when it was open already.
 */
export function RoomSettingsRenderer() {
  const requested = useRoomSettingsState();
  const close = useCloseRoomSettings();
  const room = useMatrixClient().getRoom(requested?.roomId) ?? undefined;
  // Wider screens give the dialog the settings dialogs' 56 px title bars.
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  if (!requested || !room) return null;

  return (
    <Modal500
      requestClose={close}
      fillPhoneScreen
      className={phone ? undefined : RoomSettingsDialog}
    >
      <RoomSettings
        key={`${room.roomId} ${requested.request}`}
        room={room}
        openOn={requested.page}
        requestClose={close}
      />
    </Modal500>
  );
}
