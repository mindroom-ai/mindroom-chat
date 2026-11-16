import type { CommandPaletteSource, ExecutableCommandPaletteItem } from './commandPaletteItems';
import {
  getCommandPaletteSectionLimit,
  getCommandPaletteSectionOrder,
} from './commandPaletteQuery';
import {
  commandPaletteSearchConfig,
  matchCommandPaletteSection,
  type CommandPaletteMarks,
  type CommandPaletteMatch,
} from './commandPaletteSearch';
import { MATCH_SCORE } from './fuzzyMatch';
import type {
  CommandPaletteSectionId,
  CommandPaletteTab,
  CommandPaletteUserItem,
} from './commandPaletteTypes';

type LocalSectionId = Exclude<CommandPaletteSectionId, 'messages'>;

/** The rows of one section that the client finds on its own, with what to mark in each. */
export type CommandPaletteLocalSection = {
  id: LocalSectionId;
  items: ExecutableCommandPaletteItem[];
  /** By row ID. */
  marks: ReadonlyMap<string, CommandPaletteMarks>;
};

type Source = Pick<CommandPaletteSource, 'actions' | 'commands' | 'rooms' | 'threads' | 'getUsers'>;

type Options = { source: Source; tab: CommandPaletteTab; searchText: string };

// The actions and the commands as the one list typed text searches, for as long as both lists
// keep their identity, so its search index is kept too.
const searchedActions = new WeakMap<
  Source['actions'],
  { commands: Source['commands']; all: Source['actions'] }
>();

const getSearchedActions = ({ actions, commands }: Source): Source['actions'] => {
  const cached = searchedActions.get(actions);
  if (cached?.commands === commands) return cached.all;
  const all = [...actions, ...commands];
  searchedActions.set(actions, { commands, all });
  return all;
};

const matchSection = (
  sectionId: LocalSectionId,
  { source, tab, searchText }: Options
): CommandPaletteMatch<ExecutableCommandPaletteItem>[] => {
  const limit = getCommandPaletteSectionLimit(sectionId, tab);
  const typed = searchText.length > 0;
  switch (sectionId) {
    case 'actions':
      return matchCommandPaletteSection({
        // Settings and the pages' choices only show for typed text, ranked with the actions.
        items: typed ? getSearchedActions(source) : source.actions,
        query: searchText,
        config: { ...commandPaletteSearchConfig.actions, limit },
      });
    case 'threads':
      return matchCommandPaletteSection({
        items: source.threads,
        query: searchText,
        config: { ...commandPaletteSearchConfig.threads, limit },
      });
    case 'rooms':
      return matchCommandPaletteSection({
        // All's starter list is for switching rooms; spaces match by name, and Rooms lists them.
        items:
          tab === 'all' && !typed
            ? source.rooms.filter((item) => item.kind === 'room')
            : source.rooms,
        query: searchText,
        config: { ...commandPaletteSearchConfig.rooms, limit },
      });
    default:
      return matchCommandPaletteSection({
        items: source.getUsers({
          exhaustive: typed,
          includeRelatedRooms: tab === 'users' || typed,
        }),
        query: searchText,
        config: { ...commandPaletteSearchConfig.users, limit },
      });
  }
};

/**
 * How well a section's first row matches: a name that is the typed text, then a name that holds
 * it at word starts or as initials, then a field that holds it or a typo of it, then one it only
 * abbreviates. A section without rows comes last.
 */
const gradeOf = (matches: readonly CommandPaletteMatch<unknown>[]): number => {
  const score = matches[0]?.score;
  if (score === undefined) return -1;
  if (score >= MATCH_SCORE.exact) return 3;
  if (score >= MATCH_SCORE.strong) return 2;
  return score >= MATCH_SCORE.close ? 1 : 0;
};

/**
 * The sections of `tab` that the client fills from what it holds, for `searchText` (trimmed), in
 * the order shown. On All, typed text puts the section whose first row matches best first;
 * sections that match alike keep the order rooms, threads, people, actions. Only local rows
 * decide the order, so a section never moves when the server answers. A section without rows is
 * left out, except People for typed text, which the server's user directory may still fill.
 */
export const getCommandPaletteLocalSections = (options: Options): CommandPaletteLocalSection[] => {
  const { tab, searchText } = options;
  const typed = searchText.length > 0;
  const sections = getCommandPaletteSectionOrder(tab, typed)
    .filter((id): id is LocalSectionId => id !== 'messages')
    .map((id) => ({ id, matches: matchSection(id, options) }));
  if (tab === 'all' && typed) {
    // Array sort is stable: equal grades keep the order above.
    sections.sort((left, right) => gradeOf(right.matches) - gradeOf(left.matches));
  }
  return sections
    .filter(({ id, matches }) => matches.length > 0 || (id === 'users' && typed))
    .map(({ id, matches }) => ({
      id,
      items: matches.map(({ item }) => item),
      marks: new Map(matches.map(({ item, marks }) => [item.id, marks])),
    }));
};

/**
 * People from several places (the local ones, then the server's) in the order of how well they
 * match the typed text. Equal matches keep the order given, so a local row stays above a server
 * one; people nothing here matches (the server found them its own way) follow in their order.
 */
export const rankCommandPalettePeople = <T extends CommandPaletteUserItem>(
  people: readonly T[],
  query: string
): CommandPaletteMatch<T>[] =>
  matchCommandPaletteSection({
    items: people,
    query,
    config: { ...commandPaletteSearchConfig.users, limit: Number.POSITIVE_INFINITY },
    ordered: true,
  });
