import { Text } from 'folds';
import { MessageBrokenContent } from './FallbackContent';

/** A message whose content could not be read, in the message body's place. */
export function BrokenContent() {
  return (
    <Text as="div" size="T400">
      <MessageBrokenContent />
    </Text>
  );
}
