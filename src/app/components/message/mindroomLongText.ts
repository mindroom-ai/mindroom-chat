import { IEncryptedFile } from '../../../types/matrix/common';

const LONG_TEXT_TAG = 'io.mindroom.long_text';
const MINDROOM_TAG_REG = /<(tool|tool-group|think|debug|system|plan|analysis|research)\b/i;

const isMxc = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('mxc://');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getMindroomLongTextMetaMxcUri = (meta: unknown): string | undefined => {
  if (isMxc(meta)) return meta;
  if (!isRecord(meta)) return undefined;

  const candidates = [
    meta.mxc_uri,
    meta.mxc,
    meta.uri,
    meta.url,
    meta.content_uri,
  ];

  return candidates.find(isMxc);
};

const getMindroomAttachmentFilename = (content: Record<string, unknown>): string | undefined => {
  if (typeof content.filename === 'string') return content.filename;
  if (
    typeof content.body === 'string' &&
    !content.body.includes('\n') &&
    content.body.length > 0 &&
    content.body.length < 256
  ) {
    return content.body;
  }
  return undefined;
};

const getEncryptedFileInfo = (content: Record<string, unknown>): IEncryptedFile | undefined => {
  const fileInfo = content.file;
  if (!isRecord(fileInfo) || !isMxc(fileInfo.url)) return undefined;
  return fileInfo as unknown as IEncryptedFile;
};

type EncryptedFileWithMimeType = IEncryptedFile & {
  mimetype?: string;
};

const getAttachmentMimeType = (
  content: Record<string, unknown>,
  encInfo?: IEncryptedFile
): string | undefined => {
  const { info } = content;
  if (isRecord(info) && typeof info.mimetype === 'string') {
    return info.mimetype;
  }

  if (encInfo) {
    const { mimetype: encMimeType } = encInfo as EncryptedFileWithMimeType;
    if (typeof encMimeType === 'string') return encMimeType;
  }

  return undefined;
};

const isHtmlMimeType = (mimeType: string | undefined): boolean =>
  typeof mimeType === 'string' && mimeType.split(';')[0].trim().toLowerCase() === 'text/html';

const isHtmlFilename = (filename: string | undefined): boolean =>
  typeof filename === 'string' && /\.(html?|xhtml)$/i.test(filename);

export type MindroomLongTextSource = {
  mxcUri: string;
  encInfo?: IEncryptedFile;
  mimeType?: string;
  filename?: string;
  isHtml: boolean;
};

export const getMindroomLongTextSource = (
  content: Record<string, unknown>
): MindroomLongTextSource | undefined => {
  if (!(LONG_TEXT_TAG in content)) return undefined;

  const encInfo = getEncryptedFileInfo(content);
  const mxcUri =
    getMindroomLongTextMetaMxcUri(content[LONG_TEXT_TAG]) ??
    (isMxc(content.url) ? content.url : undefined) ??
    encInfo?.url;

  if (!mxcUri) return undefined;

  const filename = getMindroomAttachmentFilename(content);
  const mimeType = getAttachmentMimeType(content, encInfo);

  return {
    mxcUri,
    encInfo,
    mimeType,
    filename,
    isHtml: isHtmlMimeType(mimeType) || isHtmlFilename(filename),
  };
};

export const getMindroomLongTextMxcUri = (content: Record<string, unknown>): string | undefined =>
  getMindroomLongTextSource(content)?.mxcUri;

export const getMindroomLongTextFormattedBody = (text: string): string | undefined =>
  MINDROOM_TAG_REG.test(text) ? text : undefined;

type ResolveMindroomLongTextContentOptions = {
  isHtml?: boolean;
};

export const resolveMindroomLongTextContent = (
  content: Record<string, unknown>,
  fullText: string | undefined,
  options: ResolveMindroomLongTextContentOptions = {}
): Record<string, unknown> => {
  if (typeof fullText !== 'string') return content;
  if (options.isHtml) {
    return {
      ...content,
      body: typeof content.body === 'string' ? content.body : fullText,
      format: 'org.matrix.custom.html',
      formatted_body: fullText,
    };
  }

  const fullTextFormattedBody = getMindroomLongTextFormattedBody(fullText);
  return {
    ...content,
    body: fullText,
    formatted_body:
      typeof fullTextFormattedBody === 'string' ? fullTextFormattedBody : content.formatted_body,
  };
};
