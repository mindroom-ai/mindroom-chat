import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text } from 'folds';
import { type PartLoadRetry, lazyPart } from '../lib/lazyPart';
import { PartUnavailable } from '../ui/PartUnavailable';
import type { SubagentsPanel } from './SubagentsPanel';

/**
 * Without its chunk (offline when a room first opens it) the panel says so and offers Retry, and a
 * Close of its own: on phones it covers the conversation, and beside it its frame has no Close.
 */
function SubagentsPanelUnavailable({
  onClose,
  retryLoad,
}: ComponentProps<typeof SubagentsPanel> & PartLoadRetry) {
  const { t } = useTranslation();
  return (
    <PartUnavailable retryLoad={retryLoad}>
      <Button type="button" size="300" variant="Secondary" fill="None" onClick={onClose}>
        <Text size="B300">{t('mindroomUi.subagents.close')}</Text>
      </Button>
    </PartUnavailable>
  );
}

/**
 * The room's Sub-agents side panel, loaded the first time a room opens it, so rooms whose agents
 * delegate nothing never load it; the chunk keeps the name of `./SubagentsPanel`.
 */
export const SubagentsPanelPart = lazyPart(
  () => import('./SubagentsPanel').then((module) => ({ default: module.SubagentsPanel })),
  SubagentsPanelUnavailable
);
