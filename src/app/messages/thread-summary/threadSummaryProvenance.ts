import type { TFunction } from 'i18next';
import type { ThreadSummaryInfo } from '../../matrix/protocol/threadSummary';

export function threadSummaryProvenance(
  t: TFunction,
  { isManual, messageCount }: ThreadSummaryInfo
): string {
  if (isManual) return t('sharedUi.threadSummary.manual');
  if (typeof messageCount === 'number' && messageCount > 0) {
    return t('sharedUi.threadSummary.provenanceCount', { count: messageCount });
  }
  return t('sharedUi.threadSummary.provenance');
}
