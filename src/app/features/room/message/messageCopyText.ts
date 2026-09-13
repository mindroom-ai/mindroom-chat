const COPY_TEXT_MSGTYPES = new Set(['m.text', 'm.notice', 'm.emote']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const asNonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

export const isCopyTextMessageContent = (content: Record<string, unknown>): boolean =>
  typeof content.msgtype === 'string' && COPY_TEXT_MSGTYPES.has(content.msgtype);

export const getMessageCopyTextBody = (
  content: Record<string, unknown>,
  originalContent: Record<string, unknown>
): string | undefined => {
  const wrapperBody = asNonEmptyString(content.body);
  if (wrapperBody) return wrapperBody;

  const newContent = isRecord(content['m.new_content'])
    ? (content['m.new_content'] as Record<string, unknown>)
    : undefined;
  const newContentBody = asNonEmptyString(newContent?.body);
  if (newContentBody) return newContentBody;

  return asNonEmptyString(originalContent.body);
};
