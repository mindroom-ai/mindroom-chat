import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { ClientEvent, type MatrixEvent } from 'matrix-js-sdk';
import { Button, Icon, Icons, Input, Text } from 'folds';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { getMemberDisplayName } from '../../matrix/room';
import {
  parseWorkflowAnswerRejection,
  sendWorkflowRunAnswer,
  type WorkflowRunQuestion,
} from '../../matrix/protocol/workflowRunContent';
import { ownDirectionBlock, ownDirectionLine } from '../../ui/directional';
import * as questionCss from '../question/QuestionCard.css';
import * as css from './WorkflowRunCard.css';

const ANSWER_TIMEOUT_MS = 15_000;

const REJECTION_KEYS = {
  already_answered: 'mindroomUi.workflowRun.question.rejected.alreadyAnswered',
  no_longer_open: 'mindroomUi.workflowRun.question.rejected.noLongerOpen',
  not_an_option: 'mindroomUi.workflowRun.question.rejected.notAnOption',
  not_for_you: 'mindroomUi.workflowRun.question.rejected.notForYou',
} as const;

type RejectionKey = (typeof REJECTION_KEYS)[keyof typeof REJECTION_KEYS];

const rejectionMessageKey = (reason: string): RejectionKey =>
  Object.prototype.hasOwnProperty.call(REJECTION_KEYS, reason)
    ? REJECTION_KEYS[reason as keyof typeof REJECTION_KEYS]
    : 'mindroomUi.workflowRun.question.rejected.noLongerOpen';

export type WorkflowQuestionCardProps = {
  question: WorkflowRunQuestion;
  roomId: string;
  threadId?: string | null;
  eventId?: string;
  readOnly?: boolean;
};

/**
 * Renders a workflow `ask_user` question notice card with option buttons and optional free-text
 * submission, guarded to the run's requester with rejection and timeout feedback.
 */
export function WorkflowQuestionCard({
  question,
  roomId,
  threadId = null,
  eventId,
  readOnly = false,
}: WorkflowQuestionCardProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const room = mx.getRoom(roomId);
  const viewerId = mx.getUserId();

  const [pending, setPending] = useState(false);
  const [sentEventId, setSentEventId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const isOpen = question.status === 'open';
  const isRequester =
    !readOnly &&
    !!room &&
    !!eventId &&
    question.requester !== null &&
    viewerId === question.requester;

  // Reset pending state when the card is edited to answered or cancelled.
  useEffect(() => {
    if (!isOpen) {
      setPending(false);
      setSentEventId(null);
      setFeedback(null);
    }
  }, [isOpen]);

  // Listen for an agent rejection event replying to our sent answer.
  useEffect(() => {
    if (!pending || !sentEventId) return undefined;
    const onEvent = (event: MatrixEvent) => {
      if (event.getRoomId() !== roomId) return;
      const rejection = parseWorkflowAnswerRejection(event, viewerId);
      if (!rejection || rejection.answerEventId !== sentEventId) return;
      const key = rejectionMessageKey(rejection.reason);
      setPending(false);
      setSentEventId(null);
      setFeedback(t(key));
    };
    mx.on(ClientEvent.Event, onEvent);
    return () => {
      mx.off(ClientEvent.Event, onEvent);
    };
  }, [mx, pending, roomId, sentEventId, t, viewerId]);

  // Re-enable controls if neither edit nor rejection arrives within 15 seconds.
  useEffect(() => {
    if (!pending) return undefined;
    const timer = window.setTimeout(() => {
      setPending(false);
      setSentEventId(null);
      setFeedback(t('mindroomUi.workflowRun.question.noReply'));
    }, ANSWER_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [pending, t]);

  const submitAnswer = async (answer: { option: string } | { text: string }) => {
    if (!room || !eventId || !isRequester || pending || !isOpen) return;
    setPending(true);
    setFeedback(null);
    try {
      const answerEventId = await sendWorkflowRunAnswer(
        mx,
        room,
        threadId,
        eventId,
        question,
        answer
      );
      setSentEventId(answerEventId);
    } catch {
      setPending(false);
      setSentEventId(null);
      setFeedback(t('activity.actions.failed'));
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    void submitAnswer({ text: trimmed });
  };

  const requesterName =
    question.requester && room
      ? getMemberDisplayName(room, question.requester) ?? question.requester
      : question.requester;

  const controlsDisabled = !isRequester || pending;

  return (
    <section
      className={questionCss.Card}
      aria-label={question.text}
      data-workflow-question-card={question.questionId}
      data-workflow-question-status={question.status}
    >
      <div className={questionCss.Top}>
        <span
          className={classNames(
            questionCss.Mark,
            question.status === 'answered'
              ? questionCss.MarkAnswered
              : isOpen && isRequester && questionCss.MarkWaiting
          )}
          aria-hidden
        >
          {question.status === 'answered' && <Icon size="50" src={Icons.Check} />}
        </span>
        <Text
          size="T400"
          className={classNames(
            questionCss.Question,
            question.status !== 'open' && questionCss.QuestionAnswered
          )}
          {...ownDirectionBlock}
        >
          {question.text}
        </Text>
      </div>

      {question.status === 'answered' && (
        <Text size="T300" className={css.QuestionClosed} {...ownDirectionLine}>
          {t('mindroomUi.workflowRun.question.answered', { answer: question.answer ?? '' })}
        </Text>
      )}

      {question.status === 'cancelled' && (
        <Text size="T300" className={css.QuestionClosed}>
          {t('mindroomUi.workflowRun.question.cancelled')}
        </Text>
      )}

      {isOpen && (
        <>
          {question.options.length > 0 && (
            <div className={questionCss.Options}>
              {question.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={questionCss.Option}
                  disabled={controlsDisabled}
                  onClick={() => void submitAnswer({ option })}
                >
                  <Text as="span" size="T400" className={questionCss.Label} {...ownDirectionLine}>
                    {option}
                  </Text>
                </button>
              ))}
            </div>
          )}

          {question.freeText && (
            <form className={css.FreeTextForm} onSubmit={handleSubmit}>
              <Input
                size="300"
                variant="Surface"
                className={css.FreeTextInput}
                value={draft}
                disabled={controlsDisabled}
                placeholder={t('mindroomUi.workflowRun.question.placeholder')}
                onChange={(event) => setDraft(event.currentTarget.value)}
              />
              <Button
                type="submit"
                size="300"
                variant="Primary"
                disabled={controlsDisabled || draft.trim().length === 0}
              >
                <Text size="B300">{t('mindroomUi.workflowRun.question.send')}</Text>
              </Button>
            </form>
          )}

          {!isRequester && !readOnly && requesterName && (
            <Text size="T200" className={css.QuestionNote}>
              {t('mindroomUi.workflowRun.question.onlyRequester', { name: requesterName })}
            </Text>
          )}
        </>
      )}

      <Text
        role={feedback ? 'alert' : 'status'}
        size="T200"
        className={feedback ? questionCss.Failed : css.LiveStatus}
      >
        {feedback ?? ''}
      </Text>
    </section>
  );
}
