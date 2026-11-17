import { useEffect, useReducer, useState } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { Icon, Icons, Text, color } from 'folds';
import { MatrixEventEvent, type MatrixEvent } from 'matrix-js-sdk';
import { RelationsEvent } from 'matrix-js-sdk/lib/models/relations';
import { isConfirmedMatrixEventId } from '../../event-store/threads/threadRouteUtils';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { getEventReactions, getMemberDisplayName } from '../../matrix/room';
import { isMindroomAgentUserIdForViewer } from '../../matrix/protocol/agentIdentity';
import {
  readQuestionAnswer,
  type InteractiveQuestion,
} from '../../matrix/protocol/interactiveQuestion';
import { ownDirectionLine } from '../../ui/directional';
import { answerQuestion } from '../reactions/answerQuestion';
import * as css from './QuestionCard.css';

type QuestionCardProps = {
  question: InteractiveQuestion;
  /** The agent's message that asks it, whose reactions answer it. */
  mEvent: MatrixEvent;
  roomId: string | undefined;
  threadId: string | undefined;
  /** Shown in another thread's view (a fork's prefix): it answers nothing there. */
  readOnly?: boolean;
  /** Off when the reply's own text still shows the question, where the card adds only buttons. */
  showText: boolean;
};

/** The reactions on `mEvent`, read again whenever one is added, removed or redacted. */
const useReactions = (mEvent: MatrixEvent, roomId: string | undefined): MatrixEvent[] => {
  const mx = useMatrixClient();
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  const room = roomId ? mx.getRoom(roomId) : null;
  const eventId = mEvent.getId();
  const relations =
    room && eventId ? getEventReactions(room.getUnfilteredTimelineSet(), eventId) : undefined;
  useEffect(() => {
    // The first reaction creates the relations this card reads.
    mEvent.on(MatrixEventEvent.RelationsCreated, refresh);
    return () => {
      mEvent.removeListener(MatrixEventEvent.RelationsCreated, refresh);
    };
  }, [mEvent]);
  useEffect(() => {
    if (!relations) return undefined;
    relations.on(RelationsEvent.Add, refresh);
    relations.on(RelationsEvent.Remove, refresh);
    relations.on(RelationsEvent.Redaction, refresh);
    return () => {
      relations.removeListener(RelationsEvent.Add, refresh);
      relations.removeListener(RelationsEvent.Remove, refresh);
      relations.removeListener(RelationsEvent.Redaction, refresh);
    };
  }, [relations]);
  return relations?.getRelations() ?? [];
};

/**
 * An agent's question with a button per option. A click reacts with the option's emoji, as
 * MindRoom asks; the first person's answer marks its option and closes the question.
 */
export function QuestionCard({
  question,
  mEvent,
  roomId,
  threadId,
  readOnly = false,
  showText,
}: QuestionCardProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const viewerId = mx.getUserId() ?? undefined;
  const room = roomId ? mx.getRoom(roomId) : null;
  const eventId = mEvent.getId();
  const answer = readQuestionAnswer(useReactions(mEvent, roomId), question, viewerId);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const canAnswer =
    !readOnly &&
    !!room &&
    isConfirmedMatrixEventId(eventId) &&
    !isMindroomAgentUserIdForViewer(viewerId, viewerId);
  const answererName =
    answer && answer.senderId !== viewerId
      ? (room && getMemberDisplayName(room, answer.senderId)) ?? answer.senderId
      : undefined;

  const choose = (key: string) => {
    if (!room || !eventId) return;
    setPending(true);
    setFailed(false);
    answerQuestion(mx, room, threadId ?? mEvent.threadRootId, { ...question, eventId }, key)
      .catch(() => setFailed(true))
      .finally(() => setPending(false));
  };

  let status: string | undefined;
  if (answer) status = t('mindroomUi.messages.questionCard.answered');
  else if (canAnswer) status = t('mindroomUi.messages.questionCard.waiting');

  return (
    <section
      className={css.Card}
      aria-label={t('mindroomUi.messages.questionCard.title')}
      data-question-card={answer ? 'answered' : 'waiting'}
    >
      <div className={css.Header}>
        <Text as="span" size="T300" className={css.Kind}>
          {t('mindroomUi.messages.questionCard.title')}
        </Text>
        {status && (
          <span className={classNames(css.Status, !answer && css.StatusWaiting)}>{status}</span>
        )}
      </div>
      {showText && (
        <Text size="T400" className={css.Question} {...ownDirectionLine}>
          {question.text}
        </Text>
      )}
      <div className={css.Options}>
        {question.options.map((option) => {
          const chosen = answer?.key === option.key;
          return (
            <button
              key={option.key}
              type="button"
              className={classNames(
                css.Option,
                chosen && css.OptionChosen,
                answer && !chosen && css.OptionMuted
              )}
              aria-pressed={chosen}
              disabled={!canAnswer || !!answer || pending}
              onClick={() => choose(option.key)}
            >
              <span className={css.Emoji} aria-hidden>
                {option.key}
              </span>
              <Text as="span" size="T400" className={css.Label} {...ownDirectionLine}>
                {option.label}
              </Text>
              {chosen && (
                <span className={css.Chosen}>
                  <Icon size="50" src={Icons.Check} />
                  {answererName
                    ? t('mindroomUi.messages.questionCard.nameChose', { name: answererName })
                    : t('mindroomUi.messages.questionCard.youChose')}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {failed && (
        <Text role="alert" size="T200" style={{ color: color.Critical.Main }}>
          {t('activity.actions.failed')}
        </Text>
      )}
    </section>
  );
}
