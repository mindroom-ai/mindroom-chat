import { type CSSProperties, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, color } from 'folds';
import { describeKnownError } from '../lib/describeError';
import { ErrorDetail } from '../ui/ErrorDetail';

/**
 * Why a join failed, in a sentence and the server's own words, near the Join that asked; an alert,
 * so a screen reader says it too.
 */
export function JoinFailure({
  error,
  className,
  style,
}: {
  error: unknown;
  className?: string;
  style?: CSSProperties;
}) {
  const { t } = useTranslation();
  return (
    <Text
      role="alert"
      size="T200"
      className={className}
      style={{ color: color.Critical.Main, ...style }}
    >
      {describeKnownError(t, error) ?? t('sharedUi.roomCard.failedToJoinUnknownError')}
      <ErrorDetail error={error} />
    </Text>
  );
}

/**
 * Hands a join's failure to the card that shows it elsewhere than beside its button, and takes it
 * back (`undefined`) when the next try starts or the button goes.
 */
export function ReportJoinFailure({
  error,
  onChange,
}: {
  error: unknown;
  onChange: (error: unknown) => void;
}) {
  useEffect(() => {
    onChange(error);
  }, [error, onChange]);
  useEffect(() => () => onChange(undefined), [onChange]);
  return null;
}
