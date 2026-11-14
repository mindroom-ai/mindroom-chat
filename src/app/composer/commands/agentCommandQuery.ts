import { BaseRange, Editor, Range } from 'slate';
import type { AutocompleteQuery } from '../../editor/autocomplete/autocompleteQuery';

export const MINDROOM_COMMAND_PREFIX = '!';

export const getAgentCommandQuery = (
  editor: Editor,
  prevWordRange: BaseRange
): AutocompleteQuery<typeof MINDROOM_COMMAND_PREFIX> | undefined => {
  if (!editor.selection || !Range.isCollapsed(editor.selection)) return undefined;

  const word = Editor.string(editor, prevWordRange);
  if (!word.startsWith(MINDROOM_COMMAND_PREFIX)) return undefined;

  const start = Editor.start(editor, []);
  const queryStart = Range.start(prevWordRange);
  const prefixText = Editor.string(editor, {
    anchor: start,
    focus: queryStart,
  });
  if (prefixText.trim().length > 0) return undefined;

  return {
    range: prevWordRange,
    prefix: MINDROOM_COMMAND_PREFIX,
    text: word.slice(1),
  };
};
