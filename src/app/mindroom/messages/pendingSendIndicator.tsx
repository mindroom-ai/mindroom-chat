import React from 'react';
import { color, Icon, Icons, Text } from 'folds';
import * as css from './PendingSendIndicator.css';

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

export function FailedSendIndicator() {
  return (
    <Text
      as="span"
      size="T200"
      priority="300"
      className={css.Container}
      style={{ color: color.Critical.Main }}
      role="status"
      aria-label="Message failed to send"
      title="Not sent"
    >
      <Icon data-failed-send-icon="Warning" src={Icons.Warning} size="50" aria-hidden="true" />
    </Text>
  );
}

export const renderFailedSendIndicator = () => <FailedSendIndicator />;
