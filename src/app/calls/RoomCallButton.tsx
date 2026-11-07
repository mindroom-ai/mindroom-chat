import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Badge, Icon, IconButton, Icons, Text, Tooltip } from 'folds';
import { TooltipProvider } from '../ui/directional';
import { preloadOnIntent } from '../lib/preloadOnIntent';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import {
  isActiveCallShownIn,
  loadCallPanel,
  useActiveCall,
  useCallPanel,
  useRoomCallMembers,
} from './callStore';
import { callUserIds } from './callMemberships';

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
 */
export function RoomCallButton({ room }: { room: Room }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const active = useActiveCall();
  const [open, setOpen] = useCallPanel(room.roomId);
  const people = callUserIds(useRoomCallMembers(mx, room)).length;
  const inCall = isActiveCallShownIn(active, room.roomId);

  let label = t('featureUi.calls.header.startCall');
  if (inCall) {
    label = open ? t('featureUi.calls.header.hideCall') : t('featureUi.calls.header.showCall');
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
          aria-expanded={open}
          data-room-call-button=""
          onClick={() => setOpen(!open)}
          {...preloadOnIntent(loadCallPanel)}
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
