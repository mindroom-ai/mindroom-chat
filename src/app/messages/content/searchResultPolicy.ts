import { hasLongTextMetadata } from '../../matrix/protocol/longText';

export const shouldUseLongTextSearchResultBody = (
  content: Record<string, unknown>
): boolean => hasLongTextMetadata(content);
