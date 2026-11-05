import { FocusEvent, MouseEvent, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Spinner, Text } from 'folds';
import type { JoinRule } from 'matrix-js-sdk';
import { RoomAvatar } from '../../avatars/RoomAvatar';
import { ownDirectionLine } from '../../ui/directional';
import { RoomAccessControl } from '../RoomAccessControl';
import { ErrorDetail } from '../../ui/ErrorDetail';
import { describeKnownError } from '../../lib/describeError';
import { nameInitials } from '../../lib/common';
import { isRoomId } from '../../matrix/matrix';
import * as css from './JoinRoom.css';

/** Marks the button that arrow keys move between and Enter presses. */
export const ROW_ACTION_ATTRIBUTE = 'data-join-row-action';

/** What the directory or the room's summary says about the room. */
type RoomListing = { name: string; topic?: string; avatarUrl?: string; memberCount?: number };

type JoinRoomRowProps = RoomListing & {
  /** What the row was found as: an address, or the room ID the directory gave. */
  roomIdOrAlias: string;
  /** The room ID a server confirmed for `roomIdOrAlias`. */
  roomId?: string;
  viaServers?: string[];
  /** Undefined while the room's details load. */
  joinRule?: JoinRule;
  /** IDs of the rooms the user has joined. */
  allRooms: string[];
  /** Opens a joined room, or the room's join preview. */
  onOpen: (roomIdOrAlias: string) => void;
};

/**
 * One room in the join dialog: its avatar, name, member count and topic, and Join, which turns
 * into Open once the user is in. Clicking the name opens the room, or its preview when the user
 * is not in it yet.
 */
export function JoinRoomRow({
  roomIdOrAlias,
  roomId,
  viaServers,
  name,
  topic,
  avatarUrl,
  memberCount,
  joinRule,
  allRooms,
  onOpen,
}: JoinRoomRowProps) {
  const { t } = useTranslation();
  const verifiedRoomId = roomId ?? (isRoomId(roomIdOrAlias) ? roomIdOrAlias : undefined);
  const joined = verifiedRoomId !== undefined && allRooms.includes(verifiedRoomId);
  const target = verifiedRoomId ?? roomIdOrAlias;

  // Join swaps its button for Open when the join lands; focus moves to the new button, unless the
  // user has moved it somewhere else meanwhile.
  const keepFocus = useRef(false);
  const takeFocus = useCallback((button: HTMLButtonElement | null) => {
    const active = document.activeElement;
    if (button && keepFocus.current && (!active || active === document.body)) button.focus();
  }, []);
  const holdFocus = (event: MouseEvent<HTMLButtonElement>) => {
    keepFocus.current = document.activeElement === event.currentTarget;
  };
  const releaseFocus = (event: FocusEvent<HTMLLIElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && !event.currentTarget.contains(next)) keepFocus.current = false;
  };

  const actionProps = { [ROW_ACTION_ATTRIBUTE]: true, ref: takeFocus, className: css.RowAction };
  const openButton = (
    <Button
      {...actionProps}
      variant="Secondary"
      fill="Soft"
      size="300"
      radii="300"
      onClick={() => onOpen(target)}
    >
      <Text size="B300">{t('sharedUi.joinAddressPrompt.open')}</Text>
    </Button>
  );

  const details = [
    typeof memberCount === 'number' ? t('sharedUi.roomCard.members', { count: memberCount }) : '',
    topic?.trim() ?? '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className={css.Row} data-join-room={target} onBlur={releaseFocus}>
      <button type="button" tabIndex={-1} className={css.RowBody} onClick={() => onOpen(target)}>
        <Avatar size="300" radii="300">
          <RoomAvatar
            roomId={target}
            alt={name}
            src={avatarUrl}
            renderFallback={() => <Text size="H6">{nameInitials(name)}</Text>}
          />
        </Avatar>
        <span className={css.RowText}>
          <Text as="span" size="T300" truncate {...ownDirectionLine}>
            <b>{name}</b>
          </Text>
          {details && (
            <Text as="span" size="T200" priority="300" truncate>
              {details}
            </Text>
          )}
        </span>
      </button>
      {joined ? (
        openButton
      ) : (
        <RoomAccessControl
          roomIdOrAlias={roomIdOrAlias}
          roomId={roomId}
          roomName={name}
          joinRule={joinRule}
          viaServers={viaServers}
          fallback={
            joinRule === undefined ? (
              <Button
                className={css.RowAction}
                variant="Secondary"
                fill="Soft"
                size="300"
                radii="300"
                disabled
              >
                <Spinner variant="Secondary" size="100" />
              </Button>
            ) : (
              <Text size="T200" priority="300">
                {t('sharedUi.roomCard.accessUnavailable')}
              </Text>
            )
          }
        >
          {(access) => {
            if (access.succeeded) return openButton;
            let label = t('sharedUi.roomCard.join');
            if (access.loading) {
              label =
                access.kind === 'knock'
                  ? t('sharedUi.roomCard.sendingRequest')
                  : t('sharedUi.roomCard.joining');
            } else if (access.requested) label = t('sharedUi.roomCard.requestSent');
            else if (access.kind === 'knock') label = t('sharedUi.roomCard.requestToJoin');
            const failure = access.joinError;
            return (
              <>
                <Button
                  {...actionProps}
                  variant={access.requested ? 'Secondary' : 'Primary'}
                  fill={access.requested ? 'Soft' : 'Solid'}
                  size="300"
                  radii="300"
                  // A busy button keeps focus (a disabled one would drop it); a second press
                  // does nothing while the join runs.
                  aria-disabled={access.loading || access.requested}
                  disabled={access.requested}
                  onClick={(event: MouseEvent<HTMLButtonElement>) => {
                    holdFocus(event);
                    access.activate();
                  }}
                  before={access.loading ? <Spinner size="100" variant="Primary" /> : undefined}
                >
                  <Text size="B300">{label}</Text>
                </Button>
                {failure !== undefined && (
                  <Text role="alert" size="T200" className={css.RowError}>
                    {describeKnownError(t, failure) ??
                      t('sharedUi.roomCard.failedToJoinUnknownError')}
                    <ErrorDetail error={failure} />
                  </Text>
                )}
              </>
            );
          }}
        </RoomAccessControl>
      )}
    </li>
  );
}
