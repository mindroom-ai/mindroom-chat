import { useContext, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons } from 'folds';
import { ManualExpansionStateContext, rememberManualExpansionState } from '../manualExpansionState';
import { formatWorkDuration } from './finishedWorkSplit';
import * as css from './FinishedWorkFold.css';

type FinishedWorkFoldProps = {
  /** Where the timeline remembers the reader's choice, distinct from the long-message fold's key. */
  foldKey: string;
  /** From the reply's first event to its final edit; undefined when it was never edited. */
  durationMs?: number;
  /** The work: reasoning, tool calls and the text between them. */
  children: ReactNode;
};

/**
 * A finished agent reply's work folded into one `Worked for 2m 13s` row, as T3 Code folds a
 * finished turn. Clicking the row shows the work in place. The choice survives virtualization
 * remounts through the timeline's manual expansion state.
 */
export function FinishedWorkFold({ foldKey, durationMs, children }: FinishedWorkFoldProps) {
  const { t } = useTranslation();
  const manualExpansionState = useContext(ManualExpansionStateContext);
  const [open, setOpen] = useState(() => manualExpansionState?.get(foldKey) ?? false);
  const toggle = () => {
    const next = !open;
    if (manualExpansionState) rememberManualExpansionState(manualExpansionState, foldKey, next);
    setOpen(next);
  };
  const label =
    durationMs === undefined
      ? t('mindroomUi.messages.finishedWork.worked')
      : t('mindroomUi.messages.finishedWork.workedFor', {
          duration: formatWorkDuration(durationMs),
        });
  return (
    <div className={css.Fold} data-finished-work="">
      <button type="button" className={css.Toggle} aria-expanded={open} onClick={toggle}>
        <Icon size="50" src={Icons.RecentClock} aria-hidden />
        <span className={css.Label}>{label}</span>
        <Icon size="50" src={Icons.ChevronRight} className={css.Chevron} aria-hidden />
      </button>
      {open && <div className={css.Work}>{children}</div>}
    </div>
  );
}
