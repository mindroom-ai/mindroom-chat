import { BaseRange, Editor } from 'slate';

/**
 * Characters that open an autocomplete menu when they start the word at the caret, by member
 * name. `@` and `#` are the Matrix sigils for user IDs and room aliases (spec, Appendices,
 * "Common Identifier Format"); `:` starts an emoticon shortcode and `/` a command.
 */
export const AutocompletePrefix = {
  Command: '/',
  Emoticon: ':',
  RoomMention: '#',
  UserMention: '@',
} as const;

export type AutocompletePrefix = (typeof AutocompletePrefix)[keyof typeof AutocompletePrefix];

/** Every prefix; each is one distinct character, so their order never matters. */
export const AUTOCOMPLETE_PREFIXES: readonly AutocompletePrefix[] =
  Object.values(AutocompletePrefix);

/** A snapshot of the word at the caret; the fields are never edited in place. */
export type AutocompleteQuery<TPrefix extends string> = {
  readonly prefix: TPrefix;
  /** The word without its prefix. */
  readonly text: string;
  /** The word at the caret, prefix included; replacing it inserts the selected item. */
  readonly range: BaseRange;
};

/** Reads the word in `range` as a query for the first prefix it starts with. */
export function getAutocompleteQuery<TPrefix extends string>(
  composer: Editor,
  wordRange: BaseRange,
  prefixes: readonly TPrefix[]
): AutocompleteQuery<TPrefix> | undefined {
  const word = Editor.string(composer, wordRange);
  const prefix = prefixes.find((candidate) => word.startsWith(candidate));
  if (!prefix) return undefined;
  return { prefix, text: word.slice(prefix.length), range: wordRange };
}
