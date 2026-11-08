import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { Icons, Text } from 'folds';
import { getSenderName } from '../../matrix/room';
import { NameWithUserId } from '../../matrix/NameWithUserId';
import { CallControl } from '../CallControls';
import { callTranscriptionAtom } from './transcriptionState';
import { PauseControl, usePausedBy } from './PauseControl';
import { useTranscriptPanel } from './transcriptPanel';
import * as css from '../CallPanel.css';

/** How this device's call in `room` is transcribed; none in a call there that is not. */
const useRoomTranscription = (room: Room) => {
  const transcription = useAtomValue(callTranscriptionAtom);
  return transcription?.roomId === room.roomId ? transcription.status : undefined;
};

/** Pause and Transcript in the call's controls, while MindRoom transcribes the call. */
export function TranscriptionControls({ room }: { room: Room }) {
  const { t } = useTranslation();
  const panel = useTranscriptPanel(room.roomId);
  const status = useRoomTranscription(room);
  if (status !== 'transcribing') return null;
  return (
    <>
      <PauseControl room={room} />
      <CallControl
        label={t('featureUi.calls.transcription.liveTranscript')}
        icon={Icons.Message}
        onClick={panel.show}
      />
    </>
  );
}

/**
 * The controls' line about the transcript: who paused it, or that transcripts are unavailable
 * while MindRoom cannot be reached (the call goes on). There, empty, while the call is
 * transcribed, so screen readers hear what it says next.
 */
export function TranscriptionStatus({ room }: { room: Room }) {
  const { t } = useTranslation();
  const status = useRoomTranscription(room);
  const pausedBy = usePausedBy(room);
  if (status !== 'transcribing' && status !== 'unavailable') return null;
  return (
    <div className={css.ControlsStatus} role="status">
      {status === 'unavailable' && (
        <Text as="span" size="T200" priority="300">
          {t('featureUi.calls.transcription.unavailable')}
        </Text>
      )}
      {status === 'transcribing' && pausedBy && (
        <span className={css.ControlsPaused}>
          <NameWithUserId
            name={getSenderName(room, pausedBy)}
            userId={pausedBy}
            text={(name) => t('featureUi.calls.transcription.pausedBy', { name })}
            size="T200"
          />
        </span>
      )}
    </div>
  );
}
