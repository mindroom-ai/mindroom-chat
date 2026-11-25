import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Text } from 'folds';
import { PanelHeaderControls } from '../../ui/panels/PanelFrame';
import { useActiveCall } from '../callStore';
import { LiveTranscriptBody } from './LiveTranscriptBody';
import { PauseControl } from './PauseControl';
import { useLiveTranscript } from './useLiveTranscript';
import * as panelCss from '../CallPanel.css';

/** The panel reads the live call this often while it shows a call this device is not in. */
const READ_MS = 2_000;

/**
 * The live transcript of the room's call, in the room's side panel: a line saying the call is
 * transcribed, who is in it, and what each person said under their name, with the gaps. In the
 * conversation an agent call started from, where its call panel shows, it is that call's. Pause is
 * in its header while it shows this device's call with people.
 */
export function LiveTranscriptPanel({ room, onClose }: { room: Room; onClose: () => void }) {
  const { t } = useTranslation();
  const active = useActiveCall();
  const callRoom = active?.origin?.roomId === room.roomId ? active.call.room : room;
  const view = useLiveTranscript(callRoom, READ_MS);
  const { state } = view;
  const pausable = view.ownCall && active?.kind !== 'agent';
  const call = view.live?.call;
  const title = t('featureUi.calls.transcription.liveTranscript');

  return (
    <section className={panelCss.Panel} aria-label={title} data-testid="live-transcript-panel">
      <header className={panelCss.Header}>
        <div className={panelCss.HeaderTitle}>
          <Text as="h2" size="H4" truncate>
            {title}
          </Text>
          {call && (
            <Text size="T200" priority="300" truncate>
              {t('featureUi.calls.panel.inCall', { count: call.members.length })}
            </Text>
          )}
        </div>
        <PanelHeaderControls
          onClose={onClose}
          closeLabel={t('featureUi.calls.transcription.close')}
        >
          {pausable && state === 'live' && call && <PauseControl room={room} small />}
        </PanelHeaderControls>
      </header>
      <LiveTranscriptBody room={callRoom} view={view} className={panelCss.Body} />
    </section>
  );
}
