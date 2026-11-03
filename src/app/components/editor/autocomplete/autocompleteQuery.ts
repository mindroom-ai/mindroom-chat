import { BaseRange, Editor } from 'slate';

/** Characters that open an autocomplete menu when they start the word at the caret. */
























  editor: Editor,
  range: BaseRange,
  validPrefixes: readonly TPrefix[]
): AutocompleteQuery<TPrefix> | undefined => {
  const word = Editor.string(editor, range);
  const prefix = validPrefixes.find((candidate) => word.startsWith(candidate));
  if (!prefix) return undefined;
  return { range, prefix, text: word.slice(prefix.length) };
};
