import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Icon, IconButton, Icons, Text } from 'folds';
import { LiveTranscriptBody } from './LiveTranscriptBody';
import { PauseControl } from './PauseControl';
import { useLiveTranscript } from './useLiveTranscript';
import * as panelCss from '../CallPanel.css';
import * as css from './LiveTranscriptPanel.css';

/** The panel reads the live call this often while it shows a call this device is not in. */
const READ_MS = 2_000;

/**
 * The live transcript of the room's call, in the room's side panel: a line saying the call is
 * transcribed, who is in it, and what each person said under their name, with the gaps. Pause is
 * in its header while it shows this device's call.
 */
export function LiveTranscriptPanel({ room, onClose }: { room: Room; onClose: () => void }) {
  const { t } = useTranslation();
  const view = useLiveTranscript(room, READ_MS);
  const { state, ownCall } = view;
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
        <div className={css.HeaderActions}>
          {ownCall && state === 'live' && call && <PauseControl room={room} small />}
          <IconButton
            size="300"
            radii="300"
            variant="Surface"
            aria-label={t('featureUi.calls.transcription.close')}
            onClick={onClose}
          >
            <Icon size="200" src={Icons.Cross} />
          </IconButton>
        </div>
      </header>
      <LiveTranscriptBody room={room} view={view} className={panelCss.Body} />
    </section>
  );
}
