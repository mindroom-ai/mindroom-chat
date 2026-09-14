import { useTranslation } from 'react-i18next';
import React, { useEffect, useState } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { ToolApprovalData } from './toolApproval';
import { downloadMindroomSidecarBlob } from './sidecarDownload';
import * as css from './MindroomToolApprovalCard.css';

export function ApprovalArguments({ approval }: { approval: ToolApprovalData }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const auth = useMediaAuthentication();
  const [open, setOpen] = useState(false);
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
    void downloadMindroomSidecarBlob(mx, source, auth)
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
  }, [mx, auth, open, complete, sourceKey, retry]);
  return (
    <details className={css.Details} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t('mindroomUi.messages.approvalArguments.arguments')}</summary>
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
          <pre className={css.JsonBlock}>
            {JSON.stringify(complete ?? approval.arguments, null, 2)}
          </pre>
          <small>{t('mindroomUi.messages.approvalArguments.sensitiveValuesMayBeRedacted')}</small>
        </>
      )}
    </details>
  );
}
