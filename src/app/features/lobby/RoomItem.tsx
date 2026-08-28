import React, { MouseEventHandler, ReactNode, useRef } from 'react';
import {
  Avatar,
  Badge,
  Box,
  Chip,
  Icon,
  Icons,
  Line,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
  Tooltip,
  TooltipProvider,
  as,
  color,
  toRem,
} from 'folds';
import FocusTrap from 'focus-trap-react';
import { JoinRule, Room } from 'matrix-js-sdk';
import { IHierarchyRoom } from 'matrix-js-sdk/lib/@types/spaces';
import { RoomAvatar, RoomIcon } from '../../components/room-avatar';
import { SequenceCard } from '../../components/sequence-card';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { HierarchyItem } from '../../hooks/useSpaceHierarchy';
import { millify } from '../../plugins/millify';
import { LocalRoomSummaryLoader } from '../../components/RoomSummaryLoader';
import { UseStateProvider } from '../../components/UseStateProvider';
import { RoomTopicViewer } from '../../components/room-topic-viewer';
import { onEnterOrSpace, stopPropagation } from '../../utils/keyboard';
import { Membership } from '../../../types/matrix/room';
import * as css from './RoomItem.css';
import * as styleCss from './style.css';
import { AsyncStatus } from '../../hooks/useAsyncCallback';
import { getDirectRoomAvatarUrl, getRoomAvatarUrl } from '../../utils/room';
import { ItemDraggableTarget, useDraggableItem } from './DnD';
import { mxcUrlToHttp } from '../../utils/matrix';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import {
  RoomAccessControl,
  RoomAccessJoinRule,
  isRoomAccessJoinRule,
} from '../../components/room-access';

type RoomJoinButtonProps = {
  roomId: string;
  roomName?: string;
  joinRule?: RoomAccessJoinRule;
  via?: string[];
};
function RoomJoinButton({ roomId, roomName, joinRule, via }: RoomJoinButtonProps) {
  const mx = useMatrixClient();
  const membership = mx.getRoom(roomId)?.getMyMembership();

  if (!isRoomAccessJoinRule(joinRule, membership)) {
    return (
      <Chip variant="Secondary" fill="Soft" size="400" radii="Pill" disabled>
        <Text size="B300">Access unavailable</Text>
      </Chip>
    );
  }

  return (
    <RoomAccessControl
      roomIdOrAlias={roomId}
      roomId={roomId}
      roomName={roomName ?? roomId}
      joinRule={joinRule}
      membership={membership}
      viaServers={via}
    >
      {(access) => {
        const canActivate = !access.loading && !access.requested && !access.succeeded;
        const accessError =
          access.state.status === AsyncStatus.Error ? access.state.error : undefined;
        return (
          <Box shrink="No" gap="200" alignItems="Center">
            {accessError && (
              <TooltipProvider
                tooltip={
                  <Tooltip variant="Critical" style={{ maxWidth: toRem(200) }}>
                    <Box direction="Column" gap="100">
                      <Text style={{ wordBreak: 'break-word' }} size="T400">
                        {accessError.data?.error || accessError.message}
                      </Text>
                      <Text size="T200">{accessError.name}</Text>
                    </Box>
                  </Tooltip>
                }
              >
                {(triggerRef) => (
                  <Icon
                    ref={triggerRef}
                    style={{ color: color.Critical.Main, cursor: 'pointer' }}
                    src={Icons.Warning}
                    size="400"
                    filled
                    tabIndex={0}
                    aria-label={accessError.data?.error || accessError.message}
                  />
                )}
              </TooltipProvider>
            )}
            <Chip
              variant="Secondary"
              fill="Soft"
              size="400"
              radii="Pill"
              before={
                access.requested ? (
                  <Icon src={Icons.Check} size="50" />
                ) : canActivate ? (
                  <Icon src={Icons.Plus} size="50" />
                ) : (
                  <Spinner variant="Secondary" size="100" />
                )
              }
              onClick={access.activate}
              disabled={!canActivate}
            >
              <Text size="B300">
                {access.kind === 'knock'
                  ? access.loading
                    ? 'Sending request'
                    : access.requested
                    ? 'Request sent'
                    : 'Request to join'
                  : 'Join'}
              </Text>
            </Chip>
          </Box>
        );
      }}
    </RoomAccessControl>
  );
}

function RoomProfileLoading() {
  return (
    <Box grow="Yes" gap="300">
      <Avatar className={styleCss.AvatarPlaceholder} />
      <Box grow="Yes" direction="Column" gap="100">
        <Box gap="200" alignItems="Center">
          <Box className={styleCss.LinePlaceholder} shrink="No" style={{ maxWidth: toRem(80) }} />
        </Box>
        <Box gap="200" alignItems="Center">
          <Box className={styleCss.LinePlaceholder} shrink="No" style={{ maxWidth: toRem(40) }} />
          <Box
            className={styleCss.LinePlaceholder}
            shrink="No"
            style={{
              maxWidth: toRem(120),
            }}
          />
        </Box>
      </Box>
    </Box>
  );
}

type RoomProfileErrorProps = {
  roomId: string;
  inaccessibleRoom: boolean;
  suggested?: boolean;
};
function RoomProfileError({ roomId, suggested, inaccessibleRoom }: RoomProfileErrorProps) {
  return (
    <Box grow="Yes" gap="300">
      <Avatar>
        <RoomAvatar
          roomId={roomId}
          src={undefined}
          alt={roomId}
          renderFallback={() => (
            <RoomIcon
              size="300"
              joinRule={inaccessibleRoom ? JoinRule.Invite : JoinRule.Restricted}
              filled
            />
          )}
        />
      </Avatar>
      <Box grow="Yes" direction="Column" className={css.ErrorNameContainer}>
        <Box gap="200" alignItems="Center">
          <Text size="H5" truncate>
            Unknown
          </Text>
          {suggested && (
            <Box shrink="No" alignItems="Center">
              <Badge variant="Success" fill="Soft" radii="Pill" outlined>
                <Text size="L400">Suggested</Text>
              </Badge>
            </Box>
          )}
        </Box>
        <Box gap="200" alignItems="Center">
          {inaccessibleRoom ? (
            <Badge variant="Secondary" fill="Soft" radii="300" size="500">
              <Text size="L400">Inaccessible</Text>
            </Badge>
          ) : (
            <Text size="T200" truncate>
              {roomId}
            </Text>
          )}
        </Box>
      </Box>
      {!inaccessibleRoom && (
        <Badge variant="Secondary" fill="Soft" radii="300" size="500">
          <Text size="L400">Access unavailable</Text>
        </Badge>
      )}
    </Box>
  );
}

type RoomProfileProps = {
  roomId: string;
  roomType?: string;
  name: string;
  topic?: string;
  avatarUrl?: string;
  suggested?: boolean;
  memberCount?: number;
  joinRule?: JoinRule;
  options?: ReactNode;
};
function RoomProfile({
  roomId,
  roomType,
  name,
  topic,
  avatarUrl,
  suggested,
  memberCount,
  joinRule,
  options,
}: RoomProfileProps) {
  return (
    <Box grow="Yes" gap="300">
      <Avatar>
        <RoomAvatar
          roomId={roomId}
          src={avatarUrl}
          alt={name}
          renderFallback={() => <RoomIcon size="300" joinRule={joinRule} roomType={roomType} />}
        />
      </Avatar>
      <Box grow="Yes" direction="Column">
        <Box gap="200" alignItems="Center">
          <Text size="H5" truncate>
            {name}
          </Text>
          {suggested && (
            <Box shrink="No" alignItems="Center">
              <Badge variant="Success" fill="Soft" radii="Pill" outlined>
                <Text size="L400">Suggested</Text>
              </Badge>
            </Box>
          )}
        </Box>
        <Box gap="200" alignItems="Center">
          {memberCount && (
            <Box shrink="No" gap="200">
              <Text size="T200" priority="300">{`${millify(memberCount)} Members`}</Text>
            </Box>
          )}
          {memberCount && topic && (
            <Line
              variant="SurfaceVariant"
              style={{ height: toRem(12) }}
              direction="Vertical"
              size="400"
            />
          )}
          {topic && (
            <UseStateProvider initial={false}>
              {(view, setView) => (
                <>
                  <Text
                    className={css.RoomProfileTopic}
                    size="T200"
                    priority="300"
                    truncate
                    onClick={() => setView(true)}
                    onKeyDown={onEnterOrSpace(() => setView(true))}
                    tabIndex={0}
                  >
                    {topic}
                  </Text>
                  <Overlay open={view} backdrop={<OverlayBackdrop />}>
                    <OverlayCenter>
                      <FocusTrap
                        focusTrapOptions={{
                          initialFocus: false,
                          clickOutsideDeactivates: true,
                          onDeactivate: () => setView(false),
                          escapeDeactivates: stopPropagation,
                        }}
                      >
                        <RoomTopicViewer
                          name={name}
                          topic={topic}
                          requestClose={() => setView(false)}
                        />
                      </FocusTrap>
                    </OverlayCenter>
                  </Overlay>
                </>
              )}
            </UseStateProvider>
          )}
        </Box>
      </Box>
      {options}
    </Box>
  );
}

type RoomItemCardProps = {
  item: HierarchyItem;
  loading: boolean;
  error: Error | null;
  summary: IHierarchyRoom | undefined;
  dm?: boolean;
  firstChild?: boolean;
  lastChild?: boolean;
  onOpen: MouseEventHandler<HTMLButtonElement>;
  options?: ReactNode;
  before?: ReactNode;
  after?: ReactNode;
  onDragging: (item?: HierarchyItem) => void;
  canReorder: boolean;
  getRoom: (roomId: string) => Room | undefined;
};
export const RoomItemCard = as<'div', RoomItemCardProps>(
  (
    {
      item,
      loading,
      error,
      summary,
      dm,
      onOpen,
      options,
      before,
      after,
      onDragging,
      canReorder,
      getRoom,
      ...props
    },
    ref
  ) => {
    const mx = useMatrixClient();
    const useAuthentication = useMediaAuthentication();
    const { roomId, content } = item;
    const room = getRoom(roomId);
    const targetRef = useRef<HTMLDivElement>(null);
    const targetHandleRef = useRef<HTMLDivElement>(null);
    useDraggableItem(item, targetRef, onDragging, targetHandleRef);

    const joined = room?.getMyMembership() === Membership.Join;

    return (
      <SequenceCard
        className={css.RoomItemCard}
        variant="SurfaceVariant"
        gap="300"
        alignItems="Center"
        {...props}
        ref={ref}
      >
        {before}
        <Box ref={canReorder ? targetRef : null} grow="Yes">
          {canReorder && <ItemDraggableTarget ref={targetHandleRef} />}
          {room ? (
            <LocalRoomSummaryLoader room={room}>
              {(localSummary) => (
                <RoomProfile
                  roomId={roomId}
                  roomType={localSummary.roomType}
                  name={localSummary.name}
                  topic={localSummary.topic}
                  avatarUrl={
                    dm
                      ? getDirectRoomAvatarUrl(mx, room, 96, useAuthentication)
                      : getRoomAvatarUrl(mx, room, 96, useAuthentication)
                  }
                  memberCount={localSummary.memberCount}
                  suggested={content.suggested}
                  joinRule={localSummary.joinRule}
                  options={
                    joined ? (
                      <Box shrink="No" gap="100" alignItems="Center">
                        <Chip
                          data-room-id={roomId}
                          onClick={onOpen}
                          variant="Secondary"
                          fill="None"
                          size="400"
                          radii="Pill"
                          aria-label="Open Room"
                        >
                          <Icon size="50" src={Icons.ArrowRight} />
                        </Chip>
                      </Box>
                    ) : (
                      <RoomJoinButton
                        roomId={roomId}
                        roomName={localSummary.name}
                        joinRule={localSummary.joinRule}
                        via={content.via}
                      />
                    )
                  }
                />
              )}
            </LocalRoomSummaryLoader>
          ) : (
            <>
              {!summary &&
                (error ? (
                  <RoomProfileError
                    roomId={roomId}
                    inaccessibleRoom={false}
                    suggested={content.suggested}
                  />
                ) : (
                  <>
                    {loading && <RoomProfileLoading />}
                    {!loading && (
                      <RoomProfileError
                        roomId={roomId}
                        inaccessibleRoom
                        suggested={content.suggested}
                      />
                    )}
                  </>
                ))}
              {summary && (
                <RoomProfile
                  roomId={roomId}
                  roomType={summary.room_type}
                  name={summary.name || summary.canonical_alias || roomId}
                  topic={summary.topic}
                  avatarUrl={
                    summary?.avatar_url
                      ? mxcUrlToHttp(mx, summary.avatar_url, useAuthentication, 96, 96, 'crop') ??
                        undefined
                      : undefined
                  }
                  memberCount={summary.num_joined_members}
                  suggested={content.suggested}
                  joinRule={summary.join_rule}
                  options={
                    <RoomJoinButton
                      roomId={roomId}
                      roomName={summary.name || summary.canonical_alias || roomId}
                      joinRule={summary.join_rule}
                      via={content.via}
                    />
                  }
                />
              )}
            </>
          )}
        </Box>
        {options}
        {after}
      </SequenceCard>
    );
  }
);
