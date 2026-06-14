import React from 'react';
import { Icon, Icons, Text } from 'folds';
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
