import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text } from 'folds';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useRoomName } from '../matrix/hooks/useRoomMeta';
import { type PartLoadRetry, lazyPart } from '../lib/lazyPart';
import { revealDirectionControls } from '../ui/directional';
import { PartUnavailable } from '../ui/PartUnavailable';
import { callHomeRoomId, isActiveCallShownIn, useActiveCall, useCallActions } from './callStore';
import type { CallPanel } from './CallPanel';
import { CallViewChrome } from './CallViewChrome';
import { useCallWindowFrame } from './window/callWindowFrame';

/**
 * Without its chunk (offline when the panel is first needed) the call panel says so and offers
 * Retry. A call already on in this room gets End too, as the panel's own End did not load and Retry
 * may not reload. In the floating window it keeps the window's title bar (which moves it, with
 * Dock, Minimize and Close) and, minimized, the window's line with Expand and Close.
 */
export function CallPanelUnavailable({
  room,
  onClose,
  retryLoad,
}: ComponentProps<typeof CallPanel> & PartLoadRetry) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const { endCall } = useCallActions(mx);
  const active = useActiveCall();
  const callHere = isActiveCallShownIn(active, room.roomId);
  const frame = useCallWindowFrame();
  const title = revealDirectionControls(useRoomName(room));
  const unavailable = (
    <PartUnavailable retryLoad={retryLoad}>
      {callHere && (
        <Button
          type="button"
          size="300"
          radii="300"
          variant="Critical"
          fill="Soft"
          onClick={() => {
            // The call is over for this device either way; a failed leave leaves nothing to do.
            endCall().catch(() => undefined);
          }}
        >
          <Text size="B300">{t('featureUi.call.callControls.end')}</Text>
        </Button>
      )}
      <Button
        type="button"
        size="300"
        radii="300"
        variant="Secondary"
        fill="None"
        onClick={onClose}
      >
        <Text size="B300">{t('featureUi.calls.panel.dismiss')}</Text>
      </Button>
    </PartUnavailable>
  );
  if (!frame) return unavailable;
  // The call shown here docks where the loaded view's does: an agent call into the conversation it
  // started from.
  const home =
    callHere && active
      ? { roomId: callHomeRoomId(active), threadId: active.origin?.threadId }
      : { roomId: room.roomId };
  return (
    <CallViewChrome title={title} onClose={onClose} home={home}>
      {unavailable}
    </CallViewChrome>
  );
}

/**
 * The call panel, shared by the room's side panel and the floating window. Calls load on first
 * use, so rooms without one never load them; the chunk keeps the name of `./CallPanel`.
 */
export const CallPanelPart = lazyPart(
  () => import('./CallPanel').then((module) => ({ default: module.CallPanel })),
  CallPanelUnavailable
);
