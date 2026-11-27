import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { usePauseAnimationWhenHidden } from '../../lib/hooks/usePauseWhenHidden';
import * as css from './StreamingIndicator.css';

export function StreamingIndicator() {
  const { t } = useTranslation();
  const ref = useRef<HTMLSpanElement>(null);
  usePauseAnimationWhenHidden(ref);
  return (
    <span
      ref={ref}
      className={css.Container}
      role="status"
      aria-label={t('mindroomUi.messages.streamingIndicator.aiIsResponding')}
    >
      <span className={css.Dot0} aria-hidden="true" />
      <span className={css.Dot1} aria-hidden="true" />
      <span className={css.Dot2} aria-hidden="true" />
    </span>
  );
}

export const renderStreamingIndicator = () => <StreamingIndicator />;
