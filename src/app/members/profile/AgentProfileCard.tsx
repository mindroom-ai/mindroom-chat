import {
  type ChangeEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Box, Button, Chip, Icon, IconButton, Icons, Input, Spinner, Text } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import {
  getAiRunCompactModelLabel,
  getAiRunModelLabel,
} from '../../matrix/protocol/aiRunModelLabel';
import { getRoomAvatarUrl } from '../../matrix/room';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { RoomAvatar } from '../../avatars/RoomAvatar';
import { nameInitials } from '../../lib/common';
import { ownDirectionBlock, revealDirectionControls } from '../../ui/directional';
import {
  AGENT_TOOL_GROUP_ICONS,
  filterAgentTools,
  groupAgentTools,
  type AgentProfile,
  type AgentTool,
  type AgentToolGroup,
} from './agentProfile';
import { MutualRoomsChip, useMutualRooms } from './MutualRoomsChip';
import { useAgentProfile } from './useAgentProfile';
import * as profileCss from './UserRoomProfile.css';
import * as css from './AgentProfileCard.css';

const KEY = 'sharedUi.agentCard';
/** Up to this many tools the card lists each one; above it, groups. */
const FEW_TOOLS = 6;
/** Groups the card shows before naming the rest in one line. */
const SUMMARY_GROUPS = 5;
/** Rooms named beside "Works in" before a "+N" chip. */
const ROOMS_SHOWN = 2;

function CapabilityRow({
  icon,
  title,
  detail,
  count,
}: {
  icon: AgentToolGroup['key'];
  title: string;
  detail: string;
  count?: number;
}) {
  return (
    <li className={css.CapabilityRow}>
      <span className={css.CapabilityIcon} aria-hidden>
        <Icon size="100" src={AGENT_TOOL_GROUP_ICONS[icon]} />
      </span>
      <Box direction="Column" style={{ minWidth: 0 }}>
        <Text size="T300" {...ownDirectionBlock}>
          {title}
        </Text>
        {detail && (
          <Text size="T200" priority="300" className={css.CapabilityDetail} {...ownDirectionBlock}>
            {detail}
          </Text>
        )}
      </Box>
      {count !== undefined && (
        <Text size="T200" priority="300">
          {count}
        </Text>
      )}
    </li>
  );
}

/** "What it can do": each tool when there are few, else the first groups and "View all". */
function Capabilities({
  tools,
  onViewAll,
  viewAllRef,
}: {
  tools: AgentTool[];
  onViewAll: () => void;
  viewAllRef: RefObject<HTMLButtonElement>;
}) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const groups = groupAgentTools(tools);
  const few = tools.length <= FEW_TOOLS;
  const rest = groups.slice(SUMMARY_GROUPS);
  const counts = few
    ? t(`${KEY}.toolCount`, { count: tools.length })
    : `${t(`${KEY}.toolCount`, { count: tools.length })} · ${t(`${KEY}.groupCount`, {
        count: groups.length,
      })}`;
  return (
    <Box className={css.Section} direction="Column" gap="300">
      <Box justifyContent="SpaceBetween" gap="200">
        <Text as="h3" size="L400" priority="300">
          {t(`${KEY}.whatItCanDo`)}
        </Text>
        <Text size="T200" priority="300">
          {counts}
        </Text>
      </Box>
      <Box as="ul" direction="Column" gap="300" style={{ margin: 0, padding: 0 }}>
        {few
          ? tools.map((tool) => (
              <CapabilityRow
                key={tool.name}
                icon={tool.group}
                title={tool.displayName}
                detail={tool.description}
              />
            ))
          : groups
              .slice(0, SUMMARY_GROUPS)
              .map((group) => (
                <CapabilityRow
                  key={group.key}
                  icon={group.key}
                  title={t(`${KEY}.groups.${group.key}.title`)}
                  detail={new Intl.ListFormat(language, { type: 'unit' }).format(
                    group.tools.slice(0, 2).map((tool) => tool.displayName)
                  )}
                  count={group.tools.length}
                />
              ))}
      </Box>
      {!few && (
        <Box className={css.Indented} direction="Column" gap="100">
          {rest.length > 0 && (
            <Text size="T200" priority="300">
              {t(`${KEY}.also`, {
                groups: new Intl.ListFormat(language).format(
                  rest.map((group) => t(`${KEY}.groups.${group.key}.name`))
                ),
              })}
            </Text>
          )}
          <button ref={viewAllRef} type="button" className={css.LinkButton} onClick={onViewAll}>
            <Text as="span" size="T200">
              {t(`${KEY}.viewAll`, { count: tools.length })}
            </Text>
            <Icon size="50" src={Icons.ChevronRight} data-directional />
          </button>
        </Box>
      )}
    </Box>
  );
}

/** Every tool by group, with a filter; Back returns to the card. */
function ToolList({
  name,
  tools,
  onBack,
}: {
  name: string;
  tools: AgentTool[];
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => back.current?.focus(), []);
  const groups = groupAgentTools(filterAgentTools(tools, query));
  return (
    <Box direction="Column" gap="300">
      <Box alignItems="Center" gap="200">
        <IconButton
          ref={back}
          size="300"
          radii="300"
          variant="SurfaceVariant"
          aria-label={t(`${KEY}.back`)}
          onClick={onBack}
        >
          <Icon size="100" src={Icons.ArrowLeft} data-directional />
        </IconButton>
        <Box grow="Yes" style={{ minWidth: 0 }}>
          <Text as="h2" size="H5" truncate>
            {t(`${KEY}.toolsTitle`, { name })}
          </Text>
        </Box>
        <Text size="T200" priority="300">
          {tools.length}
        </Text>
      </Box>
      <Input
        value={query}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
        placeholder={t(`${KEY}.filter`)}
        aria-label={t(`${KEY}.filter`)}
        variant="SurfaceVariant"
        size="300"
        radii="300"
        before={<Icon size="50" src={Icons.Search} />}
      />
      <Box className={css.ToolList} direction="Column" gap="300" tabIndex={0}>
        {groups.length === 0 && (
          <Text size="T200" priority="300" role="status">
            {t(`${KEY}.noMatch`)}
          </Text>
        )}
        {groups.map((group) => (
          <Box key={group.key} gap="200" as="section">
            <Icon size="50" src={AGENT_TOOL_GROUP_ICONS[group.key]} className={css.ToolGroupIcon} />
            <Box direction="Column" gap="100" style={{ minWidth: 0 }}>
              <Text as="h3" size="L400">
                {t(`${KEY}.groups.${group.key}.name`)}{' '}
                <Text as="span" size="T200" priority="300">
                  {group.tools.length}
                </Text>
              </Text>
              <Text size="T200" priority="300" style={{ overflowWrap: 'anywhere' }}>
                {group.tools.map((tool, index) => (
                  <span key={tool.name} title={tool.description || undefined}>
                    {index > 0 && ' · '}
                    {tool.displayName}
                  </span>
                ))}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/** "Works in": the room the card opened in first, one more, and a chip that lists them all. */
function WorksIn({ room, userId, onOpen }: { room: Room; userId: string; onOpen: () => void }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const authenticatedMedia = useMediaAuthentication();
  const { navigateRoom } = useRoomNavigate();
  const shared = useMutualRooms(userId);
  const all = shared.spaces.length + shared.rooms.length + shared.directs.length;
  if (all === 0) return null;
  const shown = [
    ...shared.rooms.filter((each) => each.roomId === room.roomId),
    ...shared.rooms.filter((each) => each.roomId !== room.roomId),
  ].slice(0, ROOMS_SHOWN);
  return (
    <Box className={css.Section} alignItems="Center" gap="200" wrap="Wrap">
      <Text size="T200" priority="300">
        {t(`${KEY}.worksIn`)}
      </Text>
      {shown.map((each) => (
        <Chip
          key={each.roomId}
          variant="SurfaceVariant"
          radii="Pill"
          className={css.RoomChip}
          before={
            <Avatar size="200" radii="300" className={css.RoomChipAvatar}>
              <RoomAvatar
                roomId={each.roomId}
                alt=""
                src={getRoomAvatarUrl(mx, each, 32, authenticatedMedia)}
                renderFallback={() => <Text size="L400">{nameInitials(each.name, 1)}</Text>}
              />
            </Avatar>
          }
          onClick={() => {
            onOpen();
            navigateRoom(each.roomId);
          }}
        >
          <Text size="B300" truncate>
            {revealDirectionControls(each.name)}
          </Text>
        </Chip>
      ))}
      {all > shown.length && (
        <MutualRoomsChip
          userId={userId}
          onOpen={onOpen}
          label={shown.length > 0 ? `+${all - shown.length}` : undefined}
        />
      )}
    </Box>
  );
}

type AgentProfileCardProps = {
  room: Room;
  userId: string;
  name: string;
  avatar: ReactNode;
  /** The role the agent publishes in the room's state, shown before the profile arrives. */
  role?: string;
  /** Sends a message to the agent; also closes the card. */
  onMessage: () => void;
  onDone: () => void;
  /** The call button, which shows only for an agent that takes calls. */
  call: ReactNode;
  /** What a person's card shows besides: the user ID, chips, moderation and blocking. */
  more: ReactNode;
};

/**
 * An agent's card: its name and model, its role, what it can do (its tools from the agent's
 * MindRoom server, by group), the rooms it works in, and Message. The user ID, the share and
 * server chips, moderation and blocking wait under "More". Without the server's profile (an older
 * server, or none Chat may ask) it shows what the room says: the name, role and rooms.
 */
export function AgentProfileCard({
  room,
  userId,
  name,
  avatar,
  role,
  onMessage,
  onDone,
  call,
  more,
}: AgentProfileCardProps) {
  const { t } = useTranslation();
  const state = useAgentProfile(room.roomId, userId);
  const [allTools, setAllTools] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const viewAll = useRef<HTMLButtonElement>(null);
  const profile: AgentProfile | undefined = state.status === 'ready' ? state.profile : undefined;
  const model = profile?.model;
  const modelLabel = model && getAiRunCompactModelLabel(model);
  const shownRole = role ?? profile?.role;

  const actions = (
    <Box direction="Column" gap="200">
      <Box gap="200">
        <Button
          style={{ flexGrow: 1 }}
          size="300"
          radii="300"
          variant="Primary"
          before={<Icon size="100" src={Icons.Message} />}
          onClick={onMessage}
        >
          <Text size="B300">{t('sharedUi.userRoomProfile.message')}</Text>
        </Button>
        <IconButton
          size="300"
          radii="300"
          variant="SurfaceVariant"
          outlined
          aria-label={t(`${KEY}.more`)}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <Icon size="100" src={Icons.HorizontalDots} />
        </IconButton>
      </Box>
      {call}
      {moreOpen && (
        <Box className={css.Section} direction="Column" gap="300" data-agent-card-more="">
          {more}
        </Box>
      )}
    </Box>
  );

  if (allTools && profile) {
    return (
      <Box className={css.AgentCard} direction="Column" gap="400">
        <ToolList
          name={name}
          tools={profile.tools}
          onBack={() => {
            setAllTools(false);
            requestAnimationFrame(() => viewAll.current?.focus());
          }}
        />
        {actions}
      </Box>
    );
  }

  return (
    <Box className={css.AgentCard} direction="Column" gap="400">
      <Box alignItems="Center" gap="300">
        {avatar}
        <Box direction="Column" gap="100" style={{ minWidth: 0 }}>
          <Box alignItems="Center" gap="200" wrap="Wrap">
            <Text as="h2" size="H5" className={profileCss.ProfileName}>
              {name}
            </Text>
            <Text as="span" size="L400" className={css.AgentBadge}>
              {t(`${KEY}.agent`)}
            </Text>
          </Box>
          {modelLabel && (
            <Text size="T200" priority="300" title={getAiRunModelLabel(model)}>
              {modelLabel}
            </Text>
          )}
        </Box>
      </Box>
      {shownRole && (
        <Text size="T300" className={profileCss.ProfileRole} {...ownDirectionBlock}>
          {shownRole}
        </Text>
      )}
      {state.status === 'loading' && (
        <Box className={css.Section} justifyContent="Center" aria-busy>
          <Spinner size="200" variant="Secondary" aria-label={t(`${KEY}.loading`)} />
        </Box>
      )}
      {profile && profile.tools.length > 0 && (
        <Capabilities
          tools={profile.tools}
          onViewAll={() => setAllTools(true)}
          viewAllRef={viewAll}
        />
      )}
      <WorksIn room={room} userId={userId} onOpen={onDone} />
      {actions}
    </Box>
  );
}
