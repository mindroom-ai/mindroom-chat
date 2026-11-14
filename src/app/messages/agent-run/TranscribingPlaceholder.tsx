import { useTranslation } from 'react-i18next';
import * as css from './TranscribingPlaceholder.css';

export function TranscribingPlaceholder() {
  const { t } = useTranslation();
  return (
    <span
      className={css.Placeholder}
      role="status"
      aria-label={t(
        'mindroomUi.messages.mindroomTranscribingPlaceholder.routerAgentIsTranscribing'
      )}
    >
      <span className={css.Wave} aria-hidden="true">
        <span className={css.WaveBar} />
        <span className={css.WaveBar} />
        <span className={css.WaveBar} />
      </span>
      <span className={css.Text} aria-hidden="true">
        {t('mindroomUi.messages.mindroomTranscribingPlaceholder.routerAgentIsTranscribing')}
      </span>
    </span>
  );
}
