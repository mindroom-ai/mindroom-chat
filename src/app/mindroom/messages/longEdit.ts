import { MsgType } from 'matrix-js-sdk';
import type { IContent, IEventRelation, MatrixClient, Room } from 'matrix-js-sdk';
import {
  buildMindroomLongTextPreview,
  contentBytes,
  getMindroomLongTextSource,
  MAX_EVENT_CONTENT_BYTES,
  MindroomLongTextSource,
} from './longText';
import { uploadMindroomLongTextSidecar } from './longTextSidecarUpload';

// What makes an `m.file` fallback valid on its own.
const FILE_FALLBACK_KEYS = ['url', 'file', 'filename', 'info'];

/**
 * The edit event for new content. One that does not fit one event uploads the new content as a
 * long-text sidecar and replaces the message with its preview, as MindRoom's backend wraps its own
 * large edits: the fallback keeps the message's type, and a long-text file stays a valid file.
 */
export const buildMindroomEditContent = async (
  mx: MatrixClient,
  room: Room,
  originalMsgType: string | undefined,
  newContent: IContent,
  relation: IEventRelation
): Promise<IContent> => {
  const edit: IContent = {
    ...newContent,
    body: `* ${newContent.body}`,
    'm.new_content': newContent,
    'm.relates_to': relation,
  };
  if (contentBytes(edit) <= MAX_EVENT_CONTENT_BYTES) return edit;

  const replacement = await uploadMindroomLongTextSidecar(
    mx,
    room,
    newContent,
    buildMindroomLongTextPreview(newContent)
  );
  const keepFile = originalMsgType === MsgType.File;
  return {
    msgtype: keepFile ? MsgType.File : originalMsgType,
    body: `* ${replacement.body}`,
    ...(newContent['m.mentions'] === undefined ? {} : { 'm.mentions': newContent['m.mentions'] }),
    ...(keepFile
      ? Object.fromEntries(
          FILE_FALLBACK_KEYS.filter((key) => key in replacement).map((key) => [
            key,
            replacement[key],
          ])
        )
      : {}),
    'm.new_content': replacement,
    'm.relates_to': relation,
  };
};

/**
 * The content to edit: a message sent as a long-text sidecar is edited from its whole content, so
 * `undefined` when that cannot be loaded, because saving its preview would cut the message.
 */
export const loadMindroomEditableContent = async (
  content: Record<string, unknown>,
  hydrate: (source: MindroomLongTextSource) => Promise<Record<string, unknown>>
): Promise<Record<string, unknown> | undefined> => {
  const source = getMindroomLongTextSource(content);
  if (!source) return content;
  const whole = await hydrate(source);
  return whole === source.previewContent ? undefined : whole;
};
