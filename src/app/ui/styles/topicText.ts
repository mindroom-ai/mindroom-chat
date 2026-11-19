import type { CSSProperties } from 'react';

/** A room topic as its members wrote it: paragraphs and line breaks kept, long links wrapped. */
export const TOPIC_TEXT_STYLE: CSSProperties = {
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
};
