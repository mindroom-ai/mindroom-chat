import { Text } from 'folds';
import { errorDetail } from '../utils/describeError';

type ErrorDetailProps = {
  error: unknown;
};

/**
 * The error's own text in a smaller, quieter line under the translated sentence that
 * `describeError` gives, so a server's explanation or an exception's message stays readable for
 * whoever reports or debugs it. It is usually English, so it takes its direction from its own
 * text. A span, so it fits inside the sentence's `Text`; renders nothing when there is no text.
 */
export function ErrorDetail({ error }: ErrorDetailProps) {
  const detail = errorDetail(error);
  if (detail === undefined) return null;
  return (
    <Text
      as="span"
      size="T200"
      priority="300"
      dir="auto"
      style={{ display: 'block', overflowWrap: 'anywhere' }}
    >
      {detail}
    </Text>
  );
}
