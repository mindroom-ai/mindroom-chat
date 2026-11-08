import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Badge, Icon, IconButton, Icons, Text, Tooltip } from 'folds';
import { TooltipProvider } from '../ui/directional';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { isActiveCallShownIn, useActiveCall, useCallPanel, useRoomCallMembers } from './callStore';
import { callUserIds } from './callMemberships';
import { useCallWindowMinimized, useExpandCallWindow } from './window/callWindowState';

// On the button's top end corner, like the Members button's join requests.
const countBadgeStyle = {
  position: 'absolute',
  top: 0,
  insetInlineEnd: 0,
  pointerEvents: 'none',
} as const;

/**
 * The room header's call button. It opens the call panel: to start a call, to join the one
 * running in the room (with how many people are in it), or to show the call this device is in.
 * A floating window minimized to its bar on this room's call view is shown, not hidden.
 */
export function RoomCallButton({ room }: { room: Room }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const active = useActiveCall();
  const [open, setOpen] = useCallPanel(room.roomId);
  const people = callUserIds(useRoomCallMembers(mx, room)).length;
  const inCall = isActiveCallShownIn(active, room.roomId);
  const desktop = useScreenSizeContext() !== ScreenSize.Mobile;
  const minimized = useCallWindowMinimized() && desktop;
  const expand = useExpandCallWindow();
  const shown = open && !minimized;
  const toggle = () => {
    if (open && minimized) expand();
    else setOpen(!open);
  };

  let label = t('featureUi.calls.header.startCall');
  if (inCall) {
    label = shown ? t('featureUi.calls.header.hideCall') : t('featureUi.calls.header.showCall');
  } else if (people > 0) {
    label = t('featureUi.calls.header.joinCallCount', { count: people });
  }
  const live = inCall || people > 0;

  return (
    <TooltipProvider
      position="Bottom"
      offset={4}
      tooltip={
        <Tooltip>
          <Text size="T200">{label}</Text>
        </Tooltip>
      }
    >
      {(anchorRef) => (
        <IconButton
          ref={anchorRef}
          size="400"
          radii="300"
          variant={live ? 'Success' : 'Surface'}
          fill={live || open ? 'Soft' : 'None'}
          aria-label={label}
          aria-expanded={shown}
          data-room-call-button=""
          onClick={toggle}
          style={{ position: 'relative' }}
        >
          <Icon size="400" src={Icons.Phone} filled={inCall} />
          {!inCall && people > 0 && (
            <Badge
              style={countBadgeStyle}
              size="200"
              variant="Success"
              fill="Solid"
              radii="Pill"
              aria-hidden="true"
            >
              <Text size="L400">{people}</Text>
            </Badge>
          )}
        </IconButton>
      )}
    </TooltipProvider>
  );
}
