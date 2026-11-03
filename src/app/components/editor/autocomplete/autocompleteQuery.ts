import { BaseRange, Editor } from 'slate';

/**
 * Characters that open an autocomplete menu when they start the word at the caret, by member
 * name. `@` and `#` are the Matrix sigils for user IDs and room aliases (spec, Appendices,
 * "Common Identifier Format"); `:` starts an emoticon shortcode and `/` a command.
 */





}

/** Every prefix; each is one distinct character, so their order never matters. */
export const AUTOCOMPLETE_PREFIXES: readonly AutocompletePrefix[] =
  Object.values(AutocompletePrefix);












  range: BaseRange,
  validPrefixes: readonly TPrefix[]
): AutocompleteQuery<TPrefix> | undefined => {
  const word = Editor.string(editor, range);
  const prefix = validPrefixes.find((candidate) => word.startsWith(candidate));
  return prefix ? { prefix, text: word.slice(prefix.length), range } : undefined;
};
