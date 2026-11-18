import { createContext, Suspense, useContext, type ReactNode } from 'react';
import type { MatrixEvent } from 'matrix-js-sdk';
import { useOptionalMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { isMindroomAgentUserIdForViewer } from '../../matrix/protocol/agentIdentity';
import { readUiWidgets } from '../../matrix/protocol/uiWidgets';
import { lazyPart } from '../../lib/lazyPart';

type UiWidgetProps = { json: string; fallback: ReactNode };

/** The widget code: validation and the chart, in a chunk of its own. */
const UiWidget = lazyPart<UiWidgetProps>(
  () => import('./UiWidget'),
  ({ fallback }) => <>{fallback}</>
);

/** The widgets of the reply rendering below, by id; absent outside a trusted reply. */
const UiWidgetsContext = createContext<ReadonlyMap<string, string> | undefined>(undefined);

/**
 * Lets the marker blocks below draw their widgets, only while `mEvent` is not redacted and its
 * sender is a MindRoom agent on the current viewer's homeserver. `content` is the content that
 * supplies the body shown (the selected revision's own, or the live one).
 */
export function UiWidgetsScope({
  mEvent,
  content,
  children,
}: {
  mEvent: MatrixEvent;
  content: Record<string, unknown>;
  children: ReactNode;
}) {
  const viewer = useOptionalMatrixClient()?.getUserId() ?? undefined;
  const trusted =
    !mEvent.isRedacted() && isMindroomAgentUserIdForViewer(mEvent.getSender(), viewer);
  const value = trusted ? readUiWidgets(content) : undefined;
  const entries = value && new Map(value.widgets.map(({ id, json }) => [id, json]));
  return <UiWidgetsContext.Provider value={entries}>{children}</UiWidgetsContext.Provider>;
}

/** A `mindroom-ui-<id>` block: its widget inside a trusted reply that has it, else `fallback`. */
export function UiWidgetSlot({ id, fallback }: { id: string; fallback: ReactNode }) {
  const json = useContext(UiWidgetsContext)?.get(id);
  if (json === undefined) return <>{fallback}</>;
  return (
    <Suspense fallback={fallback}>
      <UiWidget json={json} fallback={fallback} />
    </Suspense>
  );
}
