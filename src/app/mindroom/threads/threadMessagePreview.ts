import { MsgType } from 'matrix-js-sdk';
import { trimReplyFromBody } from '../../utils/room';
import { isVoiceMessageContent } from '../../utils/voiceMessage';

export const VOICE_MESSAGE_PREVIEW_TEXT = 'Voice message';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const normalizeBodyPreview = (body: unknown): string | undefined => {
  if (typeof body !== 'string') return undefined;

  const normalized = trimReplyFromBody(body).replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : undefined;
};

const getMediaFallbackPreviewText = (content: Record<string, unknown>): string | undefined => {
  switch (content.msgtype) {
    case MsgType.Audio:
      return isVoiceMessageContent(content) ? VOICE_MESSAGE_PREVIEW_TEXT : 'Audio';
    case MsgType.Image:
      return 'Image';
    case MsgType.Video:
      return 'Video';
    case MsgType.File:
      return 'File';
    default:
      return undefined;
  }
};

export const getThreadMessagePreviewText = (
  content: Record<string, unknown> | null | undefined
): string | undefined => {
  if (!content || !isRecord(content)) return undefined;

  const newContent = isRecord(content['m.new_content'])
    ? (content['m.new_content'] as Record<string, unknown>)
    : undefined;
  const previewContent = newContent ? { ...content, ...newContent } : content;

  if (previewContent.msgtype === MsgType.Audio && isVoiceMessageContent(previewContent)) {
    return VOICE_MESSAGE_PREVIEW_TEXT;
  }

  const bodyPreview = normalizeBodyPreview(previewContent.body);
  if (bodyPreview) return bodyPreview;

  return getMediaFallbackPreviewText(previewContent);
};
