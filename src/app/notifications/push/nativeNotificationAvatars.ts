import { KnownMembership, type MatrixClient } from 'matrix-js-sdk';
import { encodeBase64 } from 'matrix-js-sdk/lib/base64';
import { mxcUrlToHttp } from '../../matrix/mediaUrl';
import { authenticatedAvatarRequest } from '../../avatars/avatarMedia';
import {
  storeNativeNotificationAvatar,
  syncNativeNotificationAvatars,
  type NativeNotificationAvatarEntry,
} from '../../native/nativeNotifications';

const MAX_NATIVE_NOTIFICATION_AVATARS = 200;
/** The thumbnail asked of the homeserver, in pixels each way. */
const NATIVE_AVATAR_PIXELS = 128;
/** The largest avatar the app takes (`NotificationAvatarStore.maxAvatarBytes`). */
const MAX_NATIVE_AVATAR_BYTES = 512 * 1024;
const MAX_NATIVE_AVATAR_DOWNLOADS = 4;
/** Maximum bytes inspected when checking a non-OK media error body for `M_UNRECOGNIZED`. */
const MAX_MEDIA_ERROR_BYTES = 4096;

/**
 * The avatars of the other members of the joined rooms, one entry for each room a member has an
 * avatar in: a member can have another avatar in each room. Rooms come by their latest activity,
 * so the cap keeps what the next notifications will show.
 *
 * The list is all the app keeps: it removes every cached avatar that is not on it. A member
 * without an avatar is therefore left out, as is one beyond the cap.
 *
 * Only the member's own avatar in the room counts. The SDK's `User.avatarUrl` is whichever room's
 * membership it saw last, so it would put one room's avatar on a room where the member has none.
 */
export const collectJoinedMemberAvatars = (mx: MatrixClient): NativeNotificationAvatarEntry[] => {
  const ownUserId = mx.getUserId?.();
  const rooms = (mx.getRooms?.() ?? [])
    .filter((room) => room.getMyMembership?.() === 'join')
    .map((room) => ({ room, lastActive: room.getLastActiveTimestamp?.() ?? 0 }))
    .sort((a, b) => b.lastActive - a.lastActive || a.room.roomId.localeCompare(b.room.roomId));
  const avatars: NativeNotificationAvatarEntry[] = [];

  for (const { room } of rooms) {
    // A less active room adds nothing that is kept once the cap is reached.
    if (avatars.length >= MAX_NATIVE_NOTIFICATION_AVATARS) break;
    const members =
      room.getJoinedMembers?.() ??
      room.getMembers?.().filter((member) => member.membership === KnownMembership.Join) ??
      [];
    const sortedMembers = [...members].sort((a, b) => a.userId.localeCompare(b.userId));
    for (const member of sortedMembers) {
      const sender = member.userId;
      // The membership event is the sender's to write: its `avatar_url` can be anything.
      const rawMxc: unknown = member.getMxcAvatarUrl?.() ?? null;
      const mxcUrl = typeof rawMxc === 'string' && rawMxc.startsWith('mxc://') ? rawMxc : null;
      if (!mxcUrl) continue;
      if (sender && sender !== ownUserId) {
        avatars.push({ roomId: room.roomId, sender, mxcUrl });
      }
    }
  }

  return avatars.slice(0, MAX_NATIVE_NOTIFICATION_AVATARS);
};

/**
 * Reads a response body up to `maxBytes`, cancelling the stream immediately if either
 * `Content-Length` or the streamed chunks exceed the cap.
 */
export const readResponseBytesCapped = async (
  response: Response,
  maxBytes: number
): Promise<Uint8Array | undefined> => {
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      // Do not await cancel(): on a tee'd `response.clone()` branch, `cancel()` waits for the other branch.
      void response.body?.cancel().catch(() => undefined);
      return undefined;
    }
  }

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        if (total + value.byteLength > maxBytes) {
          // Do not await cancel(): on a tee'd `response.clone()` branch, `cancel()` waits for the other branch.
          void reader.cancel().catch(() => undefined);
          return undefined;
        }
        chunks.push(value);
        total += value.byteLength;
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.byteLength > maxBytes ? undefined : bytes;
};

/** Whether the homeserver has no authenticated media endpoint, as one older than Matrix 1.11. */
const lacksAuthenticatedMedia = async (response: Response): Promise<boolean> => {
  if (response.status === 404) return true;
  if (response.ok) return false;
  try {
    const bytes = await readResponseBytesCapped(response.clone(), MAX_MEDIA_ERROR_BYTES);
    if (!bytes) return false;
    const body = JSON.parse(new TextDecoder().decode(bytes)) as { errcode?: unknown } | null;
    return body?.errcode === 'M_UNRECOGNIZED';
  } catch {
    return false;
  }
};

/**
 * Downloads an avatar's thumbnail and returns it as base64, or nothing when the server has none
 * or it is larger than the app takes. The access token goes to the homeserver's authenticated
 * media endpoint only, in a header; a server without that endpoint is asked without the token.
 */
const downloadAvatarThumbnail = async (
  mx: MatrixClient,
  mxcUrl: string,
  signal: AbortSignal
): Promise<string | undefined> => {
  const httpUrl = mxcUrlToHttp(
    mx,
    mxcUrl,
    false,
    NATIVE_AVATAR_PIXELS,
    NATIVE_AVATAR_PIXELS,
    'crop'
  );
  if (!httpUrl) return undefined;
  const authenticated = authenticatedAvatarRequest(mx, httpUrl);
  let response = authenticated
    ? await fetch(authenticated.url, { ...authenticated.init, signal })
    : await fetch(httpUrl, { signal });
  if (authenticated && (await lacksAuthenticatedMedia(response))) {
    void response.body?.cancel().catch(() => undefined);
    response = await fetch(httpUrl, { signal });
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  const bytes = await readResponseBytesCapped(response, MAX_NATIVE_AVATAR_BYTES);
  if (!bytes || bytes.byteLength === 0) return undefined;
  return encodeBase64(bytes);
};

/**
 * Lists the account's avatars to the app, which removes the ones that are no longer among them,
 * and downloads the ones it lacks, a few at a time, for the app to keep. The notification
 * extension itself downloads nothing: a sender whose avatar is not kept shows without one.
 *
 * Rejects when the list did not reach the app. An avatar that cannot be downloaded or stored is
 * left out. Aborting `signal` stops the downloads.
 */
export const prewarmNativeNotificationAvatars = async (
  mx: MatrixClient,
  accountTag: string,
  avatars: NativeNotificationAvatarEntry[],
  signal: AbortSignal
): Promise<void> => {
  const { missingMxcUrls, syncGeneration } = await syncNativeNotificationAvatars({
    accountTag,
    avatars,
  });
  const pending = [...missingMxcUrls];
  const downloadNext = async (): Promise<void> => {
    const mxcUrl = pending.shift();
    if (mxcUrl === undefined || signal.aborted) return;
    try {
      const base64Data = await downloadAvatarThumbnail(mx, mxcUrl, signal);
      if (base64Data && !signal.aborted) {
        await storeNativeNotificationAvatar({
          accountTag,
          syncGeneration,
          mxcUrl,
          // A member is listed once for each room, mostly with the same avatar.
          entries: avatars
            .filter((avatar) => avatar.mxcUrl === mxcUrl)
            .map(({ roomId, sender }) => ({ roomId, sender })),
          base64Data,
        });
      }
    } catch {
      // Left out; the others are still downloaded.
    }
    await downloadNext();
  };
  await Promise.all(Array.from({ length: MAX_NATIVE_AVATAR_DOWNLOADS }, () => downloadNext()));
};
