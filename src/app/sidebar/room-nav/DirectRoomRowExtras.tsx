import { useEffect, useMemo, useReducer } from 'react';
import { Avatar, Icon, Icons, Text, config } from 'folds';
import { atom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { EventType, RoomEvent, RoomStateEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { getRoomInputDraftKey, roomIdToMsgDraftAtomFamily } from '../../composer/roomInputDrafts';
import { BlockType } from '../../editor/types';
import { isRecord } from '../../lib/isRecord';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { IconTooltip } from '../../ui/IconTooltip';
import * as css from './RoomNavItem.css';

const EMPTY_DRAFT_ATOM = atom<readonly unknown[]>(() => []);

const MEANINGFUL_VOID_TYPES: ReadonlySet<string> = new Set([
  BlockType.Mention,
  BlockType.Emoticon,
  BlockType.PasteMarker,
]);

/** Active (joined + invited) member count of a direct room. */
export const getDirectActiveMemberCount = (room: Room): number =>
  (room.getJoinedMemberCount?.() ?? 0) + (room.getInvitedMemberCount?.() ?? 0);

/** Reads the raw `m.direct` account data dictionary (`userId -> roomId[]`) from `mx`. */
export const readMDirectContent = (
  mx: Pick<MatrixClient, 'getAccountData'> | undefined
): Record<string, unknown> | undefined => {
  const content: unknown = mx?.getAccountData?.(EventType.Direct)?.getContent();
  return isRecord(content) ? content : undefined;
};

/** Live `m.direct` account-data dictionary (`userId -> roomId[]`), reacting to `mDirectAtom`. */
export const useMDirectContent = (): Record<string, unknown> | undefined => {
  const mx = useMatrixClient();
  const directs = useAtomValue(mDirectAtom);
  return useMemo(() => {
    void directs;
    return readMDirectContent(mx);
  }, [mx, directs]);
};

/**
 * Returns the partner user ID mapped to `roomId` in `m.direct` account data.
 * Prefers a non-self entry when a room appears under multiple keys; returns `myUserId` only when
 * the room is mapped solely to the viewer.
 */
export const getMDirectPartnerId = (
  mDirect: Record<string, unknown> | undefined,
  roomId: string,
  myUserId?: string
): string | undefined => {
  if (!mDirect) return undefined;
  let selfMatch: string | undefined;
  for (const [userId, rooms] of Object.entries(mDirect)) {
    if (!Array.isArray(rooms) || !rooms.includes(roomId)) continue;
    if (myUserId && userId === myUserId) {
      selfMatch = userId;
      continue;
    }
    return userId;
  }
  return selfMatch;
};

/**
 * True only when `room` has 1 active member AND `m.direct` explicitly maps it under `room.myUserId`.
 * Avoids mislabeling abandoned 1:1 DMs ("Empty room (was Maya)") as self-DMs.
 */
export const isSelfDirectRoom = (
  room: Room,
  activeMemberCount: number,
  mDirect: Record<string, unknown> | undefined
): boolean => {
  if (activeMemberCount !== 1) return false;
  const myUserId = room.myUserId;
  if (!myUserId || !mDirect) return false;
  const ownRooms = mDirect[myUserId];
  return Array.isArray(ownRooms) && ownRooms.includes(room.roomId);
};

/** Live active member count of a direct room, listening to both member events and sync summaries. */
export const useDirectMemberCount = (room: Room, enabled: boolean): number => {
  const [, bump] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (!enabled || typeof room.on !== 'function') return undefined;
    room.on(RoomStateEvent.Members, bump);
    room.on(RoomEvent.Summary, bump);
    return () => {
      room.removeListener(RoomStateEvent.Members, bump);
      room.removeListener(RoomEvent.Summary, bump);
    };
  }, [room, enabled]);
  return enabled ? getDirectActiveMemberCount(room) : 0;
};

const nodeHasDraftContent = (node: unknown): boolean => {
  if (!isRecord(node)) return false;
  if (typeof node.text === 'string' && !('children' in node)) {
    return node.text.trim().length > 0;
  }
  if (typeof node.type === 'string' && MEANINGFUL_VOID_TYPES.has(node.type)) {
    return true;
  }
  return Array.isArray(node.children) && node.children.some(nodeHasDraftContent);
};

/**
 * Whether a stored Slate draft holds non-whitespace text or a meaningful inline/void node
 * (mention, emoticon, or paste marker). Leaves composer storage untouched.
 */
export const hasMeaningfulDraftContent = (draft: readonly unknown[]): boolean =>
  draft.some(nodeHasDraftContent);

/** Isolated pencil mark subscribed to this room's local composer draft so typing re-renders only this mark. */
export function RoomDraftMark({ room }: { room: Room }) {
  const mx = useMatrixClient();
  const { t } = useTranslation();
  const userId = mx.getUserId?.() ?? room.myUserId ?? '';
  const draftAtom = useMemo(
    () =>
      userId
        ? roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(userId, room.roomId))
        : EMPTY_DRAFT_ATOM,
    [userId, room.roomId]
  );
  const draft = useAtomValue(draftAtom);
  if (!hasMeaningfulDraftContent(draft)) return null;
  const label = t('featureUi.roomNav.roomNavItem.draft');
  return (
    <IconTooltip label={label}>
      {(triggerRef) => (
        <Icon
          ref={triggerRef}
          src={Icons.Pencil}
          size="50"
          aria-label={label}
          data-draft-indicator="true"
          style={{ opacity: config.opacity.P500 }}
        />
      )}
    </IconTooltip>
  );
}

/** Muted inline `you` label beside a verified self-DM (1 active member listed under `myUserId` in `m.direct`). */
export function SelfDirectTag({ room }: { room: Room }) {
  const { t } = useTranslation();
  const mDirect = useMDirectContent();
  if (!isSelfDirectRoom(room, 1, mDirect)) return null;
  return (
    <Text
      as="span"
      size="T200"
      priority="300"
      className={css.SelfDirectTag}
      data-self-dm-tag="true"
    >
      {t('featureUi.roomNav.roomNavItem.selfTag')}
    </Text>
  );
}

/** Rounded-square member count avatar for group DMs with an accessible hidden description for `aria-describedby`. */
export function GroupCountAvatar({
  count,
  descriptionId,
}: {
  count: number;
  descriptionId: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Avatar
        size="200"
        radii="400"
        className={css.GroupCountAvatar}
        data-direct-group-count={count}
        aria-hidden="true"
      >
        <Text as="span" size="L400">
          {count}
        </Text>
      </Avatar>
      <span id={descriptionId} hidden>
        {t('featureUi.roomNav.roomNavItem.groupMemberCount', { count })}
      </span>
    </>
  );
}
