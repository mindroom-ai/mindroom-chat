import {
  EventType,
  MatrixError,
  type MatrixClient,
  type Room,
  type UploadProgress,
  type UploadResponse,
} from 'matrix-js-sdk';
import {
  decryptAttachment,
  encryptAttachment,
  type EncryptedAttachmentInfo,
} from 'browser-encrypt-attachment';
import type { IEncryptedFile, IImageInfo, IVideoInfo } from '../../types/matrix/common';
import type { MDirectContent } from '../../types/matrix/accountData';
import { Membership } from '../../types/matrix/room';

export { mxcUrlToHttp } from './mediaUrl';

// Matrix identifiers (client-server specification, "Identifier Grammar"): a sigil, a localpart
// without colons, then the server name, which may carry a port.
const USER_ID = /^@[^:\s]+:\S+$/;
const ROOM_ID = /^![^:\s]+(?::\S+)?$/;
const ROOM_ALIAS = /^#[^:\s]+:\S+$/;

export const isUserId = (id: string): boolean => USER_ID.test(id);
export const isRoomId = (id: string): boolean => ROOM_ID.test(id);
export const isRoomAlias = (id: string): boolean => ROOM_ALIAS.test(id);

const splitIdentifier = (id: string): [string, string] | undefined => {
  const colon = id.indexOf(':');
  if (colon < 2) return undefined;
  return [id.slice(1, colon), id.slice(colon + 1)];
};

/** `alice` for `@alice:example.org`, or undefined for something else. */
export const getMxIdLocalPart = (userId: string): string | undefined =>
  isUserId(userId) || isRoomAlias(userId) ? splitIdentifier(userId)?.[0] : undefined;

/** `example.org` for `@alice:example.org`, including a port when there is one. */
export const getMxIdServer = (userId: string): string | undefined =>
  isUserId(userId) || isRoomAlias(userId) || isRoomId(userId)
    ? splitIdentifier(userId)?.[1]
    : undefined;

/** The room this client knows under `alias` as its canonical or alternative alias. */
export const getCanonicalAliasRoomId = (mx: MatrixClient, alias: string): string | undefined => {
  const knowsAlias = (room: Room): boolean =>
    room.getCanonicalAlias?.() === alias || (room.getAltAliases?.() ?? []).includes(alias);
  return mx.getRooms().find(knowsAlias)?.roomId;
};

/** The room's canonical alias for links and routes, or its ID when it has none. */
export const getCanonicalAliasOrRoomId = (mx: MatrixClient, roomId: string): string => {
  const room = mx.getRoom(roomId);
  return room?.getCanonicalAlias() ?? roomId;
};

/**
 * The other person in a direct room: who invited us while the invite is pending, otherwise the
 * other member (joined first, then invited, then anyone who left).
 */
export const guessDmRoomUserId = (room: Room, myUserId: string): string | undefined => {
  const me = room.getMember(myUserId);
  if (me?.membership === Membership.Invite) {
    const inviter = me.events.member?.getSender();
    if (inviter && inviter !== myUserId) return inviter;
  }
  const others = room.getMembers().filter((member) => member.userId !== myUserId);
  const byMembership = (membership: string) =>
    others.find((member) => member.membership === membership)?.userId;
  return (
    byMembership(Membership.Join) ??
    byMembership(Membership.Invite) ??
    others[0]?.userId ??
    room.getDMInviter()
  );
};

// Updates to `m.direct` read the current content and write it back. Two updates in flight would
// each drop the other's room, so they run one after another, per client.
const directUpdates = new WeakMap<MatrixClient, Promise<void>>();

const runDirectUpdate = (mx: MatrixClient, update: () => Promise<void>): Promise<void> => {
  const previous = directUpdates.get(mx) ?? Promise.resolve();
  const next = previous.then(update, update);
  directUpdates.set(
    mx,
    next.catch(() => undefined)
  );
  return next;
};

/** Records `roomId` as a direct room with `userId` in the account's `m.direct` data. */
export const addRoomIdToMDirect = (
  mx: MatrixClient,
  roomId: string,
  userId: string
): Promise<void> =>
  runDirectUpdate(mx, async () => {
    const current =
      (mx.getAccountData(EventType.Direct)?.getContent() as MDirectContent | undefined) ?? {};
    const rooms = current[userId] ?? [];
    if (rooms.includes(roomId)) return;
    await mx.setAccountData(EventType.Direct, { ...current, [userId]: [...rooms, roomId] });
  });

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const getRateLimitDelay = (error: unknown): number | undefined => {
  if (!(error instanceof MatrixError) || !error.isRateLimitError()) return undefined;
  try {
    return error.getRetryAfterMs() ?? 5_000;
  } catch {
    return 5_000;
  }
};

/**
 * Runs `action` for each item in turn. A rate-limited attempt waits as long as the server asks
 * and tries again; any other failure, or too many retries, moves on to the next item.
 */
export const rateLimitedActions = async <T>(
  items: readonly T[],
  action: (item: T, index: number) => Promise<unknown>,
  maxRetries = 3
): Promise<void> => {
  for (let index = 0; index < items.length; index += 1) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await action(items[index], index);
        break;
      } catch (error) {
        const delay = getRateLimitDelay(error);
        if (delay === undefined || attempt >= maxRetries) break;
        // eslint-disable-next-line no-await-in-loop
        await sleep(delay);
      }
    }
  }
};

export const getImageInfo = (img: HTMLImageElement, fileOrBlob: Blob): IImageInfo => ({
  w: img.width,
  h: img.height,
  mimetype: fileOrBlob.type,
  size: fileOrBlob.size,
});

export const getVideoInfo = (video: HTMLVideoElement, fileOrBlob: Blob): IVideoInfo => ({
  w: video.videoWidth,
  h: video.videoHeight,
  duration: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined,
  mimetype: fileOrBlob.type,
  size: fileOrBlob.size,
});

/** Encrypts a file for an encrypted room; the result uploads as `application/octet-stream`. */
export const encryptFile = async <T extends Blob>(
  file: T
): Promise<{ file: File; originalFile: T; encInfo: EncryptedAttachmentInfo }> => {
  const { data, info } = await encryptAttachment(await file.arrayBuffer());
  const name = file instanceof File ? file.name : 'file';
  return {
    file: new File([data], name, { type: 'application/octet-stream' }),
    originalFile: file,
    encInfo: info,
  };
};

/** Decrypts a downloaded encrypted attachment; throws when its hash does not match. */
export const decryptFile = async (
  dataBuffer: ArrayBuffer,
  type: string,
  encInfo: EncryptedAttachmentInfo | IEncryptedFile
): Promise<Blob> => {
  const decrypted = await decryptAttachment(dataBuffer, encInfo);
  return new Blob([decrypted], { type });
};

export type TUploadContent = File;

export type MatrixUploadErrorStage = 'create' | 'upload' | 'send';

// Where an upload failed and the original error's name, kept beside the error rather than in its
// `data`, which holds the server's JSON and must not be trusted for this.
type UploadErrorDetails = { stage: MatrixUploadErrorStage; originalName?: string };
const uploadErrorDetails = new WeakMap<MatrixError, UploadErrorDetails>();

const errorName = (error: unknown): string | undefined =>
  error && typeof error === 'object' && typeof (error as { name?: unknown }).name === 'string'
    ? (error as { name: string }).name
    : undefined;

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
};

const httpStatusOf = (error: unknown): number | undefined => {
  const status = (error as { httpStatus?: unknown } | undefined)?.httpStatus;
  return typeof status === 'number' ? status : undefined;
};

/**
 * The error as a MatrixError, remembering the stage it failed in. A MatrixError keeps its
 * identity; anything else becomes `M_UNKNOWN` (or `M_TOO_LARGE` for HTTP 413) with its message.
 */
export const toMatrixUploadError = (error: unknown, stage: MatrixUploadErrorStage): MatrixError => {
  if (error instanceof MatrixError) {
    uploadErrorDetails.set(error, { ...uploadErrorDetails.get(error), stage });
    return error;
  }
  const httpStatus = httpStatusOf(error);
  const normalized = new MatrixError(
    { errcode: httpStatus === 413 ? 'M_TOO_LARGE' : 'M_UNKNOWN', error: errorMessage(error) },
    httpStatus
  );
  uploadErrorDetails.set(normalized, { stage, originalName: errorName(error) });
  return normalized;
};

export const getMatrixUploadErrorStage = (error: unknown): MatrixUploadErrorStage | undefined =>
  error instanceof MatrixError ? uploadErrorDetails.get(error)?.stage : undefined;

/** The name of the error an upload error was made from, such as `AbortError`. */
export const getMatrixUploadOriginalName = (error: unknown): string | undefined =>
  error instanceof MatrixError ? uploadErrorDetails.get(error)?.originalName : undefined;

const isAbortError = (error: unknown): boolean => errorName(error) === 'AbortError';

/**
 * Whether the error looks like a dropped connection rather than an answer from the server: an
 * aborted request, or a MatrixError with no HTTP status and no specific code or message.
 */
export const isTransientMatrixError = (error: unknown): boolean => {
  if (isAbortError(error) && !(error instanceof MatrixError)) return true;
  if (!(error instanceof MatrixError)) return false;
  if (getMatrixUploadOriginalName(error) === 'AbortError') return true;
  if (error.httpStatus !== undefined) return false;
  if (!error.errcode) return true;
  return error.errcode === 'M_UNKNOWN' && !error.data?.error;
};

const isTooLargeError = (error: unknown): boolean =>
  httpStatusOf(error) === 413 || (error instanceof MatrixError && error.errcode === 'M_TOO_LARGE');

const formatMegabytes = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

export type MatrixUploadErrorMessageOptions = {
  uploadKind?: 'file' | 'avatar';
  fileSize?: number;
  maxUploadSize?: number;
};

const tooLargeMessage = ({
  uploadKind,
  fileSize,
  maxUploadSize,
}: MatrixUploadErrorMessageOptions) => {
  const subject = uploadKind === 'avatar' ? 'Avatar image' : 'File';
  if (fileSize && maxUploadSize) {
    return `${subject} is too large. Maximum upload size is ${formatMegabytes(
      maxUploadSize
    )}; selected file is ${formatMegabytes(fileSize)}.`;
  }
  return uploadKind === 'avatar'
    ? 'Avatar image is too large for this server. Choose a smaller image.'
    : 'File is too large for this server.';
};

/** A message for people about a failed upload or send. */
export const getMatrixUploadErrorMessage = (
  error: unknown,
  stage?: MatrixUploadErrorStage,
  options: MatrixUploadErrorMessageOptions = {}
): string => {
  if (error === undefined || error === null) return "Couldn't send. Try again.";
  const effectiveStage = getMatrixUploadErrorStage(error) ?? stage;
  if (effectiveStage === 'create') return "Couldn't prepare file for upload.";
  if (isTooLargeError(error)) return tooLargeMessage(options);
  if (isTransientMatrixError(error)) return "Couldn't send — your connection dropped. Try again.";
  if (error instanceof MatrixError) {
    const text = error.data?.error;
    if (error.errcode && text) return `${error.errcode}: ${text}`;
    return text || error.errcode || "Couldn't send. Try again.";
  }
  return errorMessage(error) || "Couldn't send. Try again.";
};

export type UploadContentOptions = {
  name?: string;
  fileType?: string;
  hideFilename?: boolean;
  /** Receives the request, so the caller can cancel it with `mx.cancelUpload`. */
  onPromise?: (request: Promise<UploadResponse>) => void;
  onProgress?: (progress: UploadProgress) => void;
  onSuccess: (mxcUri: string) => void;
  onError: (error: MatrixError) => void;
};

/** Uploads `file` to the media repository and reports the `mxc://` URI or the error. */
export const uploadContent = async (
  client: MatrixClient,
  file: TUploadContent,
  options: UploadContentOptions
): Promise<void> => {
  const { name, fileType, hideFilename, onPromise, onProgress, onSuccess, onError } = options;
  try {
    const request = client.uploadContent(file, {
      name,
      type: fileType,
      includeFilename: !hideFilename,
      progressHandler: onProgress,
    });
    onPromise?.(request);
    const { content_uri: mxc } = await request;
    if (!mxc) throw new Error('The upload returned no content URI.');
    onSuccess(mxc);
  } catch (error) {
    onError(toMatrixUploadError(error, 'upload'));
  }
};

/** Downloads media as a blob; `init` carries authentication when the URL needs it. */
export const downloadMedia = async (url: string, init?: RequestInit): Promise<Blob> => {
  const response = await fetch(url, { ...init, method: 'GET' });
  if (!response.ok) throw new Error(`Unable to download media (${response.status})`);
  return response.blob();
};

/**
 * Whether the room version gives its creators unlimited power instead of a power level
 * (room version 12, MSC4289), so permission settings show them apart.
 */
export const creatorsSupported = (roomVersion: string | undefined): boolean => {
  if (!roomVersion) return false;
  if (roomVersion === 'org.matrix.hydra.11') return true;
  return /^\d+$/.test(roomVersion) && Number(roomVersion) >= 12;
};
