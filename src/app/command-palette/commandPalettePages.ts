import type { CommandPaletteActionItem, CommandPalettePageId } from './commandPaletteTypes';

export type CommandPaletteChoice = { value: string; title: string; current: boolean };

/** A page's choices as rows `<pageId>:<value>`, in the given order (sortRank descends), searched by title only. */
export const getCommandPalettePageRows = (
  pageId: CommandPalettePageId,
  choices: readonly CommandPaletteChoice[]
): CommandPaletteActionItem[] =>
  choices.map((choice, index) => ({
    id: `${pageId}:${choice.value}`,
    kind: 'action',
    title: choice.title,
    current: choice.current,
    sortRank: choices.length - index,
  }));

/** The rows as the first list's search shows them: tagged with their page's title. */
export const tagCommandPalettePageRows = <T extends CommandPaletteActionItem>(
  pageTitle: string,
  rows: readonly T[]
): T[] => rows.map((row) => ({ ...row, tag: pageTitle }));
