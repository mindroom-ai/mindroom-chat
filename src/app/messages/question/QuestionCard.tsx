import { useEffect, useLayoutEffect, useReducer, useRef, useState, type RefObject } from 'react';
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
import { LONGEST_PLAY_MS, motionAllowed, playsMotion } from '../../ui/listMotion';
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

const FOLD_EASING = 'cubic-bezier(.2, .8, .2, 1)';

/**
 * True while the other options fold away under an answer that came while the card was shown:
 * the chosen one pulses once, the others dim and close in place, the card keeps its width.
 * The answered layout needs none of it; an answer already there when the card mounts, or one
 * where motion is not allowed (`motionAllowed`), shows it at once.
 */
const useFoldOnAnswer = (cardRef: RefObject<HTMLElement>, answered: boolean): boolean => {
  const [wasAnswered, setWasAnswered] = useState(answered);
  const [folding, setFolding] = useState(false);
  if (answered !== wasAnswered) {
    setWasAnswered(answered);
    setFolding(answered && motionAllowed());
  }
  // The card's width while it waits, which it keeps while the options fold.
  const openWidth = useRef<number>();
  useEffect(() => {
    const card = cardRef.current;
    if (answered || !card || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      openWidth.current = entry?.borderBoxSize[0]?.inlineSize;
    });
    observer.observe(card);
    return () => observer.disconnect();
  }, [cardRef, answered]);
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!folding || !card) return undefined;
    if (!playsMotion(card)) {
      setFolding(false);
      return undefined;
    }
    card.style.width = `${openWidth.current ?? card.offsetWidth}px`;
    const chosen = card.querySelector<HTMLElement>('button[aria-pressed="true"]');
    const others = Array.from(card.querySelectorAll<HTMLElement>('button[aria-pressed="false"]'));
    const animations = [
      chosen?.animate(
        [
          { transform: 'scale(1)' },
          {
            transform: 'scale(1.03)',
            boxShadow: `0 0 0 3px color-mix(in srgb, ${color.Primary.Main} 35%, transparent)`,
          },
          { transform: 'scale(1)' },
        ],
        { duration: 260, easing: 'ease-out' }
      ),
      ...others.flatMap((row) => {
        const { marginBlockStart, paddingBlockStart, paddingBlockEnd } = getComputedStyle(row);
        return [
          row.animate([{ opacity: 1 }, { opacity: 0.35 }], { duration: 180, fill: 'forwards' }),
          row.animate(
            [
              {
                height: `${row.offsetHeight}px`,
                opacity: 0.35,
                marginBlockStart,
                paddingBlockStart,
                paddingBlockEnd,
              },
              {
                height: '0px',
                opacity: 0,
                marginBlockStart: '0px',
                paddingBlockStart: '0px',
                paddingBlockEnd: '0px',
                borderWidth: '0px',
              },
            ],
            { duration: 320, delay: 220, easing: FOLD_EASING, fill: 'forwards' }
          ),
        ];
      }),
    ].filter((animation): animation is Animation => !!animation);
    let live = true;
    const done = () => {
      if (live) setFolding(false);
    };
    // A play the browser never ends (a hidden page) still leaves the answered card.
    const timer = window.setTimeout(done, LONGEST_PLAY_MS);
    Promise.all(animations.map((animation) => animation.finished))
      .then(done)
      .catch(() => undefined);
    return () => {
      live = false;
      window.clearTimeout(timer);
      animations.forEach((animation) => animation.cancel());
      card.style.width = '';
    };
  }, [cardRef, folding]);
  return folding;
};

/**
 * An agent's question with a button per option. A click reacts with the option's emoji, as
 * MindRoom asks; the first person's answer closes the question to its chosen option, which
 * shows the others again on a click.
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
  const [peek, setPeek] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const folding = useFoldOnAnswer(cardRef, !!answer);
  // A withdrawn answer closes the peek with it.
  if (!answer && peek) setPeek(false);
  // An answer removes the other options; keyboard focus on one of them moves to the chosen one.
  const chosenRef = useRef<HTMLButtonElement>(null);
  const [seenAnswer, setSeenAnswer] = useState(answer?.key);
  const [refocus, setRefocus] = useState(false);
  if (answer?.key !== seenAnswer) {
    setSeenAnswer(answer?.key);
    const focused = document.activeElement;
    setRefocus(
      !!answer &&
        focused instanceof HTMLButtonElement &&
        focused.hasAttribute('aria-pressed') &&
        !!cardRef.current?.contains(focused)
    );
  }
  useLayoutEffect(() => {
    if (!refocus) return;
    setRefocus(false);
    chosenRef.current?.focus({ preventScroll: true });
  }, [refocus]);

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

  // Once answered, the chosen option alone, with the others while they fold or on a peek.
  const options = question.options.filter(
    (option) => !answer || option.key === answer.key || folding || peek
  );

  return (
    <section
      ref={cardRef}
      className={css.Card}
      aria-label={t('mindroomUi.messages.questionCard.title')}
      data-question-card={answer ? 'answered' : 'waiting'}
    >
      {status && <span className={css.VisuallyHidden}>{status}</span>}
      {showText && (
        <div className={css.Top}>
          <span
            className={classNames(
              css.Mark,
              answer ? css.MarkAnswered : canAnswer && css.MarkWaiting,
              answer && folding && css.MarkPop
            )}
            aria-hidden
          >
            {answer && <Icon size="50" src={Icons.Check} />}
          </span>
          <Text
            size="T400"
            className={classNames(css.Question, answer && css.QuestionAnswered)}
            {...ownDirectionLine}
          >
            {question.text}
          </Text>
        </div>
      )}
      <div className={css.Options}>
        {options.map((option) => {
          const chosen = answer?.key === option.key;
          return (
            <button
              key={option.key}
              ref={chosen ? chosenRef : undefined}
              type="button"
              className={classNames(
                css.Option,
                chosen && css.OptionChosen,
                answer && !chosen && !folding && css.OptionPeek
              )}
              aria-pressed={chosen}
              aria-expanded={chosen ? peek : undefined}
              disabled={answer ? !chosen : !canAnswer || pending}
              onClick={() => (answer ? setPeek((shown) => !shown) : choose(option.key))}
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
                  <span className={css.ChosenText}>
                    {answererName
                      ? t('mindroomUi.messages.questionCard.nameChose', { name: answererName })
                      : t('mindroomUi.messages.questionCard.youChose')}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      {failed && (
        <Text role="alert" size="T200" className={css.Failed}>
          {t('activity.actions.failed')}
        </Text>
      )}
    </section>
  );
}
