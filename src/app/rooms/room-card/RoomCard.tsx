import { ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import FocusTrap from 'focus-trap-react';
import {
  Avatar,
  Box,
  Button,
  Icon,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
  as,
} from 'folds';
import { JoinRule } from 'matrix-js-sdk';
import { RoomAvatar } from '../../avatars/room-avatar/RoomAvatar';
import { getRoomIconSrc } from '../../avatars/room-avatar/roomIconSrc';
import { RoomAccessControl, type RoomAccessJoinRule } from '../room-access/RoomAccessControl';
import { AsyncStatus } from '../../lib/hooks/useAsyncCallback';
import { isRoomId } from '../../matrix/matrix';
import { stopPropagation } from '../../lib/keyboard';
import * as css from './style.css';

export const RoomCardGrid = as<'div'>(({ className, ...props }, ref) => (
  <div {...props} className={classNames(css.CardGrid, className)} ref={ref} />
));

export const RoomCardBase = as<'div'>(({ className, ...props }, ref) => (
  <div {...props} className={classNames(css.RoomCardBase, className)} ref={ref} />
));

/** Where the card points: the address it was opened from, the confirmed ID, how to reach it. */
type CardTarget = { roomIdOrAlias: string; roomId?: string; viaServers?: string[] };

/** What the directory or summary says about the room; the address stands in for a missing name. */
type CardListing = { name?: string; topic?: string; avatarUrl?: string };

/** Member count and `m.space` for spaces. */
type CardFacts = { memberCount?: number; roomType?: string };

/** Renders the full topic, in the dialog that the topic button opens. */
type TopicViewerRenderer = (name: string, topic: string, requestClose: () => void) => ReactNode;

type RoomCardProps = CardTarget &
  CardListing &
  CardFacts & {
    /** IDs of the rooms the user has joined. */
    allRooms: string[];
    /** The access rule the room summary reported. */
    joinRule?: RoomAccessJoinRule;
    /** State of the summary request that `joinRule` came from. */
    accessStatus?: AsyncStatus;
    /** Retries the summary request after it failed. */
    onAccessRetry?: () => void;
    /** Opens a room the user has already joined. */
    onView?: (roomId: string) => void;
    renderTopicViewer: TopicViewerRenderer;
  };

/** A room or space in a card grid: avatar, name, topic, members, and the way in (or View). */
export const RoomCard = as<'div', RoomCardProps>(
  (
    {
      roomIdOrAlias,
      roomId,
      viaServers,
      allRooms,
      name,
      topic,
      avatarUrl,
      memberCount,
      roomType,
      joinRule,
      accessStatus,
      onAccessRetry,
      onView,
      renderTopicViewer,
      ...divProps
    },
    ref
  ) => {
    const { t } = useTranslation();
    const [topicOpen, setTopicOpen] = useState(false);

    // Only an ID the server confirmed counts: a cached room's own alias claim is not trusted.
    const verifiedRoomId = roomId ?? (isRoomId(roomIdOrAlias) ? roomIdOrAlias : undefined);
    const joined = verifiedRoomId !== undefined && allRooms.includes(verifiedRoomId);
    const space = roomType === 'm.space';
    const roomName = name || roomIdOrAlias;

    // Only a summary that answered gives a rule (none in it means public). While it loads, or
    // after it failed, any rule passed in is unconfirmed, so access waits for a retry unless
    // the user's own membership (invite, knock) grants it.
    let knownJoinRule: RoomAccessJoinRule | undefined;
    if (accessStatus === AsyncStatus.Success) knownJoinRule = joinRule ?? JoinRule.Public;
    else if (accessStatus === undefined) knownJoinRule = joinRule;

    // While the summary loads, or after it failed with a way to retry, that takes the action's place.
    let fallback: ReactNode = null;
    if (accessStatus === AsyncStatus.Loading) {
      fallback = (
        <Button disabled size="300" fill="Soft" variant="Secondary" className={css.ActionButton}>
          <Spinner variant="Secondary" size="100" />
          <Text truncate size="B300">
            {t('sharedUi.roomCard.checkingAccess')}
          </Text>
        </Button>
      );
    } else if (accessStatus === AsyncStatus.Error && onAccessRetry) {
      fallback = (
        <Button
          before={<Icon src={Icons.Warning} size="50" />}
          onClick={onAccessRetry}
          size="300"
          fill="Soft"
          variant="Critical"
          className={css.ActionButton}
        >
          <Text truncate size="B300">
            {t('sharedUi.roomCard.retryRoomInfo')}
          </Text>
        </Button>
      );
    }

    const avatarFallback = () => (
      <Icon filled size="400" src={getRoomIconSrc(space, knownJoinRule)} />
    );

    return (
      <RoomCardBase {...divProps} ref={ref}>
        <Box gap="200" alignItems="Start">
          <Avatar size="500" radii="400">
            <RoomAvatar
              alt={roomName}
              src={avatarUrl}
              roomId={verifiedRoomId ?? roomIdOrAlias}
              renderFallback={avatarFallback}
            />
          </Avatar>
        </Box>
        <Box grow="Yes" direction="Column" gap="100">
          <Text size="H5" truncate>
            {roomName}
          </Text>
          {topic && (
            <Text
              as="button"
              type="button"
              size="T200"
              className={css.RoomCardTopic}
              onClick={() => setTopicOpen(true)}
            >
              {topic}
            </Text>
          )}
          {topic && topicOpen && (
            <Overlay open backdrop={<OverlayBackdrop />}>
              <OverlayCenter>
                <FocusTrap
                  focusTrapOptions={{
                    onDeactivate: () => setTopicOpen(false),
                    escapeDeactivates: stopPropagation,
                    clickOutsideDeactivates: true,
                    initialFocus: false,
                  }}
                >
                  {renderTopicViewer(roomName, topic, () => setTopicOpen(false))}
                </FocusTrap>
              </OverlayCenter>
            </Overlay>
          )}
        </Box>
        <Box gap="200" alignItems="Center">
          {typeof memberCount === 'number' && (
            <Box grow="Yes" gap="100" alignItems="Center">
              <Icon size="50" src={Icons.User} />
              <Text size="T200">{t('sharedUi.roomCard.members', { count: memberCount })}</Text>
            </Box>
          )}
          {joined && verifiedRoomId ? (
            <Button
              className={css.ActionButton}
              variant="Secondary"
              fill="Soft"
              size="300"
              onClick={() => onView?.(verifiedRoomId)}
            >
              <Text size="B300" truncate>
                {t('sharedUi.roomCard.view')}
              </Text>
            </Button>
          ) : (
            <RoomAccessControl
              roomIdOrAlias={roomIdOrAlias}
              roomId={roomId}
              roomName={roomName}
              joinRule={knownJoinRule}
              viaServers={viaServers}
              fallback={fallback}
            >
              {(access) => (
                <Button
                  className={css.ActionButton}
                  variant={access.requested ? 'Secondary' : 'Primary'}
                  fill={access.requested ? 'Soft' : 'Solid'}
                  size="300"
                  disabled={access.loading || access.requested}
                  onClick={access.activate}
                  before={access.loading ? <Spinner size="100" variant="Primary" /> : undefined}
                >
                  <Text size="B300" truncate>
                    {access.loading &&
                      (access.kind === 'knock'
                        ? t('sharedUi.roomCard.sendingRequest')
                        : t('sharedUi.roomCard.joining'))}
                    {!access.loading &&
                      (access.requested
                        ? t('sharedUi.roomCard.requestSent')
                        : access.kind === 'knock'
                        ? t('sharedUi.roomCard.requestToJoin')
                        : t('sharedUi.roomCard.join'))}
                  </Text>
                </Button>
              )}
            </RoomAccessControl>
          )}
        </Box>
      </RoomCardBase>
    );
  }
);
