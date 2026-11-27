import { useEffect, useMemo, useReducer } from 'react';
import { Avatar, Icon, Icons, Text, config, type IconSrc } from 'folds';
import { atom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { RoomEvent, RoomStateEvent, type Room } from 'matrix-js-sdk';
import {
  getMsgDraftStorageKey,
  getRoomInputDraftKey,
  readStoredMsgDraft,
  roomIdToWrittenMsgDraftAtomFamily,
} from '../../composer/roomInputDrafts';
import { VOID_BLOCK_TYPES } from '../../editor/types';
import { isRecord } from '../../lib/isRecord';
import { localDigits } from '../../lib/localDigits';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { getDirectActiveMemberCount } from '../../matrix/room';
import { isRoomInSelfMDirect, useMDirectContent } from '../../matrix/state/mDirectList';
import { IconTooltip } from '../../ui/IconTooltip';
import * as css from './RoomNavItem.css';

const EMPTY_DRAFT: readonly unknown[] = [];
const EMPTY_DRAFT_VALUE_ATOM = atom<readonly unknown[] | undefined>(() => undefined);

/** Subtle trailing row mark icon wrapped in an `IconTooltip`. */
export function RowMarkIcon({
  src,
  label,
  labelled = false,
  ...dataProps
}: {
  src: IconSrc;
  label: string;
  /** Expose `label` directly via `aria-label`; otherwise hide the icon for an `aria-describedby` span. */
  labelled?: boolean;
  'data-draft-indicator'?: 'true';
}) {
  return (
    <IconTooltip label={label}>
      {(triggerRef) => (
        <Icon
          ref={triggerRef}
          src={src}
          size="50"
          aria-label={labelled ? label : undefined}
          aria-hidden={labelled ? undefined : true}
          style={{ opacity: config.opacity.P500 }}
          {...dataProps}
        />
      )}
    </IconTooltip>
  );
}

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
  if (typeof node.type === 'string' && VOID_BLOCK_TYPES.has(node.type)) {
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

/**
 * Isolated pencil mark and accessible hidden description subscribed to this room's local composer
 * draft so typing re-renders only this mark. Hiding the visual icon on hover/focus preserves the
 * `aria-describedby` draft status for keyboard and screen-reader users.
 */
export function RoomDraftMark({
  room,
  descriptionId,
  showIcon,
}: {
  room: Room;
  descriptionId: string;
  showIcon: boolean;
}) {
  const mx = useMatrixClient();
  const { t } = useTranslation();
  const userId = mx.getUserId?.() ?? room.myUserId ?? '';
  const draftKey = userId ? getRoomInputDraftKey(userId, room.roomId) : undefined;
  const writtenAtom = useMemo(
    () => (draftKey ? roomIdToWrittenMsgDraftAtomFamily(draftKey) : EMPTY_DRAFT_VALUE_ATOM),
    [draftKey]
  );
  const inMemoryDraft = useAtomValue(writtenAtom);
  const [storageVersion, bumpStorage] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    if (!draftKey || typeof window === 'undefined') return undefined;
    const storageKey = getMsgDraftStorageKey(draftKey);
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === storageKey) bumpStorage();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [draftKey]);

  const needsStoredDraft = inMemoryDraft === undefined;
  const storedDraft = useMemo(() => {
    void storageVersion;
    return needsStoredDraft && draftKey ? readStoredMsgDraft(draftKey) : undefined;
  }, [needsStoredDraft, draftKey, storageVersion]);
  const draft = inMemoryDraft ?? storedDraft ?? EMPTY_DRAFT;
  const hasDraft = useMemo(() => hasMeaningfulDraftContent(draft), [draft]);
  const label = t('featureUi.roomNav.roomNavItem.draft');
  return (
    <>
      {hasDraft && showIcon && (
        <RowMarkIcon src={Icons.Pencil} label={label} data-draft-indicator="true" />
      )}
      <span id={descriptionId} hidden>
        {hasDraft ? label : undefined}
      </span>
    </>
  );
}

/** Muted inline `you` label beside a verified self-DM (caller checks active member count === 1). */
export function SelfDirectTag({ room }: { room: Room }) {
  const { t } = useTranslation();
  const mDirect = useMDirectContent();
  if (!isRoomInSelfMDirect(mDirect, room.roomId, room.myUserId)) return null;
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
  const { t, i18n } = useTranslation();
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
          {localDigits(`${count}`, i18n.language)}
        </Text>
      </Avatar>
      <span id={descriptionId} hidden>
        {t('featureUi.roomNav.roomNavItem.groupMemberCount', { count })}
      </span>
    </>
  );
}
