import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { Button, Icon, Icons, Text } from 'folds';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { ToolApprovalData } from '../matrix/protocol/toolApproval';
import { downloadSidecarBlob } from '../event-store/cache/sidecarDownload';
import { useRevealOnOpen } from '../ui/disclosureReveal';
import { ApprovalArgumentFields, countArgumentFields } from './ApprovalArgumentFields';
import * as css from './ApprovalArgumentFields.css';

const PREVIEW_FIELDS = 3;

export function ApprovalArguments({ approval }: { approval: ToolApprovalData }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const armReveal = useRevealOnOpen(open, toggleRef, containerRef);
  const [loaded, setLoaded] = useState<{ sourceKey: string; value: Record<string, unknown> }>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const sourceKey = JSON.stringify(approval.argumentSource);
  const complete =
    approval.fullArguments ?? (loaded?.sourceKey === sourceKey ? loaded.value : undefined);
  useEffect(() => {
    let active = true;
    // Parsing replaces objects on every room update; attachment identity stays fixed.
    const source = JSON.parse(sourceKey) as ToolApprovalData['argumentSource'];
    if (!open || complete || !source) return undefined;
    setError(false);
    void downloadSidecarBlob(mx, source)
      .then(async (blob) => {
        const value: unknown = JSON.parse(await blob.text());
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error('Invalid argument attachment');
        if (active) setLoaded({ sourceKey, value: value as Record<string, unknown> });
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [mx, open, complete, sourceKey, retry]);
  const shown = complete ?? approval.arguments;
  const total = countArgumentFields(shown);
  if (total === 0 && approval.argumentsTruncated && !approval.argumentSource)
    return (
      <div className={css.Arguments}>
        <p>{t('mindroomUi.messages.approvalArguments.tooLargeToPreview')}</p>
      </div>
    );
  return (
    <div ref={containerRef} className={css.Arguments}>
      {!open && <ApprovalArgumentFields value={approval.arguments} limit={PREVIEW_FIELDS} />}
      <Button
        ref={toggleRef}
        type="button"
        size="300"
        variant="Secondary"
        fill="Soft"
        radii="300"
        className={css.Toggle}
        aria-expanded={open}
        onClick={() => {
          if (!open) armReveal();
          setOpen((value) => !value);
        }}
        before={<Icon size="50" src={open ? Icons.ChevronTop : Icons.ChevronBottom} />}
        outlined
      >
        <Text size="B300">
          {open
            ? t('mindroomUi.messages.approvalArguments.hideArguments')
            : t('mindroomUi.messages.approvalArguments.showAllArguments')}
        </Text>
        {!open && total > 0 && !approval.argumentsTruncated && (
          <Text size="B300" className={css.Count}>
            {total}
          </Text>
        )}
      </Button>
      {open && (
        <>
          {approval.argumentsTruncated && !complete && (
            <p>
              {error
                ? t('mindroomUi.messages.approvalArguments.loadFailed')
                : approval.argumentSource
                  ? t('mindroomUi.messages.approvalArguments.loadingCompleteArguments')
                  : t('mindroomUi.messages.approvalArguments.onlyATruncatedPreviewIsAvailable')}
              {error && (
                <button type="button" onClick={() => setRetry((value) => value + 1)}>
                  {t('mindroomUi.messages.approvalArguments.retry')}
                </button>
              )}
            </p>
          )}
          <ApprovalArgumentFields value={shown} />
          <small>{t('mindroomUi.messages.approvalArguments.sensitiveValuesMayBeRedacted')}</small>
        </>
      )}
    </div>
  );
}
