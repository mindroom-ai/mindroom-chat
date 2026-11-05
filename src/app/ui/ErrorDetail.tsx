import { Text } from 'folds';
import { errorDetail } from '../lib/describeError';

type ErrorDetailProps = {
  error: unknown;
};

/**
 * The error's own text in a smaller, quieter line under the translated sentence that
 * `describeError` gives, so a server's explanation or an exception's message stays readable for
 * whoever reports or debugs it. The line lines up with the sentence (on the right in a
 * right-to-left language); the text, usually English, keeps its own direction inside a `bdi`.
 * A span, so it fits inside the sentence's `Text`; renders nothing when there is no text.
 */
export function ErrorDetail({ error }: ErrorDetailProps) {
  const detail = errorDetail(error);
  if (detail === undefined) return null;
  return (
    <Text
      as="span"
      size="T200"
      priority="300"
      style={{ display: 'block', overflowWrap: 'anywhere' }}
    >
      <bdi>{detail}</bdi>
    </Text>
  );
}
