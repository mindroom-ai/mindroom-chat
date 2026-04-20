const COPY_TEXT_MSGTYPES = new Set(['m.text', 'm.notice', 'm.emote']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const asNonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

export const isCopyTextMessageContent = (content: Record<string, unknown>): boolean =>
  typeof content.msgtype === 'string' && COPY_TEXT_MSGTYPES.has(content.msgtype);

export const getMessageCopyTextBody = (
  content: Record<string, unknown>,
  originalContent: Record<string, unknown>,
  resolvedLongTextContent?: Record<string, unknown>
): string | undefined => {
  const readBody = (value: Record<string, unknown> | undefined): string | undefined =>
    asNonEmptyString(value?.body);

  if (resolvedLongTextContent) {
    const resolvedBody = readBody(resolvedLongTextContent);
    if (resolvedBody) return resolvedBody;

    const resolvedNewContent = isRecord(resolvedLongTextContent['m.new_content'])
      ? (resolvedLongTextContent['m.new_content'] as Record<string, unknown>)
      : undefined;
    const resolvedNewContentBody = readBody(resolvedNewContent);
    if (resolvedNewContentBody) return resolvedNewContentBody;
  }

  const wrapperBody = readBody(content);
  if (wrapperBody) return wrapperBody;

  const newContent = isRecord(content['m.new_content'])
    ? (content['m.new_content'] as Record<string, unknown>)
    : undefined;
  const newContentBody = readBody(newContent);
  if (newContentBody) return newContentBody;

  return readBody(originalContent);
};
