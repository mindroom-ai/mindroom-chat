import { type MouseEventHandler, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Box, Icon, Icons, Spinner, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { Room } from 'matrix-js-sdk';
import { UserAvatar } from '../../avatars/UserAvatar';
import { nameInitials } from '../../lib/common';
import { useCapabilities } from '../../matrix/hooks/useCapabilities';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { useRoomActiveRuns } from '../../matrix/hooks/useRoomActiveRuns';
import {
  getRoomNotificationMode,
  type useRoomsNotificationPreferencesContext,
} from '../../matrix/hooks/useRoomsNotificationPreferences';
import { mxcUrlToHttp } from '../../matrix/matrix';
import { getDirectCreatePath } from '../../routes/pathUtils';
import { ownDirectionLine } from '../../ui/directional';
import { NavButton, NavCategory, NavItem, NavItemContent, NavLink } from '../../ui/nav/NavItem';
import { RoomNavItem } from '../room-nav/RoomNavItem';
import { startDirectChat } from './homeAgents';
import {
  HOME_AGENTS_CATEGORY_ID,
  HOME_DIRECT_CATEGORY_ID,
  HOME_DIRECT_COMPACT_LIMIT,
  selectVisibleDirectRooms,
  type HomeSidebarAgent,
} from './homeDirectSections';
import { HomeSectionHeader } from './HomeSectionChrome';
import * as css from './HomeSections.css';

const AGENT_AVATAR_SIZE = 96;
type RoomsNotificationPreferences = ReturnType<typeof useRoomsNotificationPreferencesContext>;

/** Small green dot overlaid on an agent's avatar while `useRoomActiveRuns` reports an active run. */
function AgentActiveRunDot({ room, agentId }: { room: Room; agentId: string }) {
  const { runs } = useRoomActiveRuns(room);
  if (!runs.some((run) => run.agentId === agentId)) return null;
  return <span className={css.AgentActiveRunDot} data-agent-active-run="true" aria-hidden="true" />;
}

/** Agent row for an agent without a live DM room yet; clicking opens or starts its 1:1 DM in Home. */
function HomeAgentStartRow({
  agent,
  pending,
  onSelect,
}: {
  agent: HomeSidebarAgent;
  pending: boolean;
  onSelect: () => void;
}) {
  const client = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const avatarSrc = agent.avatarMxc
    ? (mxcUrlToHttp(
        client,
        agent.avatarMxc,
        useAuthentication,
        AGENT_AVATAR_SIZE,
        AGENT_AVATAR_SIZE,
        'crop'
      ) ?? undefined)
    : undefined;

  return (
    <NavItem radii="400" variant="Background">
      <NavButton
        data-home-agent-id={agent.userId}
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={onSelect}
      >
        <NavItemContent>
          <Box as="span" grow="Yes" alignItems="Center" gap="200">
            <Avatar size="200" radii="400">
              <UserAvatar
                userId={agent.userId}
                src={avatarSrc}
                alt={agent.name}
                renderFallback={() => (
                  <Text as="span" size="H6">
                    {nameInitials(agent.name)}
                  </Text>
                )}
              />
            </Avatar>
            <Box as="span" grow="Yes">
              <Text as="span" size="Inherit" priority="300" truncate {...ownDirectionLine}>
                {agent.name}
              </Text>
            </Box>
            {pending && <Spinner size="100" />}
          </Box>
        </NavItemContent>
      </NavButton>
    </NavItem>
  );
}

export type HomeDirectSectionProps = {
  humanDms: readonly Room[];
  closed: boolean;
  selectedRoomId: string | undefined;
  showAll: boolean;
  onToggleShowAll: () => void;
  onCategoryClick: MouseEventHandler<HTMLElement>;
  homeRoomPath: (roomId: string) => string;
  notificationPreferences: RoomsNotificationPreferences;
};

/** Collapsible Direct messages section on Home with compact cap and `+ New direct message` row. */
export function HomeDirectSection({
  humanDms,
  closed,
  selectedRoomId,
  showAll,
  onToggleShowAll,
  onCategoryClick,
  homeRoomPath,
  notificationPreferences,
}: HomeDirectSectionProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const humanDmRoomIds = useMemo(() => humanDms.map((room) => room.roomId), [humanDms]);
  const visibleRooms = useMemo(() => {
    if (closed) {
      const selected = selectedRoomId
        ? humanDms.find((room) => room.roomId === selectedRoomId)
        : undefined;
      return selected ? [selected] : [];
    }
    return selectVisibleDirectRooms(humanDms, selectedRoomId, showAll).rooms;
  }, [closed, humanDms, selectedRoomId, showAll]);

  const showCapToggle = !closed && humanDms.length > HOME_DIRECT_COMPACT_LIMIT;

  return (
    <NavCategory data-testid="home-direct-section">
      <HomeSectionHeader
        label={t('featureUi.homeNav.directMessages')}
        icon={Icons.Message}
        categoryId={HOME_DIRECT_CATEGORY_ID}
        closed={closed}
        roomIds={humanDmRoomIds}
        selectedRoomId={selectedRoomId}
        onCategoryClick={onCategoryClick}
        addAction={{
          label: t('featureUi.homeNav.newDirectMessage'),
          onClick: () => void navigate(getDirectCreatePath()),
        }}
      />
      {visibleRooms.map((room) => (
        <RoomNavItem
          key={room.roomId}
          room={room}
          linkPath={homeRoomPath(room.roomId)}
          selected={room.roomId === selectedRoomId}
          notificationMode={getRoomNotificationMode(notificationPreferences, room.roomId)}
          direct
          showAvatar
          showDraft
        />
      ))}
      {showCapToggle && (
        <NavItem radii="400" variant="Background">
          <NavButton
            data-home-dm-action="toggle-all"
            className={css.ToggleMoreRow}
            onClick={onToggleShowAll}
          >
            <NavItemContent>
              <Box as="span" alignItems="Center" gap="200" grow="Yes">
                <Avatar size="200" radii="400">
                  <Icon size="100" src={showAll ? Icons.ChevronTop : Icons.ChevronBottom} />
                </Avatar>
                <Text as="span" size="Inherit" priority="300" truncate>
                  {showAll
                    ? t('mindroomUi.notices.showLess')
                    : t('featureUi.homeNav.showAllDirectMessages', { count: humanDms.length })}
                </Text>
              </Box>
            </NavItemContent>
          </NavButton>
        </NavItem>
      )}
      {!closed && (
        <NavItem radii="400" variant="Background">
          <NavLink data-home-dm-action="new" to={getDirectCreatePath()}>
            <NavItemContent>
              <Box as="span" alignItems="Center" gap="200" grow="Yes">
                <Avatar size="200" radii="400" className={css.InlinePlusAvatar}>
                  <Icon size="100" src={Icons.Plus} />
                </Avatar>
                <Text as="span" size="Inherit" priority="300" truncate>
                  {t('featureUi.homeNav.newDirectMessage')}
                </Text>
              </Box>
            </NavItemContent>
          </NavLink>
        </NavItem>
      )}
    </NavCategory>
  );
}

export type HomeAgentsSectionProps = {
  agents: readonly HomeSidebarAgent[];
  agentDmRoomIds: readonly string[];
  closed: boolean;
  selectedRoomId: string | undefined;
  onCategoryClick: MouseEventHandler<HTMLElement>;
  homeRoomPath: (roomId: string) => string;
  notificationPreferences: RoomsNotificationPreferences;
};

/** Collapsible Agents section on Home: opens or starts each agent's 1:1 DM while staying in Home. */
export function HomeAgentsSection({
  agents,
  agentDmRoomIds,
  closed,
  selectedRoomId,
  onCategoryClick,
  homeRoomPath,
  notificationPreferences,
}: HomeAgentsSectionProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const navigate = useNavigate();
  const roomVersion = useCapabilities()['m.room_versions']?.default;
  const [pendingAgentIds, setPendingAgentIds] = useState<ReadonlySet<string>>(() => new Set());
  const pendingRef = useRef(new Set<string>());
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const visibleAgents = useMemo(() => {
    if (closed) {
      const selected = selectedRoomId
        ? agents.find((agent) => agent.dmRoom?.roomId === selectedRoomId)
        : undefined;
      return selected ? [selected] : [];
    }
    return agents;
  }, [agents, closed, selectedRoomId]);

  const handleStartDirect = (agent: HomeSidebarAgent) => {
    if (agent.directRoomId) {
      void navigate(homeRoomPath(agent.directRoomId));
      return;
    }
    if (pendingRef.current.has(agent.userId)) return;
    pendingRef.current.add(agent.userId);
    setPendingAgentIds(new Set(pendingRef.current));
    startDirectChat(client, agent.userId, roomVersion)
      .then(
        (roomId) => {
          if (aliveRef.current) void navigate(homeRoomPath(roomId));
        },
        () => undefined
      )
      .finally(() => {
        pendingRef.current.delete(agent.userId);
        if (aliveRef.current) setPendingAgentIds(new Set(pendingRef.current));
      });
  };

  return (
    <NavCategory data-testid="home-agents-section">
      <HomeSectionHeader
        label={t('featureUi.homeNav.agents')}
        icon={Icons.Category}
        categoryId={HOME_AGENTS_CATEGORY_ID}
        closed={closed}
        roomIds={agentDmRoomIds}
        selectedRoomId={selectedRoomId}
        onCategoryClick={onCategoryClick}
      />
      {visibleAgents.map((agent) =>
        agent.dmRoom ? (
          <RoomNavItem
            key={agent.userId}
            room={agent.dmRoom}
            linkPath={homeRoomPath(agent.dmRoom.roomId)}
            selected={agent.dmRoom.roomId === selectedRoomId}
            notificationMode={getRoomNotificationMode(notificationPreferences, agent.dmRoom.roomId)}
            direct
            showAvatar
            showDraft
            nameOverride={agent.name}
            fallbackAvatarMxc={agent.avatarMxc}
            avatarBadge={<AgentActiveRunDot room={agent.dmRoom} agentId={agent.userId} />}
          />
        ) : (
          <HomeAgentStartRow
            key={agent.userId}
            agent={agent}
            pending={pendingAgentIds.has(agent.userId)}
            onSelect={() => handleStartDirect(agent)}
          />
        )
      )}
    </NavCategory>
  );
}
