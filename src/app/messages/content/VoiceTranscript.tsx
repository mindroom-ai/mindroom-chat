import { Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { MessageTextBody } from '../layout/layout';
import { textDirection } from '../../ui/directional';
import { isTranscribingPlaceholder } from '../../matrix/protocol/transcribingPlaceholder';
import { voiceTranscriptText } from '../voiceTranscripts';
import * as css from './VoiceTranscript.css';

/**
 * A voice message's transcript under its player: the router's echo (`content`, its latest
 * version) as the message's text with who transcribed it, or two shimmering lines while the
 * echo still says it is transcribing.
 */
export function VoiceTranscript({
  content,
  senderName,
}: {
  content: Record<string, unknown>;
  senderName: string;
}) {
  const { t } = useTranslation();
  if (isTranscribingPlaceholder(content)) {
    const label = t('mindroomUi.messages.voiceTranscript.transcribing');
    return (
      <div className={css.Transcript} role="status" aria-label={label}>
        <span className={css.Lines} aria-hidden="true">
          <span className={css.Line} />
          <span className={css.Line} />
        </span>
        <Text as="span" size="T200" priority="300" aria-hidden="true">
          {label}
        </Text>
      </div>
    );
  }
  const text = voiceTranscriptText(content);
  return (
    <div className={css.Transcript}>
      <MessageTextBody preWrap dir={textDirection(text) ?? 'auto'}>
        {text}
      </MessageTextBody>
      <Text as="span" size="T200" priority="300">
        {t('mindroomUi.messages.voiceTranscript.transcribedBy', { name: senderName })}
      </Text>
    </div>
  );
}
