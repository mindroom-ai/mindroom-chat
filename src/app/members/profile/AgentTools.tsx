import {
  type ChangeEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Avatar,
  Box,
  Button,
  Chip,
  Icon,
  IconButton,
  Icons,
  Input,
  Spinner,
  Text,
  type IconSrc,
} from 'folds';
import type { Room } from 'matrix-js-sdk';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { formatNumber } from '../../lib/localDigits';
import { nameInitials } from '../../lib/common';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { getRoomAvatarUrl } from '../../matrix/room';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { RoomAvatar } from '../../avatars/RoomAvatar';
import { ownDirectionBlock, ownDirectionLine, revealDirectionControls } from '../../ui/directional';
import { groupAgentTools, type AgentTool } from './agentProfile';
import { MutualRoomsChip, type Shared } from './MutualRoomsChip';
import { useAgentProfile, type AgentProfileState } from './useAgentProfile';
import * as css from './AgentTools.css';

const KEY = 'sharedUi.agentCard';
/** Up to this many tools the card lists each one; above it, groups. */
const FEW_TOOLS = 6;
/** Groups the card shows before naming the rest in one line. */
const SUMMARY_GROUPS = 5;
/** Rooms named beside "Works in" before the chip that lists them all. */
const ROOMS_SHOWN = 2;

type ReadProps = {
  room: Room;
  agentUserId: string;
  children: (state: AgentProfileState) => ReactNode;
};

/** Reads an agent's profile while what it holds is shown, for `children` to draw. */
export function AgentProfileRead({ room, agentUserId, children }: ReadProps) {
  return <>{children(useAgentProfile(room, agentUserId))}</>;
}

type RowProps = { icon: IconSrc; title: string; detail: string; count?: number };

function Row({ icon, title, detail, count }: RowProps) {
  const language = useAppLanguageCode();
  return (
    <li className={css.Row}>
      <Icon size="100" src={icon} className={css.GroupIcon} aria-hidden />
      <Box direction="Column" style={{ minWidth: 0 }}>
        <Text size="T300" {...ownDirectionBlock}>
          {title}
        </Text>
        {detail && (
          <Text size="T200" priority="300" className={css.Wrap} {...ownDirectionBlock}>
            {detail}
          </Text>
        )}
      </Box>
      {count !== undefined && (
        <Text size="T200" priority="300">
          {formatNumber(count, language)}
        </Text>
      )}
    </li>
  );
}

type CapabilitiesProps = {
  state: AgentProfileState;
  onViewAll: () => void;
  viewAllRef: RefObject<HTMLButtonElement>;
};

/** "Configured tools": each tool when there are few, else the first groups and "View all". */
export function AgentCapabilities({ state, onViewAll, viewAllRef }: CapabilitiesProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  if (state.status === 'loading') {
    return (
      <Box className={css.Section} justifyContent="Center">
        <Spinner size="200" variant="Secondary" aria-label={t(`${KEY}.loading`)} />
      </Box>
    );
  }
  const tools = state.status === 'ready' ? state.profile.tools : [];
  if (tools.length === 0) return null;
  const groups = groupAgentTools(tools);
  const few = tools.length <= FEW_TOOLS;
  const groupName = (key: string) => t(`${KEY}.groups.${key}` as never);
  const list = (names: string[], type: 'unit' | 'conjunction') =>
    new Intl.ListFormat(language, { type }).format(names);
  return (
    <Box className={css.Section} direction="Column" gap="300">
      <Box justifyContent="SpaceBetween" gap="200" wrap="Wrap">
        <Text as="h3" size="L400" priority="300">
          {t(`${KEY}.configuredTools`)}
        </Text>
        <Text size="T200" priority="300">
          <bdi>{t(`${KEY}.toolCount`, { count: tools.length })}</bdi>
          {!few && (
            <>
              {' · '}
              <bdi>{t(`${KEY}.groupCount`, { count: groups.length })}</bdi>
            </>
          )}
        </Text>
      </Box>
      <Box as="ul" direction="Column" gap="300" style={{ margin: 0, padding: 0 }}>
        {few
          ? groups.flatMap((group) =>
              group.tools.map((tool) => (
                <Row
                  key={tool.name}
                  icon={group.icon}
                  title={tool.displayName}
                  detail={tool.description}
                />
              ))
            )
          : groups.slice(0, SUMMARY_GROUPS).map((group) => (
              <Row
                key={group.key}
                icon={group.icon}
                title={groupName(group.key)}
                detail={list(
                  group.tools.slice(0, 2).map((tool) => tool.displayName),
                  'unit'
                )}
                count={group.tools.length}
              />
            ))}
      </Box>
      <Box className={css.Indented} direction="Column" gap="100" alignItems="Start">
        {groups.length > SUMMARY_GROUPS && !few && (
          <Text size="T200" priority="300">
            {t(`${KEY}.also`, {
              groups: list(
                groups.slice(SUMMARY_GROUPS).map((group) => groupName(group.key)),
                'conjunction'
              ),
            })}
          </Text>
        )}
        {!few && (
          <Button
            ref={viewAllRef}
            className={css.ViewAll}
            size="300"
            radii="300"
            variant="Primary"
            fill="None"
            after={<Icon size="50" src={Icons.ChevronRight} data-directional />}
            onClick={onViewAll}
          >
            <Text size="T200">{t(`${KEY}.viewAll`, { count: tools.length })}</Text>
          </Button>
        )}
        <Text size="T200" priority="300">
          {t(`${KEY}.availability`)}
        </Text>
      </Box>
    </Box>
  );
}

type ListProps = { name: string; tools: AgentTool[]; onBack: () => void };

/** Every tool by group, with a filter; a tool's name opens its description. Back returns to the card. */
export function AgentToolList({ name, tools, onBack }: ListProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const [query, setQuery] = useState('');
  const [opened, setOpened] = useState<string>();
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => back.current?.focus(), []);
  const groups = groupAgentTools(tools, query);
  const title = t(`${KEY}.toolsTitle`, { name });
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
        <Text as="h2" size="H5" truncate>
          {title}
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
      <Box
        className={css.ToolList}
        direction="Column"
        gap="300"
        role="region"
        aria-label={title}
        tabIndex={0}
      >
        {groups.length === 0 && (
          <Text size="T200" priority="300" role="status">
            {t(`${KEY}.noMatch`)}
          </Text>
        )}
        {groups.map((group) => {
          const description = group.tools.find((tool) => tool.name === opened)?.description;
          return (
            <Box key={group.key} as="section" gap="200">
              <Icon size="50" src={group.icon} className={css.GroupIcon} />
              <Box direction="Column" gap="100" style={{ minWidth: 0 }}>
                <Text as="h3" size="L400">
                  {t(`${KEY}.groups.${group.key}` as never)}{' '}
                  <Text as="span" size="T200" priority="300">
                    {formatNumber(group.tools.length, language)}
                  </Text>
                </Text>
                <Box wrap="Wrap" gap="100" {...ownDirectionLine}>
                  {group.tools.map((tool) => (
                    <Chip
                      key={tool.name}
                      variant="SurfaceVariant"
                      radii="Pill"
                      aria-expanded={tool.description ? opened === tool.name : undefined}
                      disabled={!tool.description}
                      onClick={() => setOpened(opened === tool.name ? undefined : tool.name)}
                    >
                      <Text size="T200">{tool.displayName}</Text>
                    </Chip>
                  ))}
                </Box>
                {description && (
                  <Text size="T200" className={css.Wrap} {...ownDirectionBlock}>
                    {description}
                  </Text>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
      <Text size="T200" priority="300">
        {t(`${KEY}.availability`)}
      </Text>
    </Box>
  );
}

type WorksInProps = { room: Room; shared: Shared; onOpen: () => void };

/** "Works in": the room the card opened in first, one more, and the chip that lists every shared room. */
export function WorksIn({ room, shared, onOpen }: WorksInProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const authenticatedMedia = useMediaAuthentication();
  const { navigateRoom } = useRoomNavigate();
  const all = shared.spaces.length + shared.rooms.length + shared.directs.length;
  if (all === 0) return null;
  const shown = [...shared.rooms]
    .sort((a, b) => Number(b.roomId === room.roomId) - Number(a.roomId === room.roomId))
    .slice(0, ROOMS_SHOWN);
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
          style={{ maxWidth: '45%' }}
          before={
            <Avatar size="200" radii="300">
              <RoomAvatar
                roomId={each.roomId}
                alt=""
                src={getRoomAvatarUrl(mx, each, 32, authenticatedMedia)}
                renderFallback={() => <Text size="L400">{nameInitials(each.name)}</Text>}
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
          shared={shared}
          onOpen={onOpen}
          label={
            shown.length > 0 ? t(`${KEY}.moreRooms`, { count: all - shown.length }) : undefined
          }
        />
      )}
    </Box>
  );
}
