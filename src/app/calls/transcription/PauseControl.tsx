import { useTranslation } from 'react-i18next';
import { useAtomValue, useSetAtom } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { Icons } from 'folds';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { CallControl } from '../CallControls';
import { liveTranscriptAtom, nameInCall, pausedByIn, pauseRequestAtom } from './transcriptionState';

/**
 * "Paused by Ann": who paused the room's call as MindRoom last said, or this person while Pause
 * pressed here waits for MindRoom's answer. None while it is not paused.
 */
export const usePausedBy = (room: Room): string | undefined => {
  const { t } = useTranslation();
  const ownUserId = useMatrixClient().getSafeUserId();
  const request = useAtomValue(pauseRequestAtom);
  const live = useAtomValue(liveTranscriptAtom);
  let userId = pausedByIn(live, room.roomId);
  if (request === false) userId = null;
  else if (request) userId ??= ownUserId;
  if (!userId) return undefined;
  return t('featureUi.calls.transcription.pausedBy', { name: nameInCall(room, live, userId) });
};

/**
 * Pause, a toggle: pauses or resumes transcription for everyone in the call. Paused, by anyone, it
 * is pressed, looks like the controls' warning and says who paused.
 */
export function PauseControl({ room, small }: { room: Room; small?: boolean }) {
  const { t } = useTranslation();
  const setRequest = useSetAtom(pauseRequestAtom);
  const pausedBy = usePausedBy(room);
  return (
    <CallControl
      label={t('featureUi.calls.transcription.pause')}
      description={pausedBy}
      icon={Icons.Pause}
      warning={!!pausedBy}
      pressed={!!pausedBy}
      small={small}
      onClick={() => setRequest(!pausedBy)}
    />
  );
}
