import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { Descendant } from 'slate';
import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import type { IEventRelation, MatrixError, Room } from 'matrix-js-sdk';
import { createUploadAtomFamily } from '../upload';
import { TUploadContent } from '../../utils/matrix';
import { createListAtom } from '../list';

export type TUploadMetadata = {
  markedAsSpoiler: boolean;
  mindroomPasteAttachment?: {
    id: string;
    chars: number;
    fileName: string;
  };
  voiceMessage?: {
    duration: number;
    waveform?: number[];
  };
};

export type TUploadItem = {
  file: TUploadContent;
  originalFile: TUploadContent;
  metadata: TUploadMetadata;
  encInfo: EncryptedAttachmentInfo | undefined;
  prepError?: MatrixError;
};

export type TUploadListAtom = ReturnType<typeof createListAtom<TUploadItem>>;

export const roomIdToUploadItemsAtomFamily = atomFamily<string, TUploadListAtom>(createListAtom);

export const roomUploadAtomFamily = createUploadAtomFamily();

export const voiceAutoSendPendingAtom = atom(false);

export type PendingVoiceSendContext = {
  /**
   * Matrix user id of the session that captured this draft. Required so the
   * global atom cannot leak audio across an account switch — consumers must
   * ignore drafts whose ownerSessionId does not match the active session.
   */
  ownerSessionId: string;
  roomId: string;
  room: Room;
  threadId: string | undefined;
  replyDraft: IReplyDraft | undefined;
  threadingEnabled: boolean;
  signalBridgedRoom: boolean;
};

/**
 * Marker stamped on the global pending-draft atom while a retry is in flight.
 * The token survives a keyed RoomProvider remount, so a freshly mounted
 * useVoiceRecorder can see "an existing retry is in progress" and refuse to
 * surface controls (Discard / Send) that would race the still-flying request.
 * The token also lets a stale resolution avoid clobbering a different
 * caller's atom write.
 */
export type PendingVoiceSendInFlight = {
  token: string;
  startedAt: number;
};

export type PendingVoiceSendDraft = {
  file: File;
  duration: number;
  waveform?: number[];
  errorMessage?: string;
  context: PendingVoiceSendContext;
  inFlight?: PendingVoiceSendInFlight;
};

export const pendingVoiceSendDraftAtom = atom<PendingVoiceSendDraft | undefined>(undefined);

export type RoomIdToMsgAction =
  | {
      type: 'PUT';
      roomId: string;
      msg: Descendant[];
    }
  | {
      type: 'DELETE';
      roomId: string;
    };

const createMsgDraftAtom = () => atom<Descendant[]>([]);
export type TMsgDraftAtom = ReturnType<typeof createMsgDraftAtom>;
export const roomIdToMsgDraftAtomFamily = atomFamily<string, TMsgDraftAtom>(() =>
  createMsgDraftAtom()
);

export type IReplyDraft = {
  userId: string;
  eventId: string;
  body: string;
  formattedBody?: string | undefined;
  relation?: IEventRelation | undefined;
};
const createReplyDraftAtom = () => atom<IReplyDraft | undefined>(undefined);
export type TReplyDraftAtom = ReturnType<typeof createReplyDraftAtom>;
export const roomIdToReplyDraftAtomFamily = atomFamily<string, TReplyDraftAtom>(() =>
  createReplyDraftAtom()
);
