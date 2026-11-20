import {
  useContext,
  useEffect,
  useRef,
  useState,
  type AnimationEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons } from 'folds';
import {
  ExpandAllInitContext,
  ManualExpansionStateContext,
  rememberManualExpansionState,
} from '../manualExpansionState';
import { formatWorkDuration } from '../../lib/time';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { motionAllowed } from '../../ui/listMotion';
import { Outline } from './OutlineComet.css';
import * as reasoningCss from './Reasoning.css';
import * as css from './FinishedWorkFold.css';

// The paths of folds' Icons.RecentClock (node_modules/folds), split into face with arrow and hands.
const CLOCK_FACE = [
  'M20.5 12C20.5 16.6944 16.6944 20.5 12 20.5C7.30558 20.5 3.5 16.6944 3.5 12H2C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C8.29859 2 5.06687 4.01099 3.33782 7H5.1254C6.67093 4.87867 9.17446 3.5 12 3.5C16.6944 3.5 20.5 7.30558 20.5 12Z',
  'M4.5 3H3V8H8V6.5H4.5V3Z',
];
const CLOCK_HANDS = 'M11 7L13 6.99997L13 11.5858L16.9498 15.5355L15.5355 16.9497L11 12.4142L11 7Z';

type FinishedWorkFoldProps = {
  /** Where the timeline remembers the reader's choice, distinct from the long-message fold's key. */
  foldKey: string;
  /** From the reply's first event to its final edit; undefined when it was never edited. */
  durationMs?: number;
  /** The reply as it renders unfolded. */
  whole: ReactNode;
  /**
   * The reply split after its last tool call once it finished long, with an answer there;
   * undefined while it streams or when it may not fold, and it then renders whole.
   */
  folded?: {
    /** The work: reasoning, tool calls and the text between them. */
    work: ReactNode;
    /** What follows the last tool call: the answer, shown folded or not. */
    answer: ReactNode;
  };
};

/**
 * A finished agent reply, its work folded into one `Worked for 2m 13s` row above its answer,
 * as T3 Code folds a finished turn. Until it may fold, the reply renders whole, as it would
 * without this component, which stays in its tree so its state lasts while it streams.
 * Clicking the row shows the work in place. The choice survives virtualization remounts through
 * the timeline's manual expansion state, and the row follows the timeline's expand all.
 */
export function FinishedWorkFold({ foldKey, durationMs, whole, folded }: FinishedWorkFoldProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const manualExpansionState = useContext(ManualExpansionStateContext);
  const expandAllInit = useContext(ExpandAllInitContext);
  const [open, setOpen] = useState(
    () => manualExpansionState?.get(foldKey) ?? expandAllInit ?? false
  );
  const previousExpandAllInitRef = useRef(expandAllInit);
  // While the work slides open or folds back; folding, it stays mounted until it has folded.
  const [moving, setMoving] = useState<'opening' | 'closing'>();
  // Each click sheds a ring off the clock: the count keys it, so a new one starts at once.
  const [rings, setRings] = useState(0);
  const workRef = useRef<HTMLDivElement>(null);

  // A slide that stops before its end (reduced motion turned on mid-slide drops its animation)
  // settles too. React has no handler for that event, so the wrapper is listened to itself.
  useEffect(() => {
    const work = workRef.current;
    if (!work || moving === undefined) return undefined;
    const cancel = (event: Event) => {
      if (event.target === work) setMoving(undefined);
    };
    work.addEventListener('animationcancel', cancel);
    return () => work.removeEventListener('animationcancel', cancel);
  }, [moving]);

  // As CollapsibleMessage: expand all opens the work and collapse all folds it, unless the reader
  // chose for this reply since.
  useEffect(() => {
    if (previousExpandAllInitRef.current === expandAllInit) return;
    previousExpandAllInitRef.current = expandAllInit;
    if (expandAllInit === undefined || manualExpansionState?.has(foldKey)) return;
    setOpen(expandAllInit);
    setMoving(undefined);
  }, [expandAllInit, foldKey, manualExpansionState]);

  if (!folded) {
    // A split that comes back later starts at rest, not in the middle of a slide it lost.
    if (moving !== undefined) setMoving(undefined);
    return whole;
  }

  const toggle = () => {
    const next = !open;
    if (manualExpansionState) rememberManualExpansionState(manualExpansionState, foldKey, next);
    setOpen(next);
    setMoving(motionAllowed() ? (next ? 'opening' : 'closing') : undefined);
    setRings((count) => count + 1);
  };
  const settle = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) setMoving(undefined);
  };
  const label =
    durationMs === undefined
      ? t('mindroomUi.messages.finishedWork.worked')
      : t('mindroomUi.messages.finishedWork.workedFor', {
          duration: formatWorkDuration(durationMs, language),
        });
  return (
    <>
      <div className={reasoningCss.Reasoning}>
        <button
          type="button"
          className={`${reasoningCss.Toggle} ${css.Row}`}
          data-work-fold=""
          aria-expanded={open}
          onClick={toggle}
        >
          <span className={css.ClockBox} aria-hidden>
            <svg className={css.Clock} viewBox="0 0 24 24" fill="currentColor" focusable="false">
              <g>
                {CLOCK_FACE.map((d) => (
                  <path key={d} d={d} />
                ))}
              </g>
              <g className={css.Hands}>
                <path d={CLOCK_HANDS} />
              </g>
            </svg>
            {rings > 0 && (
              <svg className={Outline} viewBox="0 0 24 24" fill="none">
                <circle key={rings} className={css.Ring} cx="12" cy="12" r="9.25" />
              </svg>
            )}
          </span>
          <span className={`${reasoningCss.Label} ${css.Label}`}>{label}</span>
          <Icon
            size="50"
            src={Icons.ChevronRight}
            className={`${reasoningCss.Chevron} ${css.Chevron}`}
            aria-hidden
          />
        </button>
        {(open || moving === 'closing') && (
          <div ref={workRef} className={css.Work} data-motion={moving} onAnimationEnd={settle}>
            <div className={css.WorkInner}>{folded.work}</div>
          </div>
        )}
      </div>
      {folded.answer}
    </>
  );
}
