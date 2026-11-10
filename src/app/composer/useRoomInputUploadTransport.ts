import { useCallback, useMemo } from 'react';
import type { createStore } from 'jotai';
import type { IContent, MatrixClient, Room } from 'matrix-js-sdk';
import { getAudioMsgContent } from '../matrix/send/msgContent';
import {
  type PendingVoiceSendContext,
  type StagedList,
  roomUploadAtomFamily,
} from './roomInputDrafts';
import { type TUploadItem, UploadStatus } from '../matrix/state/upload';
import { toMatrixUploadError, uploadContent } from '../matrix/matrix';
import { getRoomInputVoiceUploadRelation } from './RoomInputExtensions';
import { createRoomUploadItems } from '../matrix/send/roomInputUploadPreparation';

type Store = ReturnType<typeof createStore>;

/** Signal only plays voice messages in a codec it knows; the bridge converts the rest. */
export const getVoiceMessageContentOptions = (
  signalBridgedRoom: boolean
): Parameters<typeof getAudioMsgContent>[2] =>
  signalBridgedRoom ? { voiceMessageMimeTypeOverride: 'audio/aac' } : {};

/**
 * How the composer moves files to the homeserver: preparing voice recordings as upload items,
 * uploading an item through its upload atom (so its card shows progress), and sending a voice
 * message. A send that fails drops its unsent local echo; the recorder keeps the recording.
 */

export const useRoomInputUploadTransport = (mx: MatrixClient, store: Store, room: Room) => {
  // A recording that cannot be prepared (encrypted) fails at once; the recorder keeps it to retry.
  const createVoiceUploadItems = useCallback(
    async (
      file: File,
      duration: number,
      waveform: number[] | undefined,
      targetRoom: Room = room
    ): Promise<TUploadItem[]> => {
      const items = await createRoomUploadItems([file], targetRoom, () => ({
        markedAsSpoiler: false,
        voiceMessage: { duration, waveform },
      }));
      const failed = items.find((item) => item.prepError);
      if (failed?.prepError) throw failed.prepError;
      return items;
    },
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
        // The atom follows the request so the item's card shows progress and the outcome.
        const settle = (outcome: { mxc: string } | { failure: unknown }) => {
          if ('mxc' in outcome) {
            store.set(uploadAtom, { mxc: outcome.mxc });
            resolve(outcome.mxc);
            return;
          }
          const error = toMatrixUploadError(outcome.failure, 'upload');
          store.set(uploadAtom, { error });
          reject(error);
        };
        const { file, originalFile, encInfo } = item;
        uploadContent(mx, file, {
          hideFilename: encInfo !== undefined,
          fileType: originalFile.type || undefined,
          name: originalFile.name,
          onPromise: (request) => store.set(uploadAtom, { promise: request }),
          onProgress: (progress) => store.set(uploadAtom, { progress }),
          onError: (failure) => settle({ failure }),
          onSuccess: (mxc) => settle({ mxc }),
        }).catch(reject);
      });
    },
    [mx, store]
  );

  /**
   * Uploads an item only while it is still staged in `listAtom`; undefined when it was removed
   * meanwhile or its upload failed.
   */
  const uploadItemWhileStaged = useCallback(
    async (listAtom: StagedList, item: TUploadItem): Promise<TUploadItem | undefined> => {
      const staged = () => store.get(listAtom).some((entry) => entry.file === item.file);
      if (!staged()) return undefined;
      // Removing the file from the composer ends the wait, even for an upload that never settles.
      let unsubscribe = () => {};
      const removed = new Promise<undefined>((resolve) => {
        unsubscribe = store.sub(listAtom, () => {
          if (!staged()) resolve(undefined);
        });
      });
      try {
        const uploaded = await Promise.race([
          uploadItem(item).then(
            () => item,
            () => undefined
          ),
          removed,
        ]);
        return uploaded && staged() ? uploaded : undefined;
      } finally {
        unsubscribe();
      }
    },
    [store, uploadItem]
  );

  const sendVoiceItem = useCallback(
    async (context: PendingVoiceSendContext, item: TUploadItem, mxc: string): Promise<string> => {
      const content: IContent = getAudioMsgContent(
        item,
        mxc,
        getVoiceMessageContentOptions(context.signalBridgedRoom)
      );
      const relation = getRoomInputVoiceUploadRelation(context, item.file);
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
