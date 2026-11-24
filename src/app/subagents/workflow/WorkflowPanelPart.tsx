import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text } from 'folds';
import { type PartLoadRetry, lazyPart } from '../../lib/lazyPart';
import { PartUnavailable } from '../../ui/PartUnavailable';
import type { WorkflowPanel } from './WorkflowPanel';

function WorkflowPanelUnavailable({
  onClose,
  retryLoad,
}: ComponentProps<typeof WorkflowPanel> & PartLoadRetry) {
  const { t } = useTranslation();
  return (
    <PartUnavailable retryLoad={retryLoad}>
      <Button type="button" size="300" variant="Secondary" fill="None" onClick={onClose}>
        <Text size="B300">{t('mindroomUi.workflowRun.panel.close')}</Text>
      </Button>
    </PartUnavailable>
  );
}

/** Lazy-loaded workflow graph side panel, kept out of the initial entry bundle. */
export const WorkflowPanelPart = lazyPart(
  () => import('./WorkflowPanel').then((module) => ({ default: module.WorkflowPanel })),
  WorkflowPanelUnavailable
);
