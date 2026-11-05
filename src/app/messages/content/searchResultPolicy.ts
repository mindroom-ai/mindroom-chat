import { hasMindroomLongTextMetadata } from '../../matrix/protocol/longText';

export const shouldUseMindroomLightweightSearchResultBody = (
  content: Record<string, unknown>
): boolean => hasMindroomLongTextMetadata(content);
