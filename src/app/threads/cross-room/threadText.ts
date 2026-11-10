import type { TFunction } from 'i18next';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { getMxIdLocalPart } from '../../matrix/matrix';
import { isMindroomAgentUserIdForViewer } from '../../matrix/protocol/agentIdentity';
import { getMemberRawDisplayName, getSenderName } from '../../matrix/room';
import { localizeThreadPreview } from '../../event-store/threads/threadMessagePreview';
import { revealDirectionControls } from '../../ui/directional';
import type { CrossRoomThreadIndexEntry } from './crossRoomThreadIndex';
import type { PluginEvent } from '../../plugins/messageRenderers';
import { threadMessagePluginEvent, type ThreadPreview } from './threadSignals';

/**
 * A sender as the cross-room lists name them: an agent of the user's homeserver by its name,
 * anyone else as `getSenderName` gives it, with the user ID until the room's members are known.
 */
export const threadActorName = (mx: MatrixClient, room: Room | null, userId: string): string => {
  const fallback = getMxIdLocalPart(userId) ?? userId;
  if (!room) return fallback;
  if (isMindroomAgentUserIdForViewer(userId, mx.getUserId() ?? undefined)) {
    return getMemberRawDisplayName(room, userId) ?? fallback;
  }
  return getSenderName(room, userId);
};

/**
 * A reply's preview: its text, or what kind of file it is (a voice message, not its file name).
 * Direction controls in the text are written out, so a name like `invoice<U+202E>txt.exe` cannot
 * pass for another (`revealDirectionControls`).
 */
export const threadPreviewText = (t: TFunction, preview: ThreadPreview): string =>
  preview.kind === 'text'
    ? localizeThreadPreview(preview.text, preview.localization, t) ?? ''
    : t(`threadPreview.${preview.kind}`);

/** A thread's title in the cross-room lists: its AI title, else its first message, controls written out. */
export const threadTitleText = (
  entry: Pick<CrossRoomThreadIndexEntry, 'summaryText' | 'rootPreviewText'>
): string => revealDirectionControls(entry.summaryText || entry.rootPreviewText);

/**
 * The root of a thread without an AI title as a plugin's message renderer sees it, for a title
 * from the plugin (`useMessagePreview`). Undefined with an AI title or while the root is not loaded.
 */
export const threadRootPluginEvent = (
  room: Room | null,
  entry: Pick<CrossRoomThreadIndexEntry, 'threadRecord' | 'threadRootId'>
): PluginEvent | undefined => {
  // The index's `summaryText` falls back to the root's text; the AI title is the presentation's.
  if (!room || entry.threadRecord.presentation.summaryText !== undefined) return undefined;
  const thread = room.getThread(entry.threadRootId);
  const root = thread?.rootEvent ?? room.findEventById(entry.threadRootId);
  return root ? threadMessagePluginEvent(room, root, thread) : undefined;
};

/**
 * The thread index's own preview of the newest reply, for a thread whose loaded messages hold no
 * counted reply (the server's summary named a title notice): its text, controls written out, and
 * its sender. Undefined when the index has none; the root is never a reply.
 */
export const threadIndexReplyPreview = (
  entry: Pick<CrossRoomThreadIndexEntry, 'threadRecord'>
): { senderId?: string; text: string } | undefined => {
  const { latestReplyPreviewText, lastSenderId } = entry.threadRecord.presentation ?? {};
  if (!latestReplyPreviewText) return undefined;
  return {
    ...(lastSenderId ? { senderId: lastSenderId } : {}),
    text: revealDirectionControls(latestReplyPreviewText),
  };
};
