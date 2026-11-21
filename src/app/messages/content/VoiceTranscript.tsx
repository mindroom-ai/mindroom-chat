import type { ReactNode } from 'react';
import { Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { MessageTextBody } from '../layout/layout';
import { textDirection } from '../../ui/directional';
import { isTranscribingPlaceholder } from '../../matrix/protocol/transcribingPlaceholder';
import { voiceTranscriptHtml, voiceTranscriptText } from '../voiceTranscripts';
import { ShimmerText } from '../agent-run/ShimmerText';
import * as css from './VoiceTranscript.css';

/** The skeleton under a voice player while the transcript is still pending. */
export function VoiceTranscriptPending() {
  const { t } = useTranslation();
  const label = t('mindroomUi.messages.voiceTranscript.transcribing');
  return (
    <div className={css.Transcript} role="status" aria-label={label}>
      <span className={css.Lines} aria-hidden="true">
        <span className={css.Line} />
        <span className={css.Line} />
      </span>
      <Text as="span" size="T200" priority="300">
        <ShimmerText>{label}</ShimmerText>
      </Text>
    </div>
  );
}

/**
 * A voice message's transcript under its player: the echo's latest text and who transcribed it.
 * `renderBody` draws the echo's formatted body as a message body (mentions as pills); without it
 * the plain text shows.
 */
export function VoiceTranscript({
  content,
  senderName,
  renderBody,
}: {
  content: Record<string, unknown>;
  senderName: string;
  renderBody?: (props: { body: string; customBody?: string }) => ReactNode;
}) {
  const { t } = useTranslation();
  if (isTranscribingPlaceholder(content)) return <VoiceTranscriptPending />;
  const text = voiceTranscriptText(content);
  const html = voiceTranscriptHtml(content);
  return (
    <div className={css.Transcript}>
      <MessageTextBody preWrap={!(renderBody && html)} dir={textDirection(text) ?? 'auto'}>
        {renderBody ? renderBody({ body: text, customBody: html }) : text}
      </MessageTextBody>
      <Text as="span" size="T200" priority="300">
        {t('mindroomUi.messages.voiceTranscript.transcribedBy', { name: senderName })}
      </Text>
    </div>
  );
}
