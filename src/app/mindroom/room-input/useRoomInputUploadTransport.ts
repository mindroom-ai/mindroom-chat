import { useCallback, useMemo } from 'react';
import type { createStore } from 'jotai';
import type { IContent, MatrixClient, Room, UploadResponse } from 'matrix-js-sdk';
import { getAudioMsgContent } from '../../features/room/msgContent';
import {
  roomIdToUploadItemsAtomFamily,
  roomUploadAtomFamily,
  type TUploadItem,
} from '../../state/room/roomInputDrafts';
import { UploadStatus } from '../../state/upload';
import { toMatrixUploadError, uploadContent } from '../../utils/matrix';
import {
  getMindroomRoomInputVoiceUploadRelation,
  type MindroomVoiceSendContext,
} from './RoomInputMindroomExtensions';
import { createMindroomRoomUploadItems } from './roomInputUploadPreparation';

/**
 * How the composer moves files to the homeserver: preparing voice recordings as upload items,
 * uploading an item through its upload atom (so its card shows progress), and sending a voice
 * message. A send that fails drops its unsent local echo; the recorder keeps the recording.
 */
type Store = ReturnType<typeof createStore>;

export const useRoomInputUploadTransport = (mx: MatrixClient, store: Store, room: Room) => {
  const createVoiceUploadItems = useCallback(
    (file: File, duration: number, waveform: number[] | undefined, targetRoom: Room = room) =>
      createMindroomRoomUploadItems([file], targetRoom, () => ({
        markedAsSpoiler: false,
        voiceMessage: { duration, waveform },
      })),
    [room]
  );

  /** Uploads `item.file`, or reuses a finished upload of it; resolves with its `mxc://` URI. */
  const uploadItem = useCallback(
    async (item: TUploadItem): Promise<string> => {
      if (item.prepError) throw item.prepError;
      const uploadAtom = roomUploadAtomFamily(item.file);
      const current = store.get(uploadAtom);
      if (current.status === UploadStatus.Success) return current.mxc;
      if (current.status === UploadStatus.Loading) {
        const { content_uri: mxc } = await current.promise;
        if (mxc) return mxc;
      }
      return new Promise<string>((resolve, reject) => {
        uploadContent(mx, item.file, {
          name: item.originalFile.name,
          fileType: item.originalFile.type || undefined,
          hideFilename: !!item.encInfo,
          onPromise: (promise) =>
            store.set(uploadAtom, { promise: promise as Promise<UploadResponse> }),
          onProgress: (progress) => store.set(uploadAtom, { progress }),
          onSuccess: (mxc) => {
            store.set(uploadAtom, { mxc });
            resolve(mxc);
          },
          onError: (error) => {
            const uploadError = toMatrixUploadError(error, 'upload');
            store.set(uploadAtom, { error: uploadError });
            reject(uploadError);
          },
        }).catch(reject);
      });
    },
    [mx, store]
  );

  /**
   * Uploads an item only while it is still staged in `roomId`'s composer; undefined when it was
   * removed meanwhile or its upload failed.
   */
  const uploadItemWhileStaged = useCallback(
    async (roomId: string, item: TUploadItem): Promise<TUploadItem | undefined> => {
      const staged = () =>
        store.get(roomIdToUploadItemsAtomFamily(roomId)).some((entry) => entry.file === item.file);
      if (!staged()) return undefined;
      try {
        await uploadItem(item);
      } catch {
        return undefined;
      }
      return staged() ? item : undefined;
    },
    [store, uploadItem]
  );

  const sendVoiceItem = useCallback(
    async (context: MindroomVoiceSendContext, item: TUploadItem, mxc: string): Promise<string> => {
      const content: IContent = getAudioMsgContent(item, mxc);
      const relation = getMindroomRoomInputVoiceUploadRelation(context, item.file);
      if (relation) content['m.relates_to'] = relation;
      const txnId = mx.makeTxnId();
      try {
        const { event_id: eventId } = await mx.sendMessage(context.roomId, content as never, txnId);
        return eventId;
      } catch (error) {
        // The recorder keeps the recording for a retry; its failed echo must not stay behind.
        const echo = context.room.getEventForTxnId(txnId);
        if (echo) mx.cancelPendingEvent(echo);
        throw error;
      }
    },
    [mx]
  );

  return useMemo(
    () => ({ createVoiceUploadItems, uploadItem, uploadItemWhileStaged, sendVoiceItem }),
    [createVoiceUploadItems, sendVoiceItem, uploadItem, uploadItemWhileStaged]
  );
};
