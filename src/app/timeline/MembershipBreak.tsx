import { useTranslation } from 'react-i18next';
import type { MembershipFoldSummary } from './membershipFolds';
import * as css from './TurnBreak.css';

type MembershipBreakProps = {
  summary: MembershipFoldSummary;
  open: boolean;
  onToggle: () => void;
};

const BUCKET_ENTRIES = [
  ['joined', 'mindroomUi.messages.membershipFold.joined'],
  ['left', 'mindroomUi.messages.membershipFold.left'],
  ['invited', 'mindroomUi.messages.membershipFold.invited'],
  ['requested', 'mindroomUi.messages.membershipFold.requested'],
  ['kicked', 'mindroomUi.messages.membershipFold.kicked'],
  ['banned', 'mindroomUi.messages.membershipFold.banned'],
  ['unbanned', 'mindroomUi.messages.membershipFold.unbanned'],
  ['profileChanges', 'mindroomUi.messages.membershipFold.profileChanges'],
] as const;

/**
 * Centered dashed divider pill for a folded run of consecutive room membership events.
 */
export function MembershipBreak({ summary, open, onToggle }: MembershipBreakProps) {
  const { t } = useTranslation();

  let label: string;
  if (open) {
    label = t('mindroomUi.messages.membershipFold.hide', { count: summary.total });
  } else {
    const nonZero: Array<{ count: number; text: string }> = [];
    for (const [field, key] of BUCKET_ENTRIES) {
      const count = summary[field];
      if (count > 0) {
        nonZero.push({ count, text: t(key, { count }) });
      }
    }
    const first = nonZero[0];
    if (nonZero.length === 1 && first && first.count === summary.total) {
      label = first.text;
    } else if (nonZero.length > 0) {
      const baseSummary = t('mindroomUi.messages.membershipFold.summary', {
        count: summary.total,
      });
      const details = nonZero
        .map((entry) => entry.text)
        .join(t('mindroomUi.messages.membershipFold.listSeparator'));
      label = t('mindroomUi.messages.membershipFold.summaryWithDetails', {
        summary: baseSummary,
        details,
      });
    } else {
      label = t('mindroomUi.messages.membershipFold.summary', { count: summary.total });
    }
  }

  return (
    <div className={css.MembershipBreak} data-membership-break>
      <span className={css.Line} />
      <button type="button" className={css.MembershipPill} aria-expanded={open} onClick={onToggle}>
        <span className={css.PillLabel}>{label}</span>
        <span className={css.Chevron} aria-hidden>
          {open ? '▴' : '▾'}
        </span>
      </button>
      <span className={css.Line} />
    </div>
  );
}
