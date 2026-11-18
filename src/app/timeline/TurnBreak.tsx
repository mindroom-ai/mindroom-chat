import { useTranslation } from 'react-i18next';
import * as css from './TurnBreak.css';

type TurnBreakProps = {
  /** How many messages the turn holds between its question and its answer. */
  count: number;
  open: boolean;
  onToggle: () => void;
};

/**
 * The break a finished turn of an open thread folds its middle rows behind
 * (`threadTurnFolds.ts`): a dashed line with `··· 5 earlier messages ···`, which shows them,
 * and once they show, the same line on top of them with `Hide 5 messages`.
 */
export function TurnBreak({ count, open, onToggle }: TurnBreakProps) {
  const { t } = useTranslation();
  return (
    <div className={css.TurnBreak} data-turn-break>
      <span className={css.Line} />
      <button type="button" className={css.Pill} aria-expanded={open} onClick={onToggle}>
        {open ? (
          t('mindroomUi.messages.turnFold.hide', { count })
        ) : (
          <>
            <span className={css.Dots} aria-hidden>
              ···
            </span>
            {t('mindroomUi.messages.turnFold.earlier', { count })}
            <span className={css.Dots} aria-hidden>
              ···
            </span>
          </>
        )}
      </button>
      <span className={css.Line} />
    </div>
  );
}
