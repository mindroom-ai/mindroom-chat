import React from 'react';
import { MatrixClient, RelationType, Room } from 'matrix-js-sdk';
import { Descendant, Editor, Element } from 'slate';
import { Box, config } from 'folds';
import { Membership } from '../matrix/types/room';
import type { AutocompleteQuery } from '../editor/autocomplete/autocompleteQuery';
import type { PasteMarkerElement } from '../editor/slate';
import { BlockType } from '../editor/types';
import type { IReplyDraft, PendingVoiceSendContext } from './roomInputDrafts';
import { AgentCommandAutocomplete } from './commands/CommandAutocomplete';
import { MINDROOM_COMMAND_PREFIX } from './commands/agentCommandQuery';
import { PendingSendIndicator } from '../ui/PendingSendIndicator';
import { ThreadIndicator } from '../messages/ThreadIndicator';
import { isSignalBridgeRoom } from '../matrix/bridgeDetection';
import {
  isLocalEchoEventId,
  resolveCanonicalThreadRootId,
} from '../event-store/threads/threadRouteUtils';
import { getMessageRelation } from '../matrix/send/composeMessageRelation';
import type { PasteMarker } from '../matrix/protocol/pasteAttachmentMarker';
import { matchesEnum } from '../lib/matchesEnum';

export type RoomInputAutocompletePrefix = typeof MINDROOM_COMMAND_PREFIX;
export type RoomInputAutocompleteQuery =
  AutocompleteQuery<RoomInputAutocompletePrefix>;

type RoomInputAutocompleteProps = {
  editor: Editor;
  query: AutocompleteQuery<string> | undefined;
  requestClose: () => void;
};

type RoomInputThreadIndicatorProps = {
  room: Room;
  relation: IReplyDraft['relation'] | undefined;
};

type RoomInputReplyContextProps = {
  children?: React.ReactNode;
  leading?: React.ReactNode;
  pendingSend?: boolean;
  relation: IReplyDraft['relation'] | undefined;
  room: Room;
};

export const isRoomInputAutocompleteQuery = (
  query: AutocompleteQuery<string> | undefined
): query is RoomInputAutocompleteQuery => query?.prefix === MINDROOM_COMMAND_PREFIX;

export const getRoomInputVoiceSendContext = ({
  ownerSessionId,
  roomId,
  room,
  threadId,
  replyDraft,
  threadingEnabled = true,
  threadView,
}: {
  ownerSessionId: string;
  roomId: string;
  room: Room;
  threadId: string | undefined;
  replyDraft: IReplyDraft | undefined;
  threadingEnabled?: boolean;
  threadView?: boolean;
}): PendingVoiceSendContext => ({
  ownerSessionId,
  roomId,
  room,
  threadId,
  replyDraft,
  threadingEnabled,
  signalBridgedRoom: isSignalBridgeRoom(room),
  ...(threadView && { threadView }),
});

/**
 * A thread opened by a message that was still sending goes by that message's own ID once the
 * server confirms it.
 */
export const confirmedVoiceThreadId = (room: Room, threadId: string | undefined) =>
  isLocalEchoEventId(threadId) ? resolveCanonicalThreadRootId(room, threadId) : threadId;

/**
 * Re-resolve a captured voice send context against the live Matrix client
 * just before sending. Returns null if the source room is no longer
 * available (missing or non-Joined). This is the boundary that closes the
 * stale-snapshot window: encryption upgrades, membership changes, or
 * signal-bridge roster changes between original failure and retry are all
 * picked up here. handleVoiceSend in the parent uses this so the bridge-
 * detection / membership predicates stay isolated to the extensions module.
 */
export const refreshRoomInputVoiceSendContext = (
  mx: MatrixClient,
  context: PendingVoiceSendContext
): PendingVoiceSendContext | null => {
  const liveRoom = mx.getRoom(context.roomId);
  if (!liveRoom || !matchesEnum(liveRoom.getMyMembership(), Membership.Join)) return null;
  return {
    ...context,
    room: liveRoom,
    threadId: confirmedVoiceThreadId(liveRoom, context.threadId),
    signalBridgedRoom: isSignalBridgeRoom(liveRoom),
  };
};

/** A voice message is one file without text: a reply, a thread reply, or neither. */
export const getRoomInputVoiceUploadRelation = (context: PendingVoiceSendContext) =>
  getMessageRelation(context.replyDraft?.eventId, context.replyDraft?.relation, context.threadId, {
    allowThreadRelation: context.threadingEnabled,
  });

export const createRoomInputPasteMarkerElement = (
  marker: PasteMarker
): PasteMarkerElement => ({
  type: BlockType.PasteMarker,
  id: marker.id,
  chars: marker.chars,
  fileName: marker.fileName,
  marker: marker.raw,
  children: [{ text: '' }],
});

export const isRoomInputPasteMarkerElement = (node: unknown): node is PasteMarkerElement =>
  Element.isElement(node) && node.type === BlockType.PasteMarker;

export const getRoomInputPasteMarkerFileNames = (nodes: Descendant[]): Set<string> => {
  const fileNames = new Set<string>();

  const visit = (node: Descendant) => {
    if (isRoomInputPasteMarkerElement(node)) {
      fileNames.add(node.fileName);
      return;
    }
    if (Element.isElement(node)) {
      node.children.forEach(visit);
    }
  };

  nodes.forEach(visit);
  return fileNames;
};

export function RoomInputAutocomplete({
  editor,
  query,
  requestClose,
}: RoomInputAutocompleteProps) {
  if (!isRoomInputAutocompleteQuery(query)) return null;

  return <AgentCommandAutocomplete editor={editor} query={query} requestClose={requestClose} />;
}

export function RoomInputThreadIndicator({
  room,
  relation,
}: RoomInputThreadIndicatorProps) {
  if (relation?.rel_type !== RelationType.Thread) return null;

  return <ThreadIndicator room={room} />;
}

export function RoomInputReplyContext({
  children,
  leading,
  pendingSend,
  relation,
  room,
}: RoomInputReplyContextProps) {
  if (!leading && !children && !pendingSend) return null;

  return (
    <Box
      direction="Column"
      gap="100"
      style={{ padding: `${config.space.S200} ${config.space.S400} 0` }}
    >
      {leading}
      <Box direction="Row" gap="200" alignItems="Center">
        <RoomInputThreadIndicator room={room} relation={relation} />
        {children}
        {pendingSend && <PendingSendIndicator />}
      </Box>
    </Box>
  );
}
