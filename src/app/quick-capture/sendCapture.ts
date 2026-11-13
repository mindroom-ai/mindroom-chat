import type { IContent, MatrixClient, Room } from 'matrix-js-sdk';
import type { RoomMessageEventContent } from 'matrix-js-sdk/lib/@types/events';
import { createEditor } from 'slate';
import { composeTextMessage } from '../composer/composeTextMessage';
import { createParagraphElement, withInlineElements } from '../editor/utils';
import {
  buildPerTagEventContent,
  buildPerTagStateKey,
  MINDROOM_THREAD_TAGS_EVENT,
  RESOLVED_TAG,
} from '../event-store/threads/threadTags';
import { ErrorCode } from '../matrix/cs-errorcode';
import { discardFailedLocalEcho } from '../matrix/protocol/pendingLocalEcho';
import {
  buildLongTextPreview,
  contentBytes,
  MAX_EVENT_CONTENT_BYTES,
} from '../matrix/protocol/longText';
import { getMessageRelation } from '../matrix/send/composeMessageRelation';
import { uploadLongTextSidecar } from '../matrix/send/longTextSidecarUpload';
import { getImageMsgContent } from '../matrix/send/msgContent';
import { createRoomUploadItems } from '../matrix/send/roomInputUploadPreparation';
import type { CaptureErrorCode } from './captureProtocol';

export type CaptureSendOptions = { markdown: boolean; linkSchemes?: readonly string[] };

/** A capture the host could not post, with the code the widget shows. */
export class CaptureError extends Error {
  constructor(readonly code: CaptureErrorCode, cause?: unknown) {
    super(`Quick capture failed: ${code}`, { cause });
    this.name = 'CaptureError';
  }
}

/** Runs `task`, failing with `code` when it fails. */
const failingAs = <T>(code: CaptureErrorCode, task: () => Promise<T>): Promise<T> =>
  task().catch((error: unknown) => {
    throw new CaptureError(code, error);
  });

/** The message the composer would send for `text`, one paragraph per line; undefined when blank. */
const composeCaptureText = (
  mx: MatrixClient,
  text: string,
  options: CaptureSendOptions
): IContent | undefined => {
  const editor = withInlineElements(createEditor());
  editor.children = text.split('\n').map((line) => createParagraphElement(line));
  return composeTextMessage(
    editor,
    options.markdown,
    mx.getUserId() ?? undefined,
    options.linkSchemes
  );
};

const inThread = (content: IContent, threadId: string): IContent => ({
  ...content,
  'm.relates_to': getMessageRelation(undefined, undefined, threadId),
});

/**
 * Uploads every image, encrypted in an encrypted room, and builds its message. Nothing is sent
 * here, so an image that fails leaves no thread without its picture.
 */
const prepareImages = (mx: MatrixClient, room: Room, images: File[]): Promise<IContent[]> =>
  failingAs('upload-failed', async () => {
    const items = await createRoomUploadItems(images, room);
    const prepError = items.find((item) => item.prepError)?.prepError;
    if (prepError) throw prepError;
    return Promise.all(
      items.map(async (item) => {
        const { content_uri: mxc } = await mx.uploadContent(item.file, {
          name: item.originalFile.name,
          type: item.encInfo ? 'application/octet-stream' : item.originalFile.type,
          includeFilename: !item.encInfo,
        });
        if (!mxc) throw new Error('The image upload returned no content URI.');
        return getImageMsgContent(mx, item, mxc);
      })
    );
  });

/** Sends one message and returns its event ID. */
const postMessage = async (mx: MatrixClient, room: Room, content: IContent): Promise<string> => {
  const txnId = mx.makeTxnId();
  try {
    const { event_id: eventId } = await mx.sendMessage(
      room.roomId,
      content as RoomMessageEventContent,
      txnId
    );
    return eventId;
  } catch (error) {
    // The widget keeps the entry to send again, so the room keeps no "Not sent" copy of it.
    discardFailedLocalEcho(mx, room.getEventForTxnId(txnId));
    throw new CaptureError('send-failed', error);
  }
};

/** Sends a text message, as a long-text sidecar when one event cannot hold it, as the composer does. */
const postText = async (mx: MatrixClient, room: Room, content: IContent): Promise<string> => {
  const eventContent =
    contentBytes(content) <= MAX_EVENT_CONTENT_BYTES
      ? content
      : await failingAs('send-failed', () =>
          uploadLongTextSidecar(mx, room, content, buildLongTextPreview(content))
        );
  return postMessage(mx, room, eventContent);
};

/** Posts a new thread: text alone, or the first image as its root with the rest and the text in it. */
export const sendCapture = async (
  mx: MatrixClient,
  room: Room,
  entry: { text: string; images: File[] },
  options: CaptureSendOptions
): Promise<{ threadId: string }> => {
  const text = composeCaptureText(mx, entry.text, options);
  const [rootImage, ...otherImages] = await prepareImages(mx, room, entry.images);
  if (!rootImage) {
    if (!text) throw new CaptureError('send-failed');
    return { threadId: await postText(mx, room, text) };
  }
  const threadId = await postMessage(mx, room, rootImage);
  // Images first and the text last: MindRoom takes the batch as one turn, closed by the text.
  for (const image of otherImages) await postMessage(mx, room, inThread(image, threadId));
  if (text) await postText(mx, room, inThread(text, threadId));
  return { threadId };
};

/** Posts `text` in the thread; blank text sends nothing. */
export const sendCaptureReply = async (
  mx: MatrixClient,
  room: Room,
  threadId: string,
  text: string,
  options: CaptureSendOptions
): Promise<void> => {
  const content = composeCaptureText(mx, text, options);
  if (content) await postText(mx, room, inThread(content, threadId));
};

const isForbidden = (error: unknown): boolean =>
  (error as { errcode?: unknown } | null | undefined)?.errcode === ErrorCode.M_FORBIDDEN;

/** Sets or clears the thread's resolved tag, as the thread list does. */
export const setCaptureResolved = async (
  mx: MatrixClient,
  room: Room,
  threadId: string,
  resolved: boolean
): Promise<void> => {
  try {
    await mx.sendStateEvent(
      room.roomId,
      MINDROOM_THREAD_TAGS_EVENT as never,
      (resolved ? buildPerTagEventContent(mx.getSafeUserId()) : {}) as never,
      buildPerTagStateKey(threadId, RESOLVED_TAG)
    );
  } catch (error) {
    throw new CaptureError(isForbidden(error) ? 'forbidden' : 'send-failed', error);
  }
};
