import { Modal500 } from '../../ui/Modal500';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useCloseRoomSettings, useRoomSettingsState } from '../../navigation/useRoomSettingsState';
import { RoomSettings } from './RoomSettings';

/** Shows the room settings dialog while a room asked for it and this client knows the room. */
export function RoomSettingsRenderer() {
  const requested = useRoomSettingsState();
  const close = useCloseRoomSettings();
  const room = useMatrixClient().getRoom(requested?.roomId) ?? undefined;
  if (!requested || !room) return null;

  return (
    <Modal500 requestClose={close} fillPhoneScreen>
      <RoomSettings key={room.roomId} room={room} openOn={requested.page} requestClose={close} />
    </Modal500>
  );
}
