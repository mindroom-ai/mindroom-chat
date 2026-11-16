import { useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons } from 'folds';
import {
  ExpandAllInitContext,
  ManualExpansionStateContext,
  rememberManualExpansionState,
} from '../manualExpansionState';
import { useToolCallsShown } from '../toolCallVisibility';
import { ToolCallMessageContext } from './toolCallStatus';
import { formatWorkDuration } from '../../lib/time';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import * as reasoningCss from './Reasoning.css';
import * as css from './FinishedWorkFold.css';

// Whether each finished reply was taller than the screen when it was measured, by fold key and
// whether its tool calls showed, so a row that virtualization mounts again folds or stays open on
// its first paint without measuring.
const tallerThanScreen = new Map<string, boolean>();

/**
 * Where the reply's verdict is cached: showing or hiding its tool calls changes its height, so
 * each setting has its own, read as ToolCallsFold reads the setting.
 */
const useVerdictKey = (foldKey: string): string => {
  const message = useContext(ToolCallMessageContext);
  const [toolCallsShown] = useToolCallsShown(message?.roomId, message?.threadId);
  return `${foldKey}:${toolCallsShown ? 'tool-calls-shown' : 'tool-calls-hidden'}`;
};

/** Whether the reply measured shorter than the screen as it shows now: it need not be split. */
export const useFitsOnScreen = (foldKey: string): boolean =>
  tallerThanScreen.get(useVerdictKey(foldKey)) === false;

/**
 * Whether the element is taller than the viewport; undefined when there is nothing to measure,
 * also while it has no size, as in a hidden panel.
 */
const measureTallerThanScreen = (element: HTMLElement | null): boolean | undefined => {
  if (!element || typeof window === 'undefined') return undefined;
  const { width, height } = element.getBoundingClientRect();
  if (!width || !height) return undefined;
  return height > window.innerHeight;
};

type FinishedWorkFoldProps = {
  /** Where the timeline remembers the reader's choice, distinct from the long-message fold's key. */
  foldKey: string;
  /** From the reply's first event to its final edit; undefined when it was never edited. */
  durationMs?: number;
  /** The reply as it renders unfolded. */
  whole: ReactNode;
  /**
   * The reply split after its last tool call once it finished with an answer there; undefined
   * while it streams or when it may not fold, and it then renders whole.
   */
  folded?: {
    /** The work: reasoning, tool calls and the text between them. */
    work: ReactNode;
    /** What follows the last tool call: the answer, shown folded or not. */
    answer: ReactNode;
  };
};

/**
 * A finished agent reply that is taller than the screen, its work folded into one
 * `Worked for 2m 13s` row above its answer, as T3 Code folds a finished turn. The reply renders
 * whole, in the same element while it streams and after, so its state stays; once it may fold it
 * is measured before it paints, and a shorter one stays as it is, without a row.
 * Clicking the row shows the work in place. The choice survives virtualization remounts through
 * the timeline's manual expansion state, and the row follows the timeline's expand all.
 */
export function FinishedWorkFold({ foldKey, durationMs, whole, folded }: FinishedWorkFoldProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const manualExpansionState = useContext(ManualExpansionStateContext);
  const expandAllInit = useContext(ExpandAllInitContext);
  const wholeRef = useRef<HTMLDivElement>(null);
  const verdictKey = useVerdictKey(foldKey);
  const [measured, setMeasured] = useState<{ key: string; tall: boolean }>();
  const tall = measured?.key === verdictKey ? measured.tall : tallerThanScreen.get(verdictKey);
  const [open, setOpen] = useState(
    () => manualExpansionState?.get(foldKey) ?? expandAllInit ?? false
  );
  const previousExpandAllInitRef = useRef(expandAllInit);

  const foldable = folded !== undefined;

  // Once per mount and tool-call setting, as soon as the reply may fold and before it paints, so
  // a tall one never shows unfolded first. A reply without a size yet is measured once it has one.
  useLayoutEffect(() => {
    if (!foldable || tall !== undefined) return undefined;
    const element = wholeRef.current;
    const measure = () => {
      const result = measureTallerThanScreen(element);
      if (result === undefined) return false;
      rememberManualExpansionState(tallerThanScreen, verdictKey, result);
      setMeasured({ key: verdictKey, tall: result });
      return true;
    };
    if (measure() || !element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (measure()) observer.disconnect();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [foldable, verdictKey, tall]);

  // As CollapsibleMessage: expand all opens the work and collapse all folds it, unless the reader
  // chose for this reply since.
  useEffect(() => {
    if (previousExpandAllInitRef.current === expandAllInit) return;
    previousExpandAllInitRef.current = expandAllInit;
    if (expandAllInit === undefined || manualExpansionState?.has(foldKey)) return;
    setOpen(expandAllInit);
  }, [expandAllInit, foldKey, manualExpansionState]);

  if (!folded || !tall) return <div ref={wholeRef}>{whole}</div>;

  const toggle = () => {
    const next = !open;
    if (manualExpansionState) rememberManualExpansionState(manualExpansionState, foldKey, next);
    setOpen(next);
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
          className={reasoningCss.Toggle}
          aria-expanded={open}
          onClick={toggle}
        >
          <Icon size="50" src={Icons.RecentClock} aria-hidden />
          <span className={reasoningCss.Label}>{label}</span>
          <Icon size="50" src={Icons.ChevronRight} className={reasoningCss.Chevron} aria-hidden />
        </button>
        {open && <div className={css.Work}>{folded.work}</div>}
      </div>
      {folded.answer}
    </>
  );
}
