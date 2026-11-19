import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons } from 'folds';
import {
  ExpandAllInitContext,
  ManualExpansionStateContext,
  rememberManualExpansionState,
} from '../manualExpansionState';
import { formatWorkDuration } from '../../lib/time';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import * as reasoningCss from './Reasoning.css';
import * as css from './FinishedWorkFold.css';

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
 * A long finished agent reply, its work folded into one `Worked for 2m 13s` row above its answer,
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

  // As CollapsibleMessage: expand all opens the work and collapse all folds it, unless the reader
  // chose for this reply since.
  useEffect(() => {
    if (previousExpandAllInitRef.current === expandAllInit) return;
    previousExpandAllInitRef.current = expandAllInit;
    if (expandAllInit === undefined || manualExpansionState?.has(foldKey)) return;
    setOpen(expandAllInit);
  }, [expandAllInit, foldKey, manualExpansionState]);

  if (!folded) return whole;

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
          data-work-fold=""
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
