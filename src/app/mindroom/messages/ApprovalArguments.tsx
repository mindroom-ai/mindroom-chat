import React, { useEffect, useState } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { ToolApprovalData } from './toolApproval';
import { downloadMindroomSidecarBlob } from './sidecarDownload';
import * as css from './MindroomToolApprovalCard.css';

export function ApprovalArguments({ approval }: { approval: ToolApprovalData }) {
  const mx = useMatrixClient();
  const auth = useMediaAuthentication();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<{ sourceKey: string; value: Record<string, unknown> }>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const sourceKey = JSON.stringify(approval.argumentSource);
  const complete =
    approval.fullArguments ?? (loaded?.sourceKey === sourceKey ? loaded.value : undefined);
  useEffect(() => {
    let active = true;
    // Parsing replaces objects on every room update; attachment identity stays fixed.
    const source = JSON.parse(sourceKey) as ToolApprovalData['argumentSource'];
    if (!open || complete || !source) return undefined;
    setError(undefined);
    void downloadMindroomSidecarBlob(mx, source, auth)
      .then(async (blob) => {
        const value: unknown = JSON.parse(await blob.text());
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error('Invalid argument attachment');
        if (active) setLoaded({ sourceKey, value: value as Record<string, unknown> });
      })
      .catch(() => {
        if (active) setError('Could not load complete arguments.');
      });
    return () => {
      active = false;
    };
  }, [mx, auth, open, complete, sourceKey, retry]);
  return (
    <details className={css.Details} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Arguments</summary>
      {open && (
        <>
          {approval.argumentsTruncated && !complete && (
            <p>
              {error ??
                (approval.argumentSource
                  ? 'Loading complete arguments…'
                  : 'Only a truncated preview is available.')}
              {error && (
                <button type="button" onClick={() => setRetry((value) => value + 1)}>
                  Retry
                </button>
              )}
            </p>
          )}
          <pre className={css.JsonBlock}>
            {JSON.stringify(complete ?? approval.arguments, null, 2)}
          </pre>
          <small>Sensitive values may be redacted.</small>
        </>
      )}
    </details>
  );
}
