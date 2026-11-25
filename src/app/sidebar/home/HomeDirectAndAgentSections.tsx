import { type MouseEventHandler, useCallback, useRef, useState } from 'react';
import { Avatar, Box, Icons, Spinner, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { Room } from 'matrix-js-sdk';
import { UserAvatar } from '../../avatars/UserAvatar';
import { nameInitials } from '../../lib/common';
import { useAlive } from '../../lib/hooks/useAlive';
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
  type HomeSidebarAgent,
} from './homeDirectSections';
import { HomeActionRowContent, HomeSectionHeader } from './HomeSectionChrome';
import * as css from './HomeSections.css';

const AGENT_AVATAR_SIZE = 96;
type RoomsNotificationPreferences = ReturnType<typeof useRoomsNotificationPreferencesContext>;

/** Small green dot overlaid on an agent's avatar while `useRoomActiveRuns` reports an active run. */
function AgentActiveRunDot({
  room,
  agentId,
  descriptionId,
}: {
  room: Room;
  agentId: string;
  descriptionId: string;
}) {
  const { t } = useTranslation();
  const { runs } = useRoomActiveRuns(room);
  const active = runs.some((run) => run.agentId === agentId);
  return (
    <>
      {active && (
        <span className={css.AgentActiveRunDot} data-agent-active-run="true" aria-hidden="true" />
      )}
      <span id={descriptionId} hidden>
        {active ? t('featureUi.homeNav.agentActive') : undefined}
      </span>
    </>
  );
}

/** Agent row for an agent without a live DM room yet; clicking opens or starts its 1:1 DM in Home. */
function HomeAgentStartRow({
  agent,
  onStart,
}: {
  agent: HomeSidebarAgent;
  onStart: (agent: HomeSidebarAgent) => Promise<void> | undefined;
}) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const alive = useAlive();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const startingRef = useRef(false);

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

  const handleSelect = () => {
    if (startingRef.current) return;
    const task = onStart(agent);
    if (!task) return;
    startingRef.current = true;
    setPending(true);
    setFailed(false);
    task
      .catch(() => {
        if (alive()) setFailed(true);
      })
      .finally(() => {
        startingRef.current = false;
        if (alive()) setPending(false);
      });
  };

  return (
    <>
      <NavItem radii="400" variant="Background">
        <NavButton
          data-home-agent-id={agent.userId}
          aria-busy={pending || undefined}
          onClick={handleSelect}
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
      {failed && (
        <Text as="p" size="T200" role="alert" className={css.AgentStartError}>
          {t('home.ask.directChatFailed', { name: agent.name })}
        </Text>
      )}
    </>
  );
}

export type HomeDirectSectionProps = {
  /** Direct rooms currently visible in the section (already resolved for collapse and compact cap). */
  visibleRooms: readonly Room[];
  /** All human direct room IDs in this section, for the collapsed unread dot and total count. */
  allRoomIds: readonly string[];
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
  visibleRooms,
  allRoomIds,
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
  const showCapToggle = !closed && allRoomIds.length > HOME_DIRECT_COMPACT_LIMIT;

  return (
    <NavCategory data-testid="home-direct-section">
      <HomeSectionHeader
        label={t('featureUi.homeNav.directMessages')}
        icon={Icons.Message}
        categoryId={HOME_DIRECT_CATEGORY_ID}
        closed={closed}
        roomIds={allRoomIds}
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
        />
      ))}
      {showCapToggle && (
        <NavItem radii="400" variant="Background">
          <NavButton data-home-dm-action="toggle-all" onClick={onToggleShowAll}>
            <HomeActionRowContent
              icon={showAll ? Icons.ChevronTop : Icons.ChevronBottom}
              iconClassName={css.SectionIcon}
              label={
                showAll
                  ? t('mindroomUi.notices.showLess')
                  : t('featureUi.homeNav.showAllDirectMessages', { count: allRoomIds.length })
              }
            />
          </NavButton>
        </NavItem>
      )}
      {!closed && (
        <NavItem radii="400" variant="Background">
          <NavLink data-home-dm-action="new" to={getDirectCreatePath()}>
            <HomeActionRowContent
              icon={Icons.Plus}
              label={t('featureUi.homeNav.newDirectMessage')}
              tintedTile
            />
          </NavLink>
        </NavItem>
      )}
    </NavCategory>
  );
}

export type HomeAgentsSectionProps = {
  /** Agents currently visible in the section (already resolved for collapsed state). */
  visibleAgents: readonly HomeSidebarAgent[];
  agentDmRoomIds: readonly string[];
  closed: boolean;
  selectedRoomId: string | undefined;
  onCategoryClick: MouseEventHandler<HTMLElement>;
  homeRoomPath: (roomId: string) => string;
  notificationPreferences: RoomsNotificationPreferences;
};

/** Collapsible Agents section on Home: opens or starts each agent's 1:1 DM while staying in Home. */
export function HomeAgentsSection({
  visibleAgents,
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
  const alive = useAlive();
  const roomVersion = useCapabilities()['m.room_versions']?.default;

  // Navigation lives on the section so a live m.direct sync swapping HomeAgentStartRow for
  // RoomNavItem before startDirectChat resolves does not cancel navigation.
  const handleStartAgent = useCallback(
    (agent: HomeSidebarAgent): Promise<void> | undefined => {
      if (agent.directRoomId) {
        void navigate(homeRoomPath(agent.directRoomId));
        return undefined;
      }
      return startDirectChat(client, agent.userId, roomVersion).then((roomId) => {
        if (alive()) void navigate(homeRoomPath(roomId));
      });
    },
    [alive, client, homeRoomPath, navigate, roomVersion]
  );

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
      {visibleAgents.map((agent) => {
        const { dmRoom } = agent;
        if (!dmRoom) {
          return <HomeAgentStartRow key={agent.userId} agent={agent} onStart={handleStartAgent} />;
        }
        return (
          <RoomNavItem
            key={agent.userId}
            room={dmRoom}
            linkPath={homeRoomPath(dmRoom.roomId)}
            selected={dmRoom.roomId === selectedRoomId}
            notificationMode={getRoomNotificationMode(notificationPreferences, dmRoom.roomId)}
            direct
            showAvatar
            nameOverride={agent.name}
            fallbackAvatarMxc={agent.avatarMxc}
            avatarBadge={(descriptionId) => (
              <AgentActiveRunDot
                room={dmRoom}
                agentId={agent.userId}
                descriptionId={descriptionId}
              />
            )}
          />
        );
      })}
    </NavCategory>
  );
}
