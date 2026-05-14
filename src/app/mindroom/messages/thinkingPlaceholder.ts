export const MINDROOM_THINKING_PLACEHOLDER_BODY = 'Thinking...';

export const MINDROOM_THINKING_PLACEHOLDER_MESSAGES = [
  'Making progress',
  'Almost there',
  'Boosting the GPUs',
  'Checking the thread',
  'Composing the reply',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const getMindroomThinkingPlaceholderBody = (
  content: Record<string, unknown>
): string | undefined => {
  const newContent = isRecord(content['m.new_content'])
    ? (content['m.new_content'] as Record<string, unknown>)
    : undefined;
  const body = newContent?.body ?? content.body;
  return typeof body === 'string' ? body : undefined;
};

export const isMindroomThinkingPlaceholderBody = (content: Record<string, unknown>): boolean =>
  getMindroomThinkingPlaceholderBody(content) === MINDROOM_THINKING_PLACEHOLDER_BODY;
