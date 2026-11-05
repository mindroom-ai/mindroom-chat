/** Turns inline Markdown into HTML. The input is HTML-escaped text (see `sanitizeText`). */
export type InlineMDParser = (text: string) => string;

/**
 * Finds the first match of a rule in `text`, like `String.prototype.match` with a RegExp that is
 * not global: `index` is the start of the match, `[0]` the matched text, later items its parts.
 */
export type InlineMDMatcher = (text: string) => RegExpMatchArray | null;

/** Renders one match as HTML; `parseInline` renders nested Markdown, such as a link label. */
type InlineMDRenderer = (parseInline: InlineMDParser, match: RegExpMatchArray) => string;

/** One kind of inline Markdown, such as bold text or a link. */
export type InlineMDRule = {
  match: InlineMDMatcher;
  html: InlineMDRenderer;
};
