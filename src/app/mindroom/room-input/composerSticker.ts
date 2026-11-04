import { EventType, RelationType, type MatrixClient, type Room } from 'matrix-js-sdk';
import type { StickerEventContent } from 'matrix-js-sdk/lib/@types/events';
import {
  getGlobalImagePacks,
  getRoomImagePacks,
  getUserImagePack,
  ImagePack,
  ImageUsage,
} from '../../plugins/custom-emoji';
import type { IReplyDraft } from '../../state/room/roomInputDrafts';
import { getMessageRelation } from '../threads/composeMessageRelation';

type ImageInfo = StickerEventContent['info'];

type StickerTarget = {
  roomId: string;
  /** The open thread, if any. */
  threadId?: string;
  replyDraft?: IReplyDraft;
  /** False in classic rooms, where a reply gets no thread relation. */
  threadingEnabled: boolean;
};

/** The size and type of a sticker as its pack lists them; empty when no pack knows it. */
export const findStickerInfo = (packs: ImagePack[], mxc: string): ImageInfo => {
  const listed = packs
    .flatMap((pack) => pack.getImages(ImageUsage.Sticker))
    .find((image) => image.url === mxc)?.info;
  if (!listed) return {};
  const { w, h, mimetype, size } = listed;
  return Object.fromEntries(
    Object.entries({ w, h, mimetype, size }).filter(([, value]) => value !== undefined)
  );
};

/**
 * The `m.sticker` event for a picked sticker, in the thread and reply the composer writes to,
 * and the thread root it is sent in (null outside threads).
 */
export const composeSticker = (
  { threadId, replyDraft, threadingEnabled }: Omit<StickerTarget, 'roomId'>,
  sticker: { mxc: string; label: string; info: ImageInfo }
): { threadRootId: string | null; content: StickerEventContent } => {
  const relation = getMessageRelation(replyDraft?.eventId, replyDraft?.relation, threadId, {
    allowThreadRelation: threadingEnabled,
  });
  const content: StickerEventContent = {
    body: sticker.label,
    url: sticker.mxc,
    info: sticker.info,
  };
  if (relation) Object.assign(content, { 'm.relates_to': relation });
  const threadRootId =
    relation?.rel_type === RelationType.Thread ? relation.event_id ?? null : null;
  return { threadRootId, content };
};

/**
 * Sends the picked sticker where the composer writes, with the size its pack lists: the user's
 * own pack, the packs enabled everywhere, then those of `packRooms`.
 */
export const sendComposerSticker = (
  mx: MatrixClient,
  target: StickerTarget,
  sticker: { mxc: string; label: string },
  packRooms: Room[]
) => {
  const ownPack = getUserImagePack(mx);
  const packs = [
    ...(ownPack ? [ownPack] : []),
    ...getGlobalImagePacks(mx),
    ...packRooms.flatMap(getRoomImagePacks),
  ];
  const info = findStickerInfo(packs, sticker.mxc);
  const { threadRootId, content } = composeSticker(target, { ...sticker, info });
  return mx.sendEvent(target.roomId, threadRootId, EventType.Sticker, content);
};
