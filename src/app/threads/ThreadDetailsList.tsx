import { Suspense } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { reportBoundaryError } from '../bug-reports/error-reporting/errorReporting';
import { pluginFailure } from '../plugins/pluginFailure';
import type { ShownThreadDetail, ThreadDetailProps } from '../plugins/threadDetails';
import * as css from './ThreadDetailsList.css';

const reportFailure = (tag: string, thrown: unknown, componentStack?: string | null) => {
  // eslint-disable-next-line no-console
  console.error(`[plugin ${tag}] failed to render its thread details`, thrown);
  reportBoundaryError(pluginFailure(tag, thrown), componentStack);
};

/** Each plugin's detail is isolated: failing or loading details leave the others in place. */
export function ThreadDetailsList({
  room,
  threadId,
  details,
}: ThreadDetailProps & { details: readonly ShownThreadDetail[] }) {
  return (
    <>
      {details.map(({ key, tag, Component }) => (
        <div key={key} className={css.ThreadDetail} data-thread-detail={key}>
          <ErrorBoundary
            fallback={null}
            onError={(thrown: unknown, info) => reportFailure(tag, thrown, info.componentStack)}
          >
            <Suspense fallback={null}>
              <Component room={room} threadId={threadId} />
            </Suspense>
          </ErrorBoundary>
        </div>
      ))}
    </>
  );
}
