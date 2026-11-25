import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { Room } from 'matrix-js-sdk';
import { Button, Icon, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { FailedSendActions } from '../FailedSendActions';
import { summarizeCanvasData, type CanvasSubmission } from './canvasMessages';
import { CANVAS_UNDO_DELAY_MS, type CanvasHost } from './useCanvasHost';
import * as css from './canvasHost.css';

const formatData = (data: unknown): string => JSON.stringify(data, null, 2) ?? 'null';

/** The answer the page offers, to undo/send or confirm, and what became of the last one sent. */
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
   * page's disclosure sits behind the header info tip instead of under every chart.
   */
  inline?: boolean;
}) {
  const { t } = useTranslation();
  const { staged, busy, lastAnswer, answer, footer, sendError } = host;
  const barRef = useRef<HTMLDivElement>(null);
  const [inspectingSubmission, setInspectingSubmission] = useState<CanvasSubmission>();
  const inspecting = !!staged && inspectingSubmission === staged.submission;
  const isCountdown = staged?.phase === 'countdown';
  const isUndoFlow = staged?.phase === 'countdown' || staged?.phase === 'paused';
  const chips = staged ? summarizeCanvasData(staged.submission.data) : [];
  const label = staged?.submission.label ?? t('mindroomUi.canvas.unlabeled');

  // Move focus onto the Undo bar only for verified countdowns so keyboard users can Tab to Undo
  // or press Escape immediately, and so stale iframe focus does not block the agent's next step.
  const countdownSubmission = isCountdown ? staged.submission : undefined;
  useEffect(() => {
    if (!countdownSubmission) return;
    barRef.current?.focus({ preventScroll: true });
  }, [countdownSubmission]);

  const handleToggleInspect = () => {
    if (!staged) return;
    if (inspecting) {
      setInspectingSubmission(undefined);
      return;
    }
    if (isCountdown) host.pause();
    setInspectingSubmission(staged.submission);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !isUndoFlow) return;
    event.preventDefault();
    event.stopPropagation();
    host.discard();
  };

  const stagedAnnouncement = staged
    ? isCountdown
      ? t('mindroomUi.canvas.sendingAnnouncement', { agent: agentName, label })
      : `${t('mindroomUi.canvas.sendTo', { agent: agentName })} ${label}`
    : '';

  return (
    <>
      <span
        className={css.SrOnly}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-canvas-staged-live
      >
        {stagedAnnouncement}
      </span>
      {staged && (
        <div
          ref={barRef}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          className={inline ? `${css.Staged} ${css.StickyAnswer}` : css.Staged}
          data-auto-send={isCountdown ? '' : undefined}
        >
          {isCountdown && !busy && (
            <div
              className={css.CountdownTrack}
              style={{ animationDuration: `${CANVAS_UNDO_DELAY_MS}ms` }}
              aria-hidden="true"
            />
          )}
          <div className={css.StagedRow}>
            <div className={css.StagedInfo}>
              <span className={css.StagedHeadline} data-canvas-staged-headline>
                <span className={css.StatusDot} aria-hidden="true" />
                <Text as="span" size="T300">
                  {t(isCountdown ? 'mindroomUi.canvas.sendingTo' : 'mindroomUi.canvas.sendTo', {
                    agent: agentName,
                  })}{' '}
                  <b>{label}</b>
                </Text>
              </span>
              {chips.length > 0 && (
                <span className={css.Chips} data-canvas-summary>
                  {chips.map((chip, index) => (
                    <span key={`${index}:${chip}`} className={css.Chip}>
                      {chip}
                    </span>
                  ))}
                </span>
              )}
            </div>
            <div className={css.StagedActions}>
              <Button
                size="300"
                variant="Secondary"
                fill={inspecting ? 'Soft' : 'None'}
                radii="300"
                aria-expanded={inspecting}
                onClick={handleToggleInspect}
                data-canvas-inspect
              >
                <Text size="B300">{t('mindroomUi.canvas.data')}</Text>
              </Button>
              <Button
                size="300"
                variant="Secondary"
                fill={isCountdown ? 'Soft' : 'None'}
                outlined={isCountdown}
                radii="300"
                onClick={host.discard}
                data-canvas-discard
              >
                <Text size="B300">
                  {t(isUndoFlow ? 'mindroomUi.canvas.undo' : 'mindroomUi.canvas.discard')}
                </Text>
              </Button>
              <Button
                size="300"
                variant={isCountdown ? 'Secondary' : 'Primary'}
                fill={isCountdown ? 'None' : 'Solid'}
                disabled={staged.phase === 'arming' || busy}
                onClick={host.send}
                data-canvas-send
                radii="300"
              >
                <Text size="B300">
                  {t(isUndoFlow ? 'mindroomUi.canvas.sendNow' : 'mindroomUi.canvas.send')}
                </Text>
              </Button>
            </div>
          </div>
          {staged.resubmitted && (
            <Text size="T200" priority="300">
              {t('mindroomUi.canvas.changeAnswer')}
            </Text>
          )}
          {inspecting && <pre className={css.Data}>{formatData(staged.submission.data)}</pre>}
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
        ) : footer === 'sent' && lastAnswer ? (
          <span className={css.SentLine}>
            <Icon size="50" src={Icons.Check} aria-hidden="true" className={css.SentIcon} />
            <Text as="span" size="T200" priority="300">
              {t('mindroomUi.canvas.sent', { agent: agentName, label: lastAnswer.label })}
            </Text>
          </span>
        ) : (
          <Text size="T200" priority="300" className={sendError ? css.Error : undefined}>
            {footer === 'refused' && t('mindroomUi.canvas.sendFailed')}
            {footer === 'sending' && t('mindroomUi.canvas.sending', { agent: agentName })}
            {!inline &&
              (footer === 'idle' || footer === 'cancelled') &&
              t('mindroomUi.canvas.disclosure', { agent: agentName })}
          </Text>
        )}
      </div>
    </>
  );
}
