import { useTranslation } from 'react-i18next';
import { Text } from 'folds';
import { IconClock } from '@tabler/icons-react';
import { revealDirectionControls } from '../ui/directional';
import * as css from './SnoozeEndedMarker.css';

type SnoozeEndedMarkerProps = {
  note?: string;
};

// A snooze ending is a quiet fact of the thread, not an agent's reply: one slim row.
export function SnoozeEndedMarker({ note }: SnoozeEndedMarkerProps) {
  const { t } = useTranslation();
  return (
    <div className={css.Marker} data-thread-snooze-ended="true">
      <IconClock size={14} aria-hidden />
      <Text as="span" size="T200" priority="300">
        {t('thread.snoozeEnded')}
        {note && (
          <>
            {': '}
            <span className={css.Note}>{revealDirectionControls(note)}</span>
          </>
        )}
      </Text>
    </div>
  );
}
