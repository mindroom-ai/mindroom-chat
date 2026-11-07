import { Modal500 } from '../ui/Modal500';
import { RoomSettingsDialog } from '../ui/settings/frame.css';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useCloseSpaceSettings, useSpaceSettingsState } from '../navigation/useSpaceSettingsState';
import { RoomSettings } from '../rooms/settings/RoomSettings';

/**
 * Shows the settings dialog of the space that asked for it. A space is a room, so the dialog is
 * the room settings dialog without the offline part.
 */
export function SpaceSettingsRenderer() {
  const requested = useSpaceSettingsState();
  const close = useCloseSpaceSettings();
  const space = useMatrixClient().getRoom(requested?.roomId) ?? undefined;
  // Wider screens give the dialog the settings dialogs' 56 px title bars.
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  if (!requested || !space) return null;

  return (
    <Modal500
      requestClose={close}
      fillPhoneScreen
      className={phone ? undefined : RoomSettingsDialog}
    >
      <RoomSettings
        key={space.roomId}
        room={space}
        openOn={requested.page}
        space
        requestClose={close}
      />
    </Modal500>
  );
}
