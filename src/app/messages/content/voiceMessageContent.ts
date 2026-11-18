import {
  MATRIX_VOICE_MESSAGE_PROPERTY_NAME,
  MATRIX_VOICE_MESSAGE_UNSTABLE_PROPERTY_NAME,
} from '../../matrix/types/common';

/** Whether `MAudio` draws `content` as a voice message rather than an audio file. */
export const isVoiceMessageContent = (content: Record<string, unknown>): boolean =>
  content[MATRIX_VOICE_MESSAGE_PROPERTY_NAME] !== undefined ||
  content[MATRIX_VOICE_MESSAGE_UNSTABLE_PROPERTY_NAME] !== undefined;
