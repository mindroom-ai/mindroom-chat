import { MsgType, type IContent, type MatrixClient } from 'matrix-js-sdk';
import {
  IEncryptedFile,
  IImageInfo,
  IThumbnailInfo,
  IVideoInfo,
  MATRIX_AUDIO_DETAILS_PROPERTY_NAME,
  MATRIX_AUDIO_DETAILS_UNSTABLE_PROPERTY_NAME,
  MATRIX_VOICE_MESSAGE_PROPERTY_NAME,
  MATRIX_VOICE_MESSAGE_UNSTABLE_PROPERTY_NAME,
} from '../../../types/matrix/common';
import type { TUploadItem } from '../../state/room/roomInputDrafts';
import { normalizeOptionalMatrixWaveform } from '../../utils/audioWaveform';
import { encodeBlurHash } from '../../utils/blurHash';
import { getThumbnail, loadImageElement, loadVideoElement } from '../../utils/dom';
import { encryptFile, getImageInfo, getVideoInfo } from '../../utils/matrix';

// Builds `m.room.message` content for an uploaded attachment. `mxc` is the
// content URI of the uploaded (possibly encrypted) file; in an encrypted room
// the item carries `encInfo` and the URI goes into `file` instead of `url`.

const THUMBNAIL_MAX_SIZE = 800;
const BLURHASH_PROPERTY = 'xyz.amorgan.blurhash';

type VoiceMessageMetadata = {
  duration: number;
  waveform?: number[];
};

type AudioMsgContentOptions = {
  /** Replaces the voice message mimetype, for bridges that only accept certain codecs. */
  voiceMessageMimeTypeOverride?: string;
};

const fileName = (item: TUploadItem): string => {
  const { originalFile } = item;
  return originalFile instanceof File ? originalFile.name : 'file';
};

const getVoiceMessage = (item: TUploadItem): VoiceMessageMetadata | undefined => {
  const { voiceMessage } = item.metadata as { voiceMessage?: VoiceMessageMetadata };
  return typeof voiceMessage?.duration === 'number' ? voiceMessage : undefined;
};

const withFileSource = (content: IContent, item: TUploadItem, mxc: string): IContent => {
  if (item.encInfo) {
    const file: IEncryptedFile = { ...(item.encInfo as Omit<IEncryptedFile, 'url'>), url: mxc };
    return { ...content, file };
  }
  return { ...content, url: mxc };
};

const withSpoiler = (content: IContent, item: TUploadItem): IContent =>
  item.metadata.markedAsSpoiler
    ? { ...content, 'page.codeberg.everypizza.msc4193.spoiler': true }
    : content;

/** Uploads a thumbnail, encrypted when the attachment is, and returns its info fields. */
const uploadThumbnail = async (
  mx: MatrixClient,
  item: TUploadItem,
  source: HTMLImageElement | HTMLVideoElement,
  width: number,
  height: number
): Promise<Partial<IImageInfo>> => {
  if (!width || !height || typeof mx.uploadContent !== 'function') return {};
  const scale = Math.min(1, THUMBNAIL_MAX_SIZE / Math.max(width, height));
  const thumbWidth = Math.max(1, Math.round(width * scale));
  const thumbHeight = Math.max(1, Math.round(height * scale));
  const thumbnail = await getThumbnail(source, thumbWidth, thumbHeight);
  if (!thumbnail) return {};

  const thumbnailInfo: IThumbnailInfo = {
    w: thumbWidth,
    h: thumbHeight,
    mimetype: thumbnail.type,
    size: thumbnail.size,
  };

  if (item.encInfo) {
    const encrypted = await encryptFile(thumbnail);
    const { content_uri: contentUri } = await mx.uploadContent(encrypted.file);
    return {
      thumbnail_info: thumbnailInfo,
      thumbnail_file: {
        ...(encrypted.encInfo as unknown as Omit<IEncryptedFile, 'url'>),
        url: contentUri,
      },
    };
  }
  const { content_uri: contentUri } = await mx.uploadContent(thumbnail);
  return { thumbnail_url: contentUri, thumbnail_info: thumbnailInfo };
};

/** Image and video builders share one signature: the uploaded item and where its bytes live. */
type MediaContentBuilder = (mx: MatrixClient, item: TUploadItem, mxc: string) => Promise<IContent>;

/** Assembles the message of an uploaded image or video from its measured `info`. */
const mediaMsgContent = (
  msgtype: MsgType.Image | MsgType.Video,
  info: IImageInfo | IVideoInfo,
  item: TUploadItem,
  mxc: string
): IContent => {
  const name = fileName(item);
  const content: IContent = { msgtype, filename: name, body: name, info };
  return withSpoiler(withFileSource(content, item, mxc), item);
};

/** Image content with its size, dimensions, and blurhash when the browser can decode it. */
export const getImageMsgContent: MediaContentBuilder = async (_mx, item, mxc) => {
  const { originalFile } = item;
  let info: IImageInfo = { mimetype: originalFile.type, size: originalFile.size };
  const objectUrl = URL.createObjectURL(originalFile);
  try {
    const img = await loadImageElement(objectUrl);
    info = getImageInfo(img, originalFile);
    const blurHash = encodeBlurHash(img);
    if (blurHash) info[BLURHASH_PROPERTY] = blurHash;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Could not read image metadata for upload', error);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  return mediaMsgContent(MsgType.Image, info, item, mxc);
};

/** Video content with metadata, a blurhash, and an uploaded poster thumbnail when possible. */
export const getVideoMsgContent: MediaContentBuilder = async (mx, item, mxc) => {
  const { originalFile } = item;
  let info: IVideoInfo = { mimetype: originalFile.type, size: originalFile.size };
  const objectUrl = URL.createObjectURL(originalFile);
  try {
    const video = await loadVideoElement(objectUrl);
    info = getVideoInfo(video, originalFile);
    const blurHash = encodeBlurHash(video);
    if (blurHash) info[BLURHASH_PROPERTY] = blurHash;
    try {
      Object.assign(
        info,
        await uploadThumbnail(mx, item, video, video.videoWidth, video.videoHeight)
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Could not upload video thumbnail', error);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Could not read video metadata for upload', error);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  return mediaMsgContent(MsgType.Video, info, item, mxc);
};

export const getAudioMsgContent = (
  item: TUploadItem,
  mxc: string,
  options: AudioMsgContentOptions = {}
): IContent => {
  const { originalFile } = item;
  const name = fileName(item);
  const voiceMessage = getVoiceMessage(item);

  const mimetype =
    voiceMessage && options.voiceMessageMimeTypeOverride
      ? options.voiceMessageMimeTypeOverride
      : originalFile.type;

  let content: IContent = {
    msgtype: MsgType.Audio,
    filename: name,
    body: name,
    info: {
      mimetype,
      size: originalFile.size,
      ...(voiceMessage ? { duration: voiceMessage.duration } : {}),
    },
  };

  if (voiceMessage) {
    const waveform = normalizeOptionalMatrixWaveform(voiceMessage.waveform);
    const audioDetails = {
      duration: voiceMessage.duration,
      ...(waveform ? { waveform } : {}),
    };
    content = {
      ...content,
      [MATRIX_VOICE_MESSAGE_UNSTABLE_PROPERTY_NAME]: {},
      [MATRIX_VOICE_MESSAGE_PROPERTY_NAME]: {},
      [MATRIX_AUDIO_DETAILS_UNSTABLE_PROPERTY_NAME]: audioDetails,
      [MATRIX_AUDIO_DETAILS_PROPERTY_NAME]: audioDetails,
    };
  }

  return withFileSource(content, item, mxc);
};

export const getFileMsgContent = (item: TUploadItem, mxc: string): IContent => {
  const { originalFile } = item;
  const name = fileName(item);
  const content: IContent = {
    msgtype: MsgType.File,
    filename: name,
    body: name,
    info: {
      mimetype: originalFile.type,
      size: originalFile.size,
    },
  };
  return withFileSource(content, item, mxc);
};
