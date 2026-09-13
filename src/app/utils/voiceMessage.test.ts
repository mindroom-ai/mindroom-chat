import { describe, expect, it } from 'vitest';
import {
  MATRIX_AUDIO_DETAILS_PROPERTY_NAME,
  MATRIX_AUDIO_DETAILS_UNSTABLE_PROPERTY_NAME,
  MATRIX_VOICE_MESSAGE_PROPERTY_NAME,
  MATRIX_VOICE_MESSAGE_UNSTABLE_PROPERTY_NAME,
} from '../../types/matrix/common';
import {
  addVoiceMessageMetadata,
  getVoiceMessageAudioDetails,
  isVoiceMessageContent,
} from './voiceMessage';

describe('voiceMessage utils', () => {
  it('adds stable and unstable voice message metadata', () => {
    const content = addVoiceMessageMetadata(
      { msgtype: 'm.audio', body: 'voice.webm' },
      { duration: 1234 }
    ) as Record<string, unknown>;

    expect(content[MATRIX_VOICE_MESSAGE_UNSTABLE_PROPERTY_NAME]).toEqual({});
    expect(content[MATRIX_VOICE_MESSAGE_PROPERTY_NAME]).toEqual({});
    expect(content[MATRIX_AUDIO_DETAILS_UNSTABLE_PROPERTY_NAME]).toEqual({ duration: 1234 });
    expect(content[MATRIX_AUDIO_DETAILS_PROPERTY_NAME]).toEqual({ duration: 1234 });
  });

  it('detects stable and unstable voice message flags', () => {
    expect(
      isVoiceMessageContent({
        [MATRIX_VOICE_MESSAGE_UNSTABLE_PROPERTY_NAME]: {},
      })
    ).toBe(true);
    expect(
      isVoiceMessageContent({
        [MATRIX_VOICE_MESSAGE_PROPERTY_NAME]: {},
      })
    ).toBe(true);
    expect(isVoiceMessageContent({})).toBe(false);
  });

  it('returns sanitized audio details preferring stable key', () => {
    expect(
      getVoiceMessageAudioDetails({
        [MATRIX_AUDIO_DETAILS_PROPERTY_NAME]: {
          duration: 5000,
          waveform: [0, 1, 2, 'bad'],
        },
        [MATRIX_AUDIO_DETAILS_UNSTABLE_PROPERTY_NAME]: {
          duration: 2000,
        },
      })
    ).toEqual({
      duration: 5000,
      waveform: [0, 1, 2],
    });
  });
});
