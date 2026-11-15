import {
  Fragment,
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { Button, Icon, IconButton, Icons, Text } from 'folds';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import type { TourLevel } from '../navigation/tourState';
import { ThreadStreamingDot } from '../threads/ThreadStreamingDot';
import { documentIsRightToLeft } from '../ui/directional';
import { Modal500 } from '../ui/Modal500';
import * as css from './TourDialog.css';
import { prefersReducedMotion } from './tourMotion';
import { sampleGraphemes } from './tourSample';
import { START_TYPING_PHASE, sceneOf } from './tourScenes';
import { TourStage } from './TourStage';
import { TOUR_STEPS, nextStep, previousStep, stepAt, stepsOf, type TourStep } from './tourSteps';
import { useScenePhase, useTypedLength } from './useScenePhase';

/** The states the `states` step explains, in the order of its cards. */
const STATES = ['streaming', 'unread', 'resolved', 'snoozed'] as const;

type StepTextProps = {
  step: TourStep;
  /** Whether the title is a heading: only the step that shows is, not the copies that hold room. */
  heading?: boolean;
  /**
   * Which step of how many this is and its chapter, said before the title for a screen reader,
   * which hears the title row and the chapter's name only when it goes looking for them.
   */
  place?: string;
};

/** A step's title over its text; the `states` step has a row per state instead of a text. */
function StepText({ step, heading = false, place }: StepTextProps) {
  const { t } = useTranslation();
  return (
    <>
      {place && <span className={css.Unseen}>{place}</span>}
      <Text as={heading ? 'h3' : 'span'} size="H4">
        {t(`tour.steps.${step.id}.title`)}
      </Text>
      {step.id === 'states' ? (
        <div className={css.States}>
          {STATES.map((state) => (
            <Fragment key={state}>
              <Text as="span" size="L400" className={css.StatePill[state]} data-tour-state={state}>
                {/* The mark its card has on the stage. */}
                {state === 'streaming' && <ThreadStreamingDot aria-hidden="true" />}
                {t(`thread.status.${state}`)}
                {/* Read out, the name and its line would run together. */}
                <span className={css.Unseen}>: </span>
              </Text>
              <Text as="span" size="T300" priority="400">
                {t(`tour.steps.states.${state}`)}
              </Text>
            </Fragment>
          ))}
        </div>
      ) : (
        <Text as="span" size="T300" priority="400">
          {t(`tour.steps.${step.id}.text`)}
        </Text>
      )}
    </>
  );
}

type TourDialogProps = {
  /** How much of the tour plays. */
  level: TourLevel;
  /** Keep going asks for the Full tour. */
  onLevelChange: (level: TourLevel) => void;
  /** Closes the tour: `done` from the last step's Done, `dismissed` any other way. */
  onClose: (how: 'done' | 'dismissed') => void;
};

/**
 * The interface tour: a dialog that goes through the steps of a level. From the top it has the
 * level's name with the step's number, the stage that plays the step's scene, the step's chapter
 * (with Replay beside it once the scene has played), title and text, a progress bar and the
 * buttons. The arrow keys move a step, the main button
 * keeps the focus so Enter goes on, and the text is read out as each step comes.
 */
export function TourDialog({ level, onLevelChange, onClose }: TourDialogProps) {
  const { t } = useTranslation();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const steps = stepsOf(level);
  const [position, setPosition] = useState(0);
  const index = Math.min(position, steps.length - 1);
  const step = stepAt(level, index);
  const last = index === steps.length - 1;

  const { phase, settled, replay } = useScenePhase(step);
  const typedText = t('tour.sample.typed');
  const typedTotal = useMemo(() => sampleGraphemes(typedText).length, [typedText]);
  const typedLength = useTypedLength(
    typedTotal,
    step.id === 'start' && phase === START_TYPING_PHASE
  );
  const scene = useMemo(
    () => sceneOf(step.id, phase, phone, typedLength),
    [step.id, phase, phone, typedLength]
  );

  // A live region says only what changes in it, so it is silent about the step the tour opens
  // with. The dialog is described by the step's text, which a screen reader reads with the
  // dialog's name as the focus enters it.
  const textId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const dialog = contentRef.current?.closest('[role="dialog"]');
    dialog?.setAttribute('aria-describedby', textId);
    return () => dialog?.removeAttribute('aria-describedby');
  }, [textId]);

  // Enter goes on: the main button has the focus when the tour opens and after each step.
  const mainRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    mainRef.current?.focus();
  }, [step.id]);

  // The dialog's focus trap also asks to close as it is taken off the page, which a tour that
  // was closed with Done is by then: only the first way of closing counts.
  const closed = useRef(false);
  const latestOnClose = useLatestRef(onClose);
  const close = (how: 'done' | 'dismissed') => {
    if (closed.current) return;
    closed.current = true;
    latestOnClose.current(how);
  };
  const dismiss = () => close('dismissed');

  // A phone's text scrolls where the screen is too short for it: each step starts at its top.
  const textRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (textRef.current) textRef.current.scrollTop = 0;
  }, [step.id]);
  const goOn = () => setPosition(nextStep(level, index));
  const goBack = () => setPosition(previousStep(index));
  const keepGoing = () => {
    // The Quick tour's steps are the Full tour's first ones, so the next step follows.
    onLevelChange('full');
    setPosition(index + 1);
  };
  const playAgain = () => {
    replay();
    // The Replay button goes away while the scene plays; the focus must not go with it.
    mainRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    // The keys follow the reading direction. They stop at the level's ends.
    if ((event.key === 'ArrowRight') !== documentIsRightToLeft()) goOn();
    else goBack();
  };

  // A scene that played can play again, unless nothing moves.
  const canReplay = settled && step.phases.length > 1 && !prefersReducedMotion();

  return (
    <Modal500
      requestClose={dismiss}
      fillPhoneScreen
      fitContent
      className={phone ? undefined : css.Dialog}
    >
      {/* The arrow keys reach this element from whichever of its controls has the focus. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        ref={contentRef}
        className={css.Content}
        data-tour-dialog=""
        data-tour-level={level}
        data-tour-step={step.id}
        onKeyDown={onKeyDown}
      >
        <div className={css.TitleRow}>
          <div className={css.Title}>
            <Text as="h2" size="H4" data-dialog-title="">
              {t(`tour.levels.${level}`)}
            </Text>
            <Text as="span" size="T300" priority="300">
              {t('tour.dialog.stepOf', { current: index + 1, total: steps.length })}
            </Text>
          </div>
          <IconButton
            size="300"
            radii="300"
            variant="Surface"
            aria-label={t('tour.dialog.close')}
            data-tour-action="close"
            onClick={dismiss}
          >
            <Icon src={Icons.Cross} size="100" />
          </IconButton>
        </div>

        <TourStage
          className={phone ? css.PhoneStage : css.Stage}
          scene={scene}
          phone={phone}
          phase={phase}
          settled={settled}
        />

        <div ref={textRef} className={classNames(css.TextBlock, phone && css.PhoneTextBlock)}>
          <div className={css.ChapterRow}>
            <Text as="span" size="L400" className={css.Chapter}>
              {t(`tour.chapters.${step.chapter}`)}
            </Text>
            {canReplay && (
              <Button
                className={css.Replay}
                size="300"
                radii="300"
                variant="Secondary"
                fill="None"
                before={<Icon size="50" src={Icons.Reload} />}
                data-tour-action="replay"
                onClick={playAgain}
              >
                <Text size="B300">{t('tour.dialog.replay')}</Text>
              </Button>
            )}
          </div>
          <div className={css.TextGrid}>
            {/* Every step's text holds its room, so the block is as tall as the tallest. */}
            {TOUR_STEPS.map((each) => (
              <div
                key={each.id}
                className={classNames(css.StepText, css.StepTextSizer)}
                aria-hidden="true"
              >
                <StepText step={each} />
              </div>
            ))}
            <div id={textId} className={css.StepText} aria-live="polite" aria-atomic="true">
              <StepText
                step={step}
                heading
                place={`${t('tour.dialog.stepOf', {
                  current: index + 1,
                  total: steps.length,
                })}. ${t(`tour.chapters.${step.chapter}`)}.`}
              />
            </div>
          </div>
        </div>

        {/* For the eye: the title row says which step of how many this is. */}
        <div
          className={classNames(css.Progress, phone && css.PhoneProgress)}
          aria-hidden="true"
          data-tour-progress=""
        >
          {steps.map((each, at) => (
            <span
              key={each.id}
              className={classNames(
                css.Segment,
                at <= index && css.SegmentReached,
                at > 0 && steps[at - 1]?.chapter !== each.chapter && css.SegmentOfNewChapter
              )}
              data-tour-segment={at <= index ? 'reached' : 'ahead'}
            />
          ))}
        </div>

        <div className={classNames(css.Buttons, phone && css.PhoneButtons)}>
          {index > 0 && (
            <Button
              size="400"
              radii="400"
              variant="Secondary"
              fill="Soft"
              data-tour-action="back"
              onClick={goBack}
            >
              <Text size="B400">{t('tour.dialog.back')}</Text>
            </Button>
          )}
          <span className={css.ButtonSpacer} />
          {level === 'quick' && last && (
            <Button
              className={css.Shrinkable}
              size="400"
              radii="400"
              variant="Primary"
              fill="Soft"
              data-tour-action="keepGoing"
              onClick={keepGoing}
            >
              <Text size="B400" truncate>
                {t('tour.dialog.keepGoing')}
              </Text>
            </Button>
          )}
          <Button
            ref={mainRef}
            size="400"
            radii="400"
            variant="Primary"
            fill="Solid"
            data-tour-action={last ? 'done' : 'next'}
            onClick={last ? () => close('done') : goOn}
          >
            <Text size="B400">{t(last ? 'tour.dialog.done' : 'tour.dialog.next')}</Text>
          </Button>
        </div>
      </div>
    </Modal500>
  );
}
