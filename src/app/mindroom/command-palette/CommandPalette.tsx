import { Box, config, Icon, IconButton, Icons, Input, Line, Scroll, Text } from 'folds';
import React, {
  ChangeEventHandler,
  KeyboardEventHandler,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { KeySymbol } from '../../utils/key-symbol';
import { isMacOS } from '../../utils/user-agent';
import {
  getCommandPaletteSectionOrder,
  parseCommandPaletteQuery,
} from './commandPaletteQuery';
import type { CommandPaletteSource, ExecutableCommandPaletteItem } from './commandPaletteItems';
import { commandPaletteSearchConfig, searchCommandPaletteSection } from './commandPaletteSearch';
import { CommandPaletteList, type CommandPaletteListSection } from './CommandPaletteList';
import { COMMAND_PALETTE_PREFIX_HINTS } from './commandPaletteTypes';
import type {
  CommandPaletteParsedQuery,
  CommandPaletteRoomItem,
} from './commandPaletteTypes';

type CommandPaletteProps = {
  requestClose: () => void;
  source: CommandPaletteSource;
  mobileSheet?: boolean;
};

const SECTION_TITLES: Record<CommandPaletteListSection['id'], string> = {
  actions: 'Actions',
  threads: 'Threads',
  rooms: 'Rooms',
  users: 'Users',
  messages: 'Messages',
};

const getSectionTitle = (
  sectionId: CommandPaletteListSection['id'],
  parsedQuery: CommandPaletteParsedQuery
): string => {
  if (sectionId === 'rooms' && parsedQuery.mode === 'spaces') {
    return 'Spaces';
  }

  return SECTION_TITLES[sectionId];
};

const getSectionItems = ({
  sectionId,
  parsedQuery,
  source,
  spaceItems,
}: {
  sectionId: CommandPaletteListSection['id'];
  parsedQuery: CommandPaletteParsedQuery;
  source: CommandPaletteSource;
  spaceItems: readonly (CommandPaletteRoomItem & { onSelect?: () => void })[];
}): ExecutableCommandPaletteItem[] => {
  switch (sectionId) {
    case 'actions':
      return searchCommandPaletteSection({
        items: source.actions,
        query: parsedQuery.mode === 'actions' || parsedQuery.mode === 'all' ? parsedQuery.searchText : '',
        config: commandPaletteSearchConfig.actions,
      });
    case 'threads':
      return searchCommandPaletteSection({
        items: source.threads,
        query: parsedQuery.mode === 'threads' || parsedQuery.mode === 'all' ? parsedQuery.searchText : '',
        config: commandPaletteSearchConfig.threads,
      });
    case 'rooms':
      return searchCommandPaletteSection({
        items: parsedQuery.mode === 'spaces' ? spaceItems : source.rooms,
        query:
          parsedQuery.mode === 'rooms' || parsedQuery.mode === 'spaces' || parsedQuery.mode === 'all'
            ? parsedQuery.searchText
            : '',
        config: commandPaletteSearchConfig.rooms,
      });
    case 'users':
      return searchCommandPaletteSection({
        items: source.users,
        query: parsedQuery.mode === 'users' || parsedQuery.mode === 'all' ? parsedQuery.searchText : '',
        config: commandPaletteSearchConfig.users,
      });
    default:
      return source.getMessages(parsedQuery.showMessages ? parsedQuery.searchText : '');
  }
};

const buildVisibleSections = ({
  parsedQuery,
  sectionOrder,
  source,
  spaceItems,
}: {
  parsedQuery: CommandPaletteParsedQuery;
  sectionOrder: readonly CommandPaletteListSection['id'][];
  source: CommandPaletteSource;
  spaceItems: readonly (CommandPaletteRoomItem & { onSelect?: () => void })[];
}): CommandPaletteListSection[] =>
  sectionOrder
    .map((sectionId) => {
      const items = getSectionItems({
        sectionId,
        parsedQuery,
        source,
        spaceItems,
      });
      if (items.length === 0) return undefined;

      return {
        id: sectionId,
        title: getSectionTitle(sectionId, parsedQuery),
        items,
      } satisfies CommandPaletteListSection;
    })
    .filter((section): section is CommandPaletteListSection => section !== undefined);

const getResultCountLabel = (sections: readonly CommandPaletteListSection[]): string => {
  const count = sections.reduce((total, section) => total + section.items.length, 0);
  if (count === 0) return 'No results';
  if (count === 1) return '1 result';
  return `${count} results`;
};

const PREFIX_LABELS: Record<(typeof COMMAND_PALETTE_PREFIX_HINTS)[number], string> = {
  '>': 'actions',
  '#': 'rooms',
  '@': 'users',
  't:': 'threads',
  '*': 'spaces',
};

export function CommandPalette({ requestClose, source, mobileSheet = false }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const parsedQuery = useMemo(() => parseCommandPaletteQuery(query), [query]);
  const sectionOrder = useMemo(() => getCommandPaletteSectionOrder(parsedQuery), [parsedQuery]);
  const spaceItems = useMemo(
    () => source.rooms.filter((item) => item.kind === 'space'),
    [source.rooms]
  );

  const visibleSections = useMemo(
    () =>
      buildVisibleSections({
        parsedQuery,
        sectionOrder,
        source,
        spaceItems,
      }),
    [parsedQuery, sectionOrder, source, spaceItems]
  );
  const visibleItems = useMemo(
    () => visibleSections.flatMap((section) => section.items),
    [visibleSections]
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (selectedIndex < visibleItems.length) return;
    setSelectedIndex(Math.max(visibleItems.length - 1, 0));
  }, [selectedIndex, visibleItems.length]);

  const selectedItem = visibleItems[selectedIndex];

  const handleChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    setQuery(event.currentTarget.value);
  };

  const handleSelect = (item: ExecutableCommandPaletteItem) => {
    item.onSelect?.();
    setQuery('');
    requestClose();
  };

  const handleKeyDown: KeyboardEventHandler<HTMLInputElement> = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (visibleItems.length === 0) return;
      setSelectedIndex((index) => (index + 1) % visibleItems.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (visibleItems.length === 0) return;
      setSelectedIndex((index) => (index - 1 + visibleItems.length) % visibleItems.length);
      return;
    }

    if (event.key === 'Enter' && selectedItem) {
      event.preventDefault();
      handleSelect(selectedItem);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setQuery('');
      requestClose();
    }
  };

  const shortcutLabel = isMacOS() ? `${KeySymbol.Command} K` : 'Ctrl + K';

  return (
    <Box
      style={{
        flex: '1 1 auto',
        minHeight: 0,
        paddingInline: config.space.S400,
        paddingBottom: mobileSheet ? 'env(safe-area-inset-bottom, 0px)' : undefined,
      }}
      direction="Column"
      gap="200"
    >
      <Box direction="Column" gap="200" shrink="No">
        <Box gap="200" alignItems="Center">
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <Input
              autoFocus
              aria-label="Command palette"
              placeholder="Type a command or search..."
              value={query}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
            />
          </div>
          {mobileSheet && (
            <IconButton
              aria-label="Close command palette"
              variant="Surface"
              size="300"
              radii="300"
              onClick={requestClose}
            >
              <Icon src={Icons.Cross} />
            </IconButton>
          )}
        </Box>
        <div aria-live="polite">{getResultCountLabel(visibleSections)}</div>
      </Box>
      <Scroll
        style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}
        size="300"
        hideTrack
        visibility="Hover"
      >
        {visibleSections.length > 0 ? (
          <CommandPaletteList
            sections={visibleSections}
            selectedItemId={selectedItem?.id}
            onSelect={handleSelect}
          />
        ) : (
          <Text size="T300">No results</Text>
        )}
      </Scroll>
      <Box direction="Column" gap="200" shrink="No">
        <Line variant="SurfaceVariant" size="300" />
        <Text size="T200" priority="300">
          Prefixes:{' '}
          {COMMAND_PALETTE_PREFIX_HINTS.map((prefix, index) => (
            <React.Fragment key={prefix}>
              {index > 0 && '  '}
              <b>{prefix}</b> {PREFIX_LABELS[prefix]}
            </React.Fragment>
          ))}
          . Shortcut: <b>{shortcutLabel}</b> open.
        </Text>
      </Box>
    </Box>
  );
}
