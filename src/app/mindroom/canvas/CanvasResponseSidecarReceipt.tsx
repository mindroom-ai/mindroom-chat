import React, { type ReactNode } from 'react';
import type { MindroomLongTextSource } from '../messages/longText';
import { useMindroomLongTextResolvedContent } from '../messages/MindroomLongTextText';
import { readCanvasResponse } from './canvasMessages';
import { CanvasResponseReceipt } from './CanvasResponseReceipt';

type CanvasResponseSidecarReceiptProps = {
  source: MindroomLongTextSource;
  /** The event's own relation; MindRoom also ignores the one inside the uploaded file. */
  relation: unknown;
  hydrate: boolean;
  delivered: boolean;
  renderStateSuffix?: () => ReactNode;
  /** The ordinary long-text view, until (or unless) the downloaded content proves an answer. */
  fallback: ReactNode;
};

/** A canvas answer that was too large for one event, sent as a long-text sidecar. */
export function CanvasResponseSidecarReceipt({
  source,
  relation,
  hydrate,
  delivered,
  renderStateSuffix,
  fallback,
}: CanvasResponseSidecarReceiptProps) {
  const resolved = useMindroomLongTextResolvedContent(source, hydrate);
  const receipt = resolved && readCanvasResponse({ ...resolved, 'm.relates_to': relation });
  if (!receipt) return <>{fallback}</>;
  return (
    <CanvasResponseReceipt
      receipt={receipt}
      delivered={delivered}
      renderStateSuffix={renderStateSuffix}
    />
  );
}
