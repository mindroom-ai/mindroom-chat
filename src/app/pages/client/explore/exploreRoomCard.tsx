import React from 'react';
import { Text } from 'folds';

/** The room card's full topic: shown inline, since the topic viewer dialog is not built yet. */
export const renderTopicText = (_name: string, topic: string): React.ReactNode => (
  <Text size="T300">{topic}</Text>
);
