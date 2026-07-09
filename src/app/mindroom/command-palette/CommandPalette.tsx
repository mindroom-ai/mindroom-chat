import { Box, config, Icon, IconButton, Icons, Input, Line, Scroll, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { type TFunction } from 'i18next';
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

const SECTION_TITLE_KEYS = {
  actions: 'commandPalette.sections.actions',
  threads: 'commandPalette.sections.threads',
  rooms: 'commandPalette.sections.rooms',
  users: 'commandPalette.sections.users',
  messages: 'commandPalette.sections.messages',
} as const satisfies Record<CommandPaletteListSection['id'], string>;

const getSectionTitle = (
  sectionId: CommandPaletteListSection['id'],
  parsedQuery: CommandPaletteParsedQuery,
  t: TFunction
): string => {
  if (sectionId === 'rooms' && parsedQuery.mode === 'spaces') {
    return t('commandPalette.sections.spaces');
  }

  return t(SECTION_TITLE_KEYS[sectionId]);
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
  t,
}: {
  parsedQuery: CommandPaletteParsedQuery;
  sectionOrder: readonly CommandPaletteListSection['id'][];
  source: CommandPaletteSource;
  spaceItems: readonly (CommandPaletteRoomItem & { onSelect?: () => void })[];
  t: TFunction;
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
        title: getSectionTitle(sectionId, parsedQuery, t),
        items,
      } satisfies CommandPaletteListSection;
    })
    .filter((section): section is CommandPaletteListSection => section !== undefined);

const getResultCountLabel = (
  sections: readonly CommandPaletteListSection[],
  t: TFunction
): string => {
  const count = sections.reduce((total, section) => total + section.items.length, 0);
  if (count === 0) return t('commandPalette.noResults');
  return t('commandPalette.resultCount', { count });
};

const PREFIX_LABEL_KEYS = {
  '>': 'commandPalette.prefixes.actions',
  '#': 'commandPalette.prefixes.rooms',
  '@': 'commandPalette.prefixes.users',
  't:': 'commandPalette.prefixes.threads',
  '*': 'commandPalette.prefixes.spaces',
} as const satisfies Record<(typeof COMMAND_PALETTE_PREFIX_HINTS)[number], string>;

export function CommandPalette({ requestClose, source, mobileSheet = false }: CommandPaletteProps) {
  const { t } = useTranslation();
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
        t,
      }),
    [parsedQuery, sectionOrder, source, spaceItems, t]
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
              aria-label={t('commandPalette.inputAria')}
              placeholder={t('commandPalette.placeholder')}
              value={query}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
            />
          </div>
          {mobileSheet && (
            <IconButton
              aria-label={t('commandPalette.closeAria')}
              variant="Surface"
              size="300"
              radii="300"
              onClick={requestClose}
            >
              <Icon src={Icons.Cross} />
            </IconButton>
          )}
        </Box>
        <div aria-live="polite">{getResultCountLabel(visibleSections, t)}</div>
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
          <Text size="T300">{t('commandPalette.noResults')}</Text>
        )}
      </Scroll>
      <Box direction="Column" gap="200" shrink="No">
        <Line variant="SurfaceVariant" size="300" />
        <Text size="T200" priority="300">
          {t('commandPalette.prefixes.label')}{' '}
          {COMMAND_PALETTE_PREFIX_HINTS.map((prefix, index) => (
            <React.Fragment key={prefix}>
              {index > 0 && '  '}
              <b>{prefix}</b> {t(PREFIX_LABEL_KEYS[prefix])}
            </React.Fragment>
          ))}
          {'. '}
          {t('commandPalette.shortcut')} <b>{shortcutLabel}</b> {t('commandPalette.shortcutOpenSuffix')}
        </Text>
      </Box>
    </Box>
  );
}
