import { MsgType } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  MATRIX_AUDIO_DETAILS_PROPERTY_NAME,
  MATRIX_AUDIO_DETAILS_UNSTABLE_PROPERTY_NAME,
  MATRIX_VOICE_MESSAGE_PROPERTY_NAME,
  MATRIX_VOICE_MESSAGE_UNSTABLE_PROPERTY_NAME,
} from '../../../types/matrix/common';
import { TUploadItem } from '../../state/room/roomInputDrafts';
import { getAudioMsgContent } from './msgContent';

const createUploadItem = (file: File, duration?: number): TUploadItem => ({
  file,
  originalFile: file,
  encInfo: undefined,
  metadata: {
    markedAsSpoiler: false,
    ...(typeof duration === 'number' ? { voiceMessage: { duration } } : {}),
  },
});

describe('getAudioMsgContent', () => {
  it('builds a regular audio message', () => {
    const file = new File(['hello'], 'clip.webm', { type: 'audio/webm' });

    expect(getAudioMsgContent(createUploadItem(file), 'mxc://server/id')).toEqual({
      msgtype: MsgType.Audio,
      filename: 'clip.webm',
      body: 'clip.webm',
      info: {
        mimetype: 'audio/webm',
        size: file.size,
      },
      url: 'mxc://server/id',
    });
  });

  it('adds voice-message metadata and duration', () => {
    const file = new File(['hello'], 'voice.webm', { type: 'audio/webm' });
    const content = getAudioMsgContent(createUploadItem(file, 3210), 'mxc://server/voice');

    expect(content).toMatchObject({
      msgtype: MsgType.Audio,
      filename: 'voice.webm',
      body: 'voice.webm',
      url: 'mxc://server/voice',
      info: {
        mimetype: 'audio/webm',
        size: file.size,
        duration: 3210,
      },
      [MATRIX_VOICE_MESSAGE_UNSTABLE_PROPERTY_NAME]: {},
      [MATRIX_VOICE_MESSAGE_PROPERTY_NAME]: {},
      [MATRIX_AUDIO_DETAILS_UNSTABLE_PROPERTY_NAME]: {
        duration: 3210,
      },
      [MATRIX_AUDIO_DETAILS_PROPERTY_NAME]: {
        duration: 3210,
      },
    });
  });
});
