/** Turns inline Markdown into HTML. The input is HTML-escaped text (see `sanitizeText`). */
export type InlineMDParser = (text: string) => string;

/**
 * Finds the first match of a rule in `text`, like `String.prototype.match` with a RegExp that is
 * not global: `index` is the start of the match, `[0]` the matched text, later items its parts.
 */
export type InlineMDMatcher = (text: string) => RegExpMatchArray | null;

/** Renders one match as HTML; `parseInline` renders nested Markdown, such as a link label. */
type InlineMDRenderer = (parseInline: InlineMDParser, match: RegExpMatchArray) => string;

/** The kinds of inline Markdown a parse can report where it found them. */
export type InlineMDSpanKind =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'spoiler'
  | 'link'
  | 'escape'
  | 'code';

/**
 * Where a parse found inline Markdown, in offsets of the text it was given: `start` to `end`
 * holds the whole match, of which the first `open` and the last `close` characters are syntax
 * (delimiters, backticks, a link's `](url)`), and the rest is the text it formats.
 */
export type InlineMDSpan = {
  kind: InlineMDSpanKind;
  start: number;
  end: number;
  open: number;
  close: number;
};

/** One kind of inline Markdown, such as bold text or a link. */
export type InlineMDRule = {
  match: InlineMDMatcher;
  html: InlineMDRenderer;
  /**
   * What a match formats, for parses that report where they found Markdown: its kind and how
   * many of its characters at each end are syntax. Text the renderer parses again, such as a
   * link label, starts right after the opening syntax. A rule without it is not reported.
   */
  span?: (match: RegExpMatchArray) => Omit<InlineMDSpan, 'start' | 'end'>;
};
