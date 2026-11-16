import { Icon } from 'folds';
import { ForkIcon } from '../../messages/ForkIcon';

/** The mark on a fork's card; its tooltip, `label`, names the thread it was forked from. */
export function ThreadForkedBadge({ label }: { label: string }) {
  return (
    <span
      title={label}
      aria-label={label}
      role="img"
      data-compact-card-fork-badge
      style={{ display: 'inline-flex', alignItems: 'center' }}
    >
      <Icon size="50" src={ForkIcon} aria-hidden="true" />
    </span>
  );
}
