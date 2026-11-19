import type { Room } from 'matrix-js-sdk';
import { Box, Button, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { FailedSendActions } from '../FailedSendActions';
import type { CanvasHost } from './useCanvasHost';
import * as css from './canvasHost.css';

const formatData = (data: unknown): string => JSON.stringify(data, null, 2) ?? 'null';

/** The answer the page offers, to send or discard, and what became of the last one sent. */
export function CanvasAnswerBar({
  host,
  room,
  agentName,
  shared,
  inline = false,
}: {
  host: CanvasHost;
  room: Room;
  agentName: string;
  /** The agent can read what the user does in the page, so the host says so. */
  shared: boolean;
  /**
   * In the thread, under the page: the answer stays in view while the page scrolls past, and the
   * page's disclosure shows only with an answer to send, not under every chart.
   */
  inline?: boolean;
}) {
  const { t } = useTranslation();
  const { staged, busy, lastAnswer, answer, footer, sendError } = host;
  return (
    <>
      {staged && (
        <div className={inline ? `${css.Staged} ${css.StickyAnswer}` : css.Staged}>
          <Text size="T300">
            {t('mindroomUi.canvas.sendTo', { agent: agentName })}{' '}
            <b>{staged.submission.label ?? t('mindroomUi.canvas.unlabeled')}</b>
          </Text>
          {staged.resubmitted && (
            <Text size="T200" priority="300">
              {t('mindroomUi.canvas.changeAnswer')}
            </Text>
          )}
          <details>
            <summary>
              <Text as="span" size="T200">
                {t('mindroomUi.canvas.data')}
              </Text>
            </summary>
            <pre className={css.Data}>{formatData(staged.submission.data)}</pre>
          </details>
          {inline && (
            <Text size="T200" priority="300">
              {t('mindroomUi.canvas.inlineDisclosure', { agent: agentName })}
            </Text>
          )}
          <Box gap="200">
            <Button
              size="300"
              variant="Primary"
              disabled={!staged.armed || busy}
              onClick={host.send}
              data-canvas-send
              fill="Soft"
              outlined
              radii="300"
            >
              <Text size="B300">{t('mindroomUi.canvas.send')}</Text>
            </Button>
            <Button
              size="300"
              variant="Secondary"
              fill="None"
              onClick={host.discard}
              data-canvas-discard
            >
              <Text size="B300">{t('mindroomUi.canvas.discard')}</Text>
            </Button>
          </Box>
        </div>
      )}
      {shared && (
        <Text size="T200" priority="300" data-canvas-shared>
          {t('mindroomUi.canvas.sharedNotice', { agent: agentName })}
        </Text>
      )}
      <div role="status" data-canvas-status>
        {answer === 'failed' && lastAnswer ? (
          <FailedSendActions
            room={room}
            event={lastAnswer.echo}
            message={t('mindroomUi.canvas.notSent', {
              agent: agentName,
              label: lastAnswer.label,
            })}
          />
        ) : (
          <Text size="T200" priority="300" className={sendError ? css.Error : undefined}>
            {footer === 'refused' && t('mindroomUi.canvas.sendFailed')}
            {footer === 'sending' && t('mindroomUi.canvas.sending', { agent: agentName })}
            {footer === 'sent' &&
              lastAnswer &&
              t('mindroomUi.canvas.sent', { agent: agentName, label: lastAnswer.label })}
            {!inline &&
              (footer === 'idle' || footer === 'cancelled') &&
              t('mindroomUi.canvas.disclosure', { agent: agentName })}
          </Text>
        )}
      </div>
    </>
  );
}
