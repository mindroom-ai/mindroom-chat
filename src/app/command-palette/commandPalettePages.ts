import { Icons, type IconSrc } from 'folds';
import type { CommandPaletteActionItem, CommandPalettePageId } from './commandPaletteTypes';

/** Each page's icon: on the row that opens it and on each of its choices. */
export const COMMAND_PALETTE_PAGE_ICONS: Readonly<Record<CommandPalettePageId, IconSrc>> = {
  theme: Icons.Sun,
  'message-layout': Icons.Message,
  language: Icons.Globe,
};

export type CommandPaletteChoice = {
  value: string;
  title: string;
  current: boolean;
  /** The language of the title, when it is not the app's. */
  lang?: string;
};

/** A page's choices as rows `<pageId>:<value>`, in the given order (sortRank descends), searched by title only. */
export const getCommandPalettePageRows = (
  pageId: CommandPalettePageId,
  choices: readonly CommandPaletteChoice[]
): CommandPaletteActionItem[] =>
  choices.map((choice, index) => ({
    id: `${pageId}:${choice.value}`,
    kind: 'action',
    title: choice.title,
    icon: COMMAND_PALETTE_PAGE_ICONS[pageId],
    current: choice.current,
    sortRank: choices.length - index,
    ...(choice.lang === undefined ? {} : { lang: choice.lang }),
  }));

/** The rows as the first list's search shows them: tagged with their page's title. */
export const tagCommandPalettePageRows = <T extends CommandPaletteActionItem>(
  pageTitle: string,
  rows: readonly T[]
): T[] => rows.map((row) => ({ ...row, tag: pageTitle }));
