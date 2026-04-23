import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { MatrixClient, MsgType } from 'matrix-js-sdk';
import { IImageContent, IVideoContent } from '../../../types/matrix/common';
import { MessageEvent } from '../../../types/matrix/room';
import { FALLBACK_MIMETYPE } from '../../utils/mimeTypes';
import { decryptFile, downloadEncryptedMedia, mxcUrlToHttp } from '../../utils/matrix';

type ThreadImagePreloadDescriptor = {
  key: string;
  kind: 'image';
  mxcUrl: string;
  mimeType: string;
  encInfo?: EncryptedAttachmentInfo;
};

type ThreadVideoThumbnailPreloadDescriptor = {
  key: string;
  kind: 'video-thumbnail';
  mxcUrl: string;
  mimeType: string;
  encInfo?: EncryptedAttachmentInfo;
};

export type ThreadMediaPreloadDescriptor =
  | ThreadImagePreloadDescriptor
  | ThreadVideoThumbnailPreloadDescriptor;

const preloadImageUrl = (src: string): Promise<string> =>
  new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') {
      resolve(src);
      return;
    }

    const image = new Image();
    image.onload = () => resolve(src);
    image.onerror = (error) => reject(error);
    image.src = src;
  });

export const getThreadMediaPreloadDescriptor = (
  eventType: string,
  content: Record<string, unknown>
): ThreadMediaPreloadDescriptor | undefined => {
  if (eventType === MessageEvent.Sticker || content.msgtype === MsgType.Image) {
    const imageContent = content as Partial<IImageContent>;
    const mxcUrl =
      typeof imageContent.file?.url === 'string'
        ? imageContent.file.url
        : typeof imageContent.url === 'string'
          ? imageContent.url
          : undefined;
    if (!mxcUrl) return undefined;

    return {
      key: `image:${mxcUrl}`,
      kind: 'image',
      mxcUrl,
      mimeType: imageContent.info?.mimetype ?? FALLBACK_MIMETYPE,
      encInfo: imageContent.file as EncryptedAttachmentInfo | undefined,
    };
  }

  if (content.msgtype === MsgType.Video) {
    const videoContent = content as Partial<IVideoContent>;
    const thumbInfo = videoContent.info?.thumbnail_info;
    const thumbMxcUrl =
      typeof videoContent.info?.thumbnail_file?.url === 'string'
        ? videoContent.info.thumbnail_file.url
        : typeof videoContent.info?.thumbnail_url === 'string'
          ? videoContent.info.thumbnail_url
          : undefined;
    if (!thumbMxcUrl || typeof thumbInfo?.mimetype !== 'string') return undefined;

    return {
      key: `video-thumbnail:${thumbMxcUrl}`,
      kind: 'video-thumbnail',
      mxcUrl: thumbMxcUrl,
      mimeType: thumbInfo.mimetype,
      encInfo: videoContent.info?.thumbnail_file as EncryptedAttachmentInfo | undefined,
    };
  }

  return undefined;
};

export const preloadThreadMediaDescriptor = async (
  mx: MatrixClient,
  useAuthentication: boolean,
  descriptor: ThreadMediaPreloadDescriptor
): Promise<string> => {
  const mediaUrl = mxcUrlToHttp(mx, descriptor.mxcUrl, useAuthentication);
  if (!mediaUrl) {
    throw new Error('Invalid media URL');
  }

  if (descriptor.encInfo) {
    const fileContent = await downloadEncryptedMedia(mediaUrl, (encBuf) =>
      decryptFile(encBuf, descriptor.mimeType, descriptor.encInfo as EncryptedAttachmentInfo)
    );
    return URL.createObjectURL(fileContent);
  }

  return preloadImageUrl(mediaUrl);
};

export const clearThreadMediaPreloadCache = (cache: Map<string, string>): void => {
  cache.forEach((src) => {
    if (src.startsWith('blob:')) {
      URL.revokeObjectURL(src);
    }
  });
  cache.clear();
};
