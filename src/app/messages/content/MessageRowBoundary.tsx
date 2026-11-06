import { type ReactNode } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { Box, config } from 'folds';
import { BrokenContent } from './BrokenContent';
import { reportBoundaryError } from '../../bug-reports/error-reporting/errorReporting';

function BrokenRow() {
  return (
    <Box style={{ padding: config.space.S200, paddingInlineStart: config.space.S400 }}>
      <BrokenContent />
    </Box>
  );
}

/**
 * One row of a message list. A row that fails to render shows "Broken message" in its place and
 * the rest of the list stays, so one event of an unexpected shape cannot take down the view.
 * `render` runs inside the boundary, so a failure while building the row is caught too.
 */
export function MessageRowBoundary({ render }: { render: () => ReactNode }) {
  return (
    <ErrorBoundary
      fallback={<BrokenRow />}
      onError={(error, info) => reportBoundaryError(error, info.componentStack)}
    >
      <RenderRow render={render} />
    </ErrorBoundary>
  );
}

function RenderRow({ render }: { render: () => ReactNode }) {
  return <>{render()}</>;
}
