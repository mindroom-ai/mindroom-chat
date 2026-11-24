import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { ClientEvent, MatrixEventEvent, type MatrixEvent } from 'matrix-js-sdk';
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
const REJECTION_KEYS = new Map([
  ['already_answered', 'mindroomUi.workflowRun.question.rejected.alreadyAnswered'],
  ['no_longer_open', 'mindroomUi.workflowRun.question.rejected.noLongerOpen'],
  ['not_an_option', 'mindroomUi.workflowRun.question.rejected.notAnOption'],
  ['not_for_you', 'mindroomUi.workflowRun.question.rejected.notForYou'],
] as const);

export type WorkflowQuestionCardProps = {
  question: WorkflowRunQuestion;
  roomId: string;
  threadId?: string | null;
  eventId?: string;
  readOnly?: boolean;
};

/** Workflow `ask_user` question notice card with clear/encrypted rejection and timeout feedback. */
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
  const [sent, setSent] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const isOpen = question.status === 'open';
  const pending = isOpen && sent !== null;
  const isRequester =
    !readOnly &&
    !!room &&
    !!eventId &&
    question.requester !== null &&
    viewerId === question.requester;
  const fail = useCallback((message: string) => {
    setSent(null);
    setFeedback(message);
  }, []);

  useEffect(() => {
    if (!pending) return undefined;
    const timer = window.setTimeout(
      () => fail(t('mindroomUi.workflowRun.question.noReply')),
      ANSWER_TIMEOUT_MS
    );
    const onEvent = (event: MatrixEvent) => {
      if (!sent || sent === 'sending' || event.getRoomId() !== roomId) return;
      const rejection = parseWorkflowAnswerRejection(event, viewerId);
      if (rejection?.answerEventId === sent)
        fail(
          t(
            REJECTION_KEYS.get(rejection.reason as never) ??
              'mindroomUi.workflowRun.question.rejected.noLongerOpen'
          )
        );
    };
    mx.on(ClientEvent.Event, onEvent);
    mx.on(MatrixEventEvent.Decrypted, onEvent);
    return () => {
      window.clearTimeout(timer);
      mx.off(ClientEvent.Event, onEvent);
      mx.off(MatrixEventEvent.Decrypted, onEvent);
    };
  }, [fail, mx, pending, roomId, sent, t, viewerId]);

  const submitAnswer = async (answer: { option: string } | { text: string }) => {
    if (!room || !eventId || !isRequester || pending || !isOpen) return;
    setSent('sending');
    setFeedback(null);
    try {
      setSent(await sendWorkflowRunAnswer(mx, room, threadId, eventId, question, answer));
    } catch {
      fail(t('activity.actions.failed'));
    }
  };

  const requesterName =
    question.requester && room
      ? getMemberDisplayName(room, question.requester) ?? question.requester
      : question.requester;
  const disabled = !isRequester || pending;
  const shownFeedback = isOpen ? feedback : null;

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
          className={classNames(questionCss.Question, !isOpen && questionCss.QuestionAnswered)}
          {...ownDirectionBlock}
        >
          {question.text}
        </Text>
      </div>
      {!isOpen && (
        <Text size="T300" className={questionCss.Chosen} {...ownDirectionLine}>
          {question.status === 'answered'
            ? t('mindroomUi.workflowRun.question.answered', { answer: question.answer ?? '' })
            : t('mindroomUi.workflowRun.question.cancelled')}
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
                  disabled={disabled}
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
            <form
              className={css.Row}
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim()) void submitAnswer({ text: draft.trim() });
              }}
            >
              <Input
                size="300"
                variant="Surface"
                className={css.FreeTextInput}
                value={draft}
                disabled={disabled}
                placeholder={t('mindroomUi.workflowRun.question.placeholder')}
                onChange={(e) => setDraft(e.currentTarget.value)}
              />
              <Button
                type="submit"
                size="300"
                variant="Primary"
                disabled={disabled || !draft.trim()}
              >
                <Text size="B300">{t('mindroomUi.workflowRun.question.send')}</Text>
              </Button>
            </form>
          )}
          {!isRequester && !readOnly && requesterName && (
            <Text size="T200" priority="300">
              {t('mindroomUi.workflowRun.question.onlyRequester', { name: requesterName })}
            </Text>
          )}
        </>
      )}
      <Text
        role={shownFeedback ? 'alert' : 'status'}
        size="T200"
        className={shownFeedback ? questionCss.Failed : questionCss.VisuallyHidden}
      >
        {shownFeedback ?? ''}
      </Text>
    </section>
  );
}
