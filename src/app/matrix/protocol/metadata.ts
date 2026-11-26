const MINDROOM_MESSAGE_METADATA_PREFIXES = ['io.mindroom.', 'com.mindroom.'];

export const INLINE_MEDIA_CONTENT_KEY = 'io.mindroom.inline_media';

export const isMessageMetadataKey = (key: string): boolean =>
  MINDROOM_MESSAGE_METADATA_PREFIXES.some((prefix) => key.startsWith(prefix));
