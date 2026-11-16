import { createContext } from 'react';
import { MsgType, type MatrixEvent } from 'matrix-js-sdk';
import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import type { IImageInfo } from '../../matrix/types/common';
import {
  getEventAttachmentOwner,
  type EventAttachmentOwner,
} from '../../matrix/protocol/eventAttachments';
import { MEDIA_SPOILER_PROPERTY } from '../../matrix/send/msgContent';
import { readImageAttachment } from './MsgTypeRenderers';

/** One picture the image viewer can page to: an `m.image` event the timeline shows as an image. */
export type ImageSlide = {
  eventId: string;
  body: string;
  url: string;
  mimeType: string;
  info: IImageInfo;
  encInfo?: EncryptedAttachmentInfo;
  owner?: EventAttachmentOwner;
};

/**
 * The open conversation's pictures, read when the viewer opens and on each step. Without one
 * (search results, pins, a sub-agent's view), the viewer shows only the picture it opened on.
 */
export const ImageSlidesContext = createContext<(() => readonly ImageSlide[]) | undefined>(
  undefined
);

/**
 * The pictures among `events`, in their order, as the timeline shows them (`getContent` gives a
 * row's shown content, its newest edit's). Left out: stickers, redacted and undecrypted events,
 * spoilers, rows `isHidden` hides, and images the timeline shows as a file row.
 */
export const buildImageSlides = (
  events: readonly MatrixEvent[],
  getContent: (event: MatrixEvent) => Record<string, unknown>,
  isHidden: (event: MatrixEvent) => boolean
): ImageSlide[] =>
  events.flatMap((event): ImageSlide[] => {
    const eventId = event.getId();
    if (!eventId || event.getType() !== 'm.room.message' || event.isRedacted()) return [];
    if (event.isDecryptionFailure()) return [];
    const content = getContent(event);
    if (content.msgtype !== MsgType.Image || content[MEDIA_SPOILER_PROPERTY] === true) return [];
    const image = readImageAttachment(content);
    if (!image || image === 'file' || isHidden(event)) return [];
    return [{ eventId, ...image, owner: getEventAttachmentOwner(event) }];
  });
