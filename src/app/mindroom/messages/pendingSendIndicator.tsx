import React from 'react';
import { EventStatus, type MatrixEvent } from 'matrix-js-sdk';
import { Icon, Icons, Text } from 'folds';
import * as css from './PendingSendIndicator.css';

const PENDING_LOCAL_ECHO_STATUSES = new Set<unknown>([
  EventStatus.ENCRYPTING,
  EventStatus.SENDING,
  EventStatus.QUEUED,
  EventStatus.SENT,
]);

export const isPendingLocalEchoStatus = (status: unknown): boolean =>
  PENDING_LOCAL_ECHO_STATUSES.has(status);

export const isPendingLocalEchoEvent = (event?: Pick<MatrixEvent, 'status'> | null): boolean =>
  isPendingLocalEchoStatus(event?.status);

export function PendingSendIndicator() {
  return (
    <Text
      as="span"
      size="T200"
      priority="300"
      className={css.Container}
      role="status"
      aria-label="Message sending"
      title="Waiting for server"
    >
      <Icon data-pending-send-icon="Clock" src={Icons.Clock} size="50" aria-hidden="true" />
    </Text>
  );
}

export const renderPendingSendIndicator = () => <PendingSendIndicator />;
