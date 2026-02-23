import { IEncryptedFile } from '../../../types/matrix/common';
import { AI_RUN_METADATA_KEY } from './mindroomAiRun';

const LONG_TEXT_TAG = 'io.mindroom.long_text';
const LONG_TEXT_V2_ENCODING = 'matrix_event_content_json';

const mindroomLongTextHydrationCache = new Map<string, Record<string, unknown>>();

export type MindroomLongTextSource = {
  previewContent: Record<string, unknown>;
  mxcUri: string;
  encryptedFile?: IEncryptedFile;
  isV2ContentJson: boolean;
};

export type MindroomLongTextSidecarTextLoader = (source: MindroomLongTextSource) => Promise<string>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isMxc = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('mxc://');

const asEncryptedFile = (value: unknown): IEncryptedFile | undefined => {
  if (!isRecord(value) || !isMxc(value.url)) return undefined;
  return value as IEncryptedFile;
};

const isMindroomLongTextV2Meta = (meta: unknown): boolean =>
  isRecord(meta) && meta.version === 2 && meta.encoding === LONG_TEXT_V2_ENCODING;

const getLongTextCandidates = (content: Record<string, unknown>): Record<string, unknown>[] => {
  const newContent = isRecord(content['m.new_content'])
    ? (content['m.new_content'] as Record<string, unknown>)
    : undefined;
  return newContent ? [newContent, content] : [content];
};

const getLongTextSourceFromCandidate = (
  previewContent: Record<string, unknown>
): MindroomLongTextSource | undefined => {
  const meta = previewContent[LONG_TEXT_TAG];
  if (!isMindroomLongTextV2Meta(meta)) return undefined;

  const encryptedFile = asEncryptedFile(previewContent.file);
  const mxcUri = encryptedFile?.url ?? (isMxc(previewContent.url) ? previewContent.url : undefined);

  if (!mxcUri) return undefined;

  return {
    previewContent,
    mxcUri,
    encryptedFile,
    isV2ContentJson: true,
  };
};

export const clearMindroomLongTextHydrationCache = () => {
  mindroomLongTextHydrationCache.clear();
};

export const parseMindroomLongTextJsonSidecar = (
  rawSidecar: string
): Record<string, unknown> | undefined => {
  try {
    const parsed = JSON.parse(rawSidecar);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const normalizeHydratedMindroomContent = (
  hydratedContent: Record<string, unknown>
): Record<string, unknown> => {
  if (!isRecord(hydratedContent['m.new_content'])) return hydratedContent;

  const newContent = hydratedContent['m.new_content'] as Record<string, unknown>;
  const looksLikeMessageContent =
    typeof newContent.msgtype === 'string' ||
    typeof newContent.body === 'string' ||
    typeof newContent.formatted_body === 'string';

  if (!looksLikeMessageContent) return hydratedContent;

  const normalizedContent: Record<string, unknown> = { ...newContent };

  if (
    normalizedContent['io.mindroom.tool_trace'] === undefined &&
    hydratedContent['io.mindroom.tool_trace'] !== undefined
  ) {
    normalizedContent['io.mindroom.tool_trace'] = hydratedContent['io.mindroom.tool_trace'];
  }
  if (
    normalizedContent[AI_RUN_METADATA_KEY] === undefined &&
    hydratedContent[AI_RUN_METADATA_KEY] !== undefined
  ) {
    normalizedContent[AI_RUN_METADATA_KEY] = hydratedContent[AI_RUN_METADATA_KEY];
  }
  if (
    normalizedContent['m.mentions'] === undefined &&
    hydratedContent['m.mentions'] !== undefined
  ) {
    normalizedContent['m.mentions'] = hydratedContent['m.mentions'];
  }
  if (
    normalizedContent['com.mindroom.skip_mentions'] === undefined &&
    hydratedContent['com.mindroom.skip_mentions'] !== undefined
  ) {
    normalizedContent['com.mindroom.skip_mentions'] = hydratedContent['com.mindroom.skip_mentions'];
  }
  if (typeof normalizedContent.body !== 'string' && typeof hydratedContent.body === 'string') {
    normalizedContent.body = hydratedContent.body;
  }
  if (
    typeof normalizedContent.formatted_body !== 'string' &&
    typeof hydratedContent.formatted_body === 'string'
  ) {
    normalizedContent.formatted_body = hydratedContent.formatted_body;
  }
  if (
    typeof normalizedContent.msgtype !== 'string' &&
    typeof hydratedContent.msgtype === 'string'
  ) {
    normalizedContent.msgtype = hydratedContent.msgtype;
  }

  return normalizedContent;
};

export const getMindroomLongTextSource = (
  content: Record<string, unknown>
): MindroomLongTextSource | undefined => {
  const candidates = getLongTextCandidates(content);
  const sources = candidates.map(getLongTextSourceFromCandidate);
  return sources.find((source): source is MindroomLongTextSource => source !== undefined);
};

export const getMindroomLongTextMxcUri = (content: Record<string, unknown>): string | undefined =>
  getMindroomLongTextSource(content)?.mxcUri;

export const hydrateMindroomLongTextSource = async (
  source: MindroomLongTextSource,
  loadSidecarText: MindroomLongTextSidecarTextLoader
): Promise<Record<string, unknown>> => {
  const cached = mindroomLongTextHydrationCache.get(source.mxcUri);
  if (cached) return cached;

  try {
    const sidecarText = await loadSidecarText(source);
    const hydratedContent = parseMindroomLongTextJsonSidecar(sidecarText);
    if (!hydratedContent) return source.previewContent;
    const normalizedHydratedContent = normalizeHydratedMindroomContent(hydratedContent);
    mindroomLongTextHydrationCache.set(source.mxcUri, normalizedHydratedContent);
    return normalizedHydratedContent;
  } catch {
    return source.previewContent;
  }
};

export const hydrateMindroomLongTextContent = async (
  content: Record<string, unknown>,
  loadSidecarText: MindroomLongTextSidecarTextLoader
): Promise<Record<string, unknown>> => {
  const source = getMindroomLongTextSource(content);
  if (!source) return content;
  return hydrateMindroomLongTextSource(source, loadSidecarText);
};
