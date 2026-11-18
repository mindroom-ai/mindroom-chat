import { Suspense, type ComponentProps } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useOptionalClientConfig } from '../config/useClientConfig';
import { reportBoundaryError } from '../bug-reports/error-reporting/errorReporting';
import { isPluginEnabled } from '../plugins/pluginConfig';
import { pluginFailure } from '../plugins/pluginFailure';
import { registeredPlugins, type ThreadHeaderSlotComponent } from '../plugins/registry';

const reportFailure = (tag: string, thrown: unknown, componentStack?: string | null) => {
  // eslint-disable-next-line no-console
  console.error(`[plugin ${tag}] failed to render in the thread banner`, thrown);
  reportBoundaryError(pluginFailure(tag, thrown), componentStack);
};

/**
 * What client plugins show in the open thread's banner (docs/client-plugins.md "Thread header
 * slot"): the `threadHeaderSlot` components of each plugin config.json leaves on, in build order,
 * given the thread's room and its confirmed root. A component that throws shows nothing and is
 * reported under its plugin's tag; one that loads its code shows nothing until it has.
 */
export function ThreadHeaderSlot({ room, threadId }: ComponentProps<ThreadHeaderSlotComponent>) {
  const config = useOptionalClientConfig();
  const slot = registeredPlugins.flatMap(({ id, tag, threadHeaderSlot }) =>
    isPluginEnabled(config, id)
      ? threadHeaderSlot.map((Component, index) => (
          <ErrorBoundary
            key={`${room.roomId}:${threadId}:${tag}:${index}`}
            fallback={null}
            onError={(thrown: unknown, info) => reportFailure(tag, thrown, info.componentStack)}
          >
            <Suspense fallback={null}>
              <Component room={room} threadId={threadId} />
            </Suspense>
          </ErrorBoundary>
        ))
      : []
  );
  return <>{slot}</>;
}
