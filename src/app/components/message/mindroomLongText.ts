const LONG_TEXT_TAG = 'io.mindroom.long_text';
const MINDROOM_TAG_REG = /<(tool|tool-group|think|debug|system|plan|analysis|research)\b/i;

const isMxc = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('mxc://');

export const getMindroomLongTextMxcUri = (content: Record<string, unknown>): string | undefined => {
  const meta = content[LONG_TEXT_TAG];
  if (isMxc(meta)) return meta;
  if (!meta || typeof meta !== 'object') return undefined;

  const objectMeta = meta as Record<string, unknown>;
  const candidates = [
    objectMeta.mxc_uri,
    objectMeta.mxc,
    objectMeta.uri,
    objectMeta.url,
    objectMeta.content_uri,
  ];

  return candidates.find(isMxc);
};

export const getMindroomLongTextFormattedBody = (text: string): string | undefined =>
  MINDROOM_TAG_REG.test(text) ? text : undefined;

export const resolveMindroomLongTextContent = (
  content: Record<string, unknown>,
  fullText: string | undefined
): Record<string, unknown> => {
  if (typeof fullText !== 'string') return content;
  const fullTextFormattedBody = getMindroomLongTextFormattedBody(fullText);
  return {
    ...content,
    body: fullText,
    // Drop preview HTML when fetched content is plain text so the renderer shows the full body.
    formatted_body: typeof fullTextFormattedBody === 'string' ? fullTextFormattedBody : undefined,
  };
};
