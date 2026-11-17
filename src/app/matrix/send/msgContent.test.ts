import { MsgType } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  MATRIX_AUDIO_DETAILS_PROPERTY_NAME,
  MATRIX_AUDIO_DETAILS_UNSTABLE_PROPERTY_NAME,
  MATRIX_VOICE_MESSAGE_PROPERTY_NAME,
  MATRIX_VOICE_MESSAGE_UNSTABLE_PROPERTY_NAME,
} from '../types/common';
import type { TUploadItem } from '../state/upload';
import { VOICE_WAVEFORM_BAR_COUNT } from '../../lib/audioWaveform';
import { getAudioMsgContent, MEDIA_SPOILER_PROPERTY, withCurrentSpoiler } from './msgContent';

const createUploadItem = (file: File, duration?: number, waveform?: number[]): TUploadItem => ({
  file,
  originalFile: file, encInfo: undefined,
  metadata: {
    markedAsSpoiler: false,
    // A voice message is the only kind that carries a duration and a waveform.
    ...(typeof duration === 'number'
      ? { voiceMessage: { duration, ...(waveform ? { waveform } : {}) } }
      : {}),
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

  it('passes normalized voice waveform metadata through stable and unstable audio details', () => {
    const file = new File(['hello'], 'voice.webm', { type: 'audio/webm' });
    const content = getAudioMsgContent(
      createUploadItem(file, 3210, [0, 256, 2048]),
      'mxc://server/voice'
    );

    expect(content[MATRIX_AUDIO_DETAILS_UNSTABLE_PROPERTY_NAME]).toMatchObject({
      duration: 3210,
      waveform: expect.arrayContaining([0, 1024]),
    });
    expect(content[MATRIX_AUDIO_DETAILS_PROPERTY_NAME]).toMatchObject({
      duration: 3210,
      waveform: expect.arrayContaining([0, 1024]),
    });
    expect(
      (content[MATRIX_AUDIO_DETAILS_PROPERTY_NAME] as { waveform: number[] }).waveform
    ).toHaveLength(VOICE_WAVEFORM_BAR_COUNT);
  });

  it('uses voice-message mime override for bridged signal rooms', () => {
    const file = new File(['hello'], 'voice.m4a', { type: 'audio/mp4' });
    const content = getAudioMsgContent(createUploadItem(file, 3210), 'mxc://server/voice', {
      voiceMessageMimeTypeOverride: 'audio/aac',
    });

    expect(content).toMatchObject({
      info: {
        mimetype: 'audio/aac',
        size: file.size,
        duration: 3210,
      },
      [MATRIX_VOICE_MESSAGE_UNSTABLE_PROPERTY_NAME]: {},
      [MATRIX_VOICE_MESSAGE_PROPERTY_NAME]: {},
    });
  });

  it('does not override mime type for non-voice audio attachments', () => {
    const file = new File(['hello'], 'clip.m4a', { type: 'audio/mp4' });
    const content = getAudioMsgContent(createUploadItem(file), 'mxc://server/audio', {
      voiceMessageMimeTypeOverride: 'audio/aac',
    });

    expect(content).toMatchObject({
      info: {
        mimetype: 'audio/mp4',
        size: file.size,
      },
    });
  });
});

describe('withCurrentSpoiler', () => {
  const file = new File(['x'], 'photo.png', { type: 'image/png' });
  const item = createUploadItem(file);
  const spoiler = { ...item, metadata: { ...item.metadata, markedAsSpoiler: true } };

  it('sets or clears the flag of a picture or video as the item has it now', () => {
    const image = { msgtype: MsgType.Image, body: 'photo.png' };
    expect(withCurrentSpoiler(image, spoiler)).toEqual({
      ...image,
      [MEDIA_SPOILER_PROPERTY]: true,
    });
    expect(withCurrentSpoiler({ ...image, [MEDIA_SPOILER_PROPERTY]: true }, item)).toEqual(image);
    const video = { msgtype: MsgType.Video, body: 'clip.mp4' };
    expect(withCurrentSpoiler(video, spoiler)).toEqual({
      ...video,
      [MEDIA_SPOILER_PROPERTY]: true,
    });
  });

  it('leaves other content as it is', () => {
    const content = { msgtype: MsgType.File, body: 'notes.txt' };
    expect(withCurrentSpoiler(content, spoiler)).toBe(content);
  });
});
