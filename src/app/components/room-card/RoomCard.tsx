import React, { ReactNode, useState } from 'react';
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
import { RoomAvatar, RoomIcon } from '../room-avatar';
import { RoomAccessControl, type RoomAccessJoinRule } from '../room-access';
import { AsyncStatus } from '../../hooks/useAsyncCallback';
import { isRoomId } from '../../utils/matrix';
import { stopPropagation } from '../../utils/keyboard';
import * as css from './style.css';



));



));

type RoomCardProps = {
  /** The address the card was opened from: a room ID or an alias. */
  roomIdOrAlias: string;
  /** The room ID the server confirmed for that address, when known. */









  joinRule?: RoomAccessJoinRule;
  /** State of the summary request that `joinRule` came from. */
  accessStatus?: AsyncStatus;



















      accessStatus,
      onAccessRetry,










    // Only an ID the server confirmed counts: a cached room's own alias claim is not trusted.
    const verifiedRoomId = roomId ?? (isRoomId(roomIdOrAlias) ? roomIdOrAlias : undefined);
    const joined = verifiedRoomId !== undefined && allRooms.includes(verifiedRoomId);
    const space = roomType === 'm.space';
    const roomName = name || roomIdOrAlias;

    // A summary without a rule means a public room; while loading, no rule is known yet.
    const knownJoinRule: RoomAccessJoinRule | undefined =
      accessStatus === AsyncStatus.Loading
        ? undefined
        : joinRule ?? (accessStatus === AsyncStatus.Success ? JoinRule.Public : undefined);

    const fallback =
      accessStatus === AsyncStatus.Loading ? (
        <Button className={css.ActionButton} variant="Secondary" fill="Soft" size="300" disabled>
          <Spinner size="100" variant="Secondary" />
          <Text size="B300" truncate>
            {t('sharedUi.roomCard.checkingAccess')}
          </Text>
        </Button>
      ) : accessStatus === AsyncStatus.Error && onAccessRetry ? (
        <Button
          className={css.ActionButton}
          variant="Critical"
          fill="Soft"
          size="300"
          onClick={onAccessRetry}
          before={<Icon size="50" src={Icons.Warning} />}
        >
          <Text size="B300" truncate>
            {t('sharedUi.roomCard.retryRoomInfo')}
          </Text>
        </Button>
















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
















                  {renderTopicViewer(roomName, topic, () => setViewTopic(false))}
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
                    {access.requested
                      ? t('sharedUi.roomCard.requestSent')
                      : access.kind === 'knock'
                      ? t('sharedUi.roomCard.requestToJoin')
                      : t('sharedUi.roomCard.join')}
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
