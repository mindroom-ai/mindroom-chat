import type { CommandPaletteSectionId, CommandPaletteTab } from './commandPaletteTypes';

// Switching rooms is the most common reason to open the palette, so rooms lead All. Messages
// come from the server after everything else, so they go last and arrive below what is shown.
const ALL_EMPTY_SECTION_ORDER: readonly CommandPaletteSectionId[] = [
  'rooms',
  'threads',
  'actions',
  'users',
];

const ALL_TYPED_SECTION_ORDER: readonly CommandPaletteSectionId[] = [
  'rooms',
  'threads',
  'users',
  'actions',
  'messages',
];

// All shows the top few of each section; a section's own tab shows many more.
const ALL_TAB_SECTION_LIMITS: Readonly<Record<CommandPaletteSectionId, number>> = {
  rooms: 5,
  threads: 3,
  users: 3,
  actions: 3,
  messages: 3,
};

const OWN_TAB_SECTION_LIMIT = 50;

export const getCommandPaletteSectionOrder = (
  tab: CommandPaletteTab,
  hasSearchText: boolean
): readonly CommandPaletteSectionId[] => {
  if (tab !== 'all') return [tab];
  return hasSearchText ? ALL_TYPED_SECTION_ORDER : ALL_EMPTY_SECTION_ORDER;
};

export const getCommandPaletteSectionLimit = (
  sectionId: CommandPaletteSectionId,
  tab: CommandPaletteTab
): number => (tab === 'all' ? ALL_TAB_SECTION_LIMITS[sectionId] : OWN_TAB_SECTION_LIMIT);
