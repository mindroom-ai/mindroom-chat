import { Suspense } from 'react';
import type { MatrixEvent } from 'matrix-js-sdk';
import { Text } from 'folds';
import { lazyPart } from '../../lib/lazyPart';
import type { CallRowContent } from '../../matrix/protocol/callRow';

type LazyCallRowProps = {
  mEvent: MatrixEvent;
  row: CallRowContent;
  /** The row's text ("Call started"), shown while the row loads or where it cannot. */
  body: unknown;
};

function CallRowText({ body }: Pick<LazyCallRowProps, 'body'>) {
  return <Text size="T400">{typeof body === 'string' ? body : ''}</Text>;
}

// Calls load on first use: a room without a call row never loads them.
const CallRow = lazyPart<LazyCallRowProps>(
  () => import('./CallRow').then((module) => ({ default: module.CallRow })),
  CallRowText
);

/** A call's row (`CallRow`), loaded on first use. */
export function LazyCallRow(props: LazyCallRowProps) {
  const { body } = props;
  return (
    <Suspense fallback={<CallRowText body={body} />}>
      <CallRow {...props} />
    </Suspense>
  );
}
