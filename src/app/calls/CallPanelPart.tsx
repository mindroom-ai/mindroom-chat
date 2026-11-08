import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text } from 'folds';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { type PartLoadRetry, lazyPart } from '../lib/lazyPart';
import { PartUnavailable } from '../ui/PartUnavailable';
import { isActiveCallShownIn, useActiveCall, useCallActions } from './callStore';
import type { CallPanel } from './CallPanel';

/**
 * Without its chunk (offline when the panel is first needed) the call panel says so and offers
 * Retry. A call already on in this room gets End too, as the panel's own End did not load and Retry
 * may not reload.
 */
export function CallPanelUnavailable({
  room,
  onClose,
  retryLoad,
}: ComponentProps<typeof CallPanel> & PartLoadRetry) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const { endCall } = useCallActions(mx);
  const callHere = isActiveCallShownIn(useActiveCall(), room.roomId);
  return (
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
}

/**
 * The call panel, shared by the room's side panel and the floating window. Calls load on first
 * use, so rooms without one never load them; the chunk keeps the name of `./CallPanel`.
 */
export const CallPanelPart = lazyPart(
  () => import('./CallPanel').then((module) => ({ default: module.CallPanel })),
  CallPanelUnavailable
);
