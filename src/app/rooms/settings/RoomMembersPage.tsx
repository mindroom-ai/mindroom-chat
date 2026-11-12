import {
  type ChangeEvent,
  type MouseEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import FocusTrap from 'focus-trap-react';
import { Box, Chip, Icon, Icons, Input, Text, config, toRem } from 'folds';
import { PopOut } from '../../ui/directional';
import type { RectCords } from 'folds';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Room } from 'matrix-js-sdk';
import { Menu, MenuItem } from '../../ui/glass/GlassPrimitives';
import { MemberSortMenu } from '../../members/MemberSortMenu';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useRoomMembers } from '../../matrix/hooks/useRoomMembers';
import { usePowerLevels } from '../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { useMembershipFilterMenu } from '../../members/useMemberFilter';
import { useMemberSort, useMemberSortMenu } from '../../members/useMemberSort';
import { useFlattenPowerTagMembers, useGetMemberPowerTag } from '../../members/useMemberPowerTag';
import { useAgentRoles } from '../../members/useAgentRoles';
import { stopPropagation } from '../../lib/keyboard';
import {
  type ListEntry,
  MemberGroupTitle,
  MemberRow,
  entryKey,
  matchesQuery,
  toListEntries,
} from '../../members/MembersDrawer';
import * as drawerCss from '../../members/MembersDrawer.css';
import { SettingsPageFrame } from '../../ui/settings/SettingsPageFrame';

const MEMBERS = 'featureUi.commonSettings.members';
const TITLE_ROW = 32;
const TITLE_GAP = 12;
const PERSON_ROW = 40;

/** Opens under the clicked chip and closes again; one per menu on the page. */
const useChipMenu = () => {
  const [anchor, setAnchor] = useState<RectCords>();
  return {
    anchor,
    toggle: (event: MouseEvent<HTMLButtonElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      setAnchor((open) => (open ? undefined : rect));
    },
    close: () => setAnchor(undefined),
  };
};

/** Which memberships the list shows; each choice is a plain button that says if it is on. */
function MembershipChoices({
  names,
  current,
  onPick,
  onDismiss,
}: {
  names: string[];
  current: number;
  onPick: (index: number) => void;
  onDismiss: () => void;
}) {
  return (
    <FocusTrap
      focusTrapOptions={{
        initialFocus: false,
        clickOutsideDeactivates: true,
        escapeDeactivates: stopPropagation,
        onDeactivate: onDismiss,
      }}
    >
      <Menu>
        <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
          {names.map((name, index) => (
            <MenuItem
              key={name}
              size="300"
              radii="300"
              role="menuitemradio"
              aria-checked={index === current}
              fill={index === current ? 'Soft' : 'None'}
              after={index === current ? <Icon size="50" src={Icons.Check} /> : undefined}
              onClick={() => onPick(index)}
            >
              <Text size="T300" style={{ flexGrow: 1, textAlign: 'start' }}>
                {name}
              </Text>
            </MenuItem>
          ))}
        </Box>
      </Menu>
    </FocusTrap>
  );
}

/**
 * Everyone in the room, under their power level groups: one membership at a time, in the chosen
 * order, narrowed by a search. The rows are a virtual list in the page's own scroll area.
 */
export function RoomMembersPage({ room, requestClose }: { room: Room; requestClose: () => void }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const members = useRoomMembers(client, room.roomId);
  const levels = usePowerLevels(room);
  const creators = useRoomCreators(room);
  const filters = useMembershipFilterMenu();
  const sorts = useMemberSortMenu();
  const agentRoles = useAgentRoles(room);
  const [filterIndex, setFilterIndex] = useState(0);
  const [sortIndex, setSortIndex] = useState(0);
  const [search, setSearch] = useState('');
  const filterMenu = useChipMenu();
  const sortMenu = useChipMenu();
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [listTop, setListTop] = useState(0);

  const filter = filters[filterIndex] ?? filters[0];
  const sort = useMemberSort(sortIndex, sorts);
  const needle = search.trim().toLowerCase();
  const shown = useMemo(() => {
    const kept = members.filter(
      (member) => filter.filterFn(member) && (!needle || matchesQuery(room, member, needle))
    );
    return sort ? kept.sort(sort.sortFn) : kept;
  }, [filter, members, needle, room, sort]);
  const grouped = useFlattenPowerTagMembers(shown, useGetMemberPowerTag(room, creators, levels));
  const entries = useMemo<ListEntry[]>(() => toListEntries(grouped), [grouped]);

  // The list's distance from the top of the scrolled content, under the title and the toolbar.
  useLayoutEffect(() => {
    const list = listRef.current;
    const viewport = scrollRef.current;
    if (!list || !viewport) return;
    const top =
      list.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
    setListTop(Math.round(top));
  }, [needle]);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const entry = entries[index];
      if (entry?.kind !== 'group') return PERSON_ROW;
      return TITLE_ROW + (entry.spaced ? TITLE_GAP : 0);
    },
    getItemKey: (index) => {
      const entry = entries[index];
      return entry ? `${filterIndex}:${entryKey(entry)}` : index;
    },
    scrollMargin: listTop,
    overscan: 8,
  });

  // Another membership or search reads from the top.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [filterIndex, needle]);

  const joined = room.getJoinedMemberCount();
  let empty: string | undefined;
  if (shown.length === 0) {
    empty = needle
      ? t(`${MEMBERS}.noResults`)
      : t(`${MEMBERS}.noMembersForFilter`, { filter: filter.name });
  }

  return (
    <SettingsPageFrame
      title={t(`${MEMBERS}.memberCount`, { count: joined })}
      requestClose={requestClose}
      scrollRef={scrollRef}
    >
      <Box direction="Column" gap="200">
        <Box alignItems="Center" justifyContent="SpaceBetween" gap="200">
          <PopOut
            anchor={filterMenu.anchor}
            position="Bottom"
            align="Start"
            offset={4}
            content={
              <MembershipChoices
                names={filters.map((item) => item.name)}
                current={filterIndex}
                onPick={(index) => {
                  filterMenu.close();
                  setFilterIndex(index);
                }}
                onDismiss={filterMenu.close}
              />
            }
          >
            <Chip
              variant="SurfaceVariant"
              radii="300"
              aria-haspopup="menu"
              aria-expanded={!!filterMenu.anchor}
              before={<Icon size="50" src={Icons.Filter} />}
              onClick={filterMenu.toggle}
            >
              <Text size="T200">{filter.name}</Text>
            </Chip>
          </PopOut>
          {sort && (
            <PopOut
              anchor={sortMenu.anchor}
              position="Bottom"
              align="End"
              offset={4}
              content={
                <MemberSortMenu
                  items={sorts}
                  selected={sortIndex}
                  onSelect={(index: number) => {
                    sortMenu.close();
                    setSortIndex(index);
                  }}
                  onDismiss={sortMenu.close}
                />
              }
            >
              <Chip
                variant="SurfaceVariant"
                radii="300"
                aria-haspopup="menu"
                aria-expanded={!!sortMenu.anchor}
                after={<Icon size="50" src={Icons.Sort} />}
                onClick={sortMenu.toggle}
              >
                <Text size="T200">{sort.name}</Text>
              </Chip>
            </PopOut>
          )}
        </Box>
        <Input
          value={search}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)}
          placeholder={t(`${MEMBERS}.search`)}
          aria-label={t(`${MEMBERS}.search`)}
          variant="SurfaceVariant"
          size="400"
          radii="400"
          before={<Icon size="50" src={Icons.Search} />}
          after={
            needle ? (
              <Text size="T200" priority="300" style={{ flexShrink: 0 }}>
                {t(`${MEMBERS}.resultCount`, { count: shown.length })}
              </Text>
            ) : undefined
          }
        />
        <div
          ref={listRef}
          style={{ position: 'relative', height: virtualizer.getTotalSize(), minHeight: toRem(1) }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const entry = entries[item.index];
            if (!entry) return null;
            return (
              <div
                key={item.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className={drawerCss.DrawerVirtualItem}
                style={{ transform: `translateY(${item.start - listTop}px)` }}
              >
                {entry.kind === 'group' ? (
                  <MemberGroupTitle tag={entry.tag} spaced={entry.spaced} />
                ) : (
                  <MemberRow
                    room={room}
                    member={entry.member}
                    role={agentRoles.get(entry.member.userId)}
                  />
                )}
              </div>
            );
          })}
        </div>
        {empty && (
          <Box justifyContent="Center" style={{ padding: config.space.S400 }}>
            <Text size="T300" priority="300">
              {empty}
            </Text>
          </Box>
        )}
      </Box>
    </SettingsPageFrame>
  );
}
