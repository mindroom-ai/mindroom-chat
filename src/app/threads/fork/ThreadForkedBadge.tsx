import { useTranslation } from 'react-i18next';
import { Icon } from 'folds';
import type { Room } from 'matrix-js-sdk';
import type { ThreadForkRef } from '../../event-store/threads/threadFork';
import { ForkIcon } from '../../messages/forkIcon';
import { useThreadTitle } from './ThreadForkDivider';

/** The mark on a fork's card; its tooltip names the thread it was forked from. */
export function ThreadForkedBadge({ room, parent }: { room: Room; parent: ThreadForkRef }) {
  const { t } = useTranslation();
  const title = useThreadTitle(room, parent.threadId, undefined, undefined);
  return (
    <span
      title={t('threadFork.forkedFrom', { title })}
      aria-label={t('threadFork.forkedFrom', { title })}
      role="img"
      data-compact-card-fork-badge
      style={{ display: 'inline-flex', alignItems: 'center' }}
    >
      <Icon size="50" src={ForkIcon} aria-hidden="true" />
    </span>
  );
}
