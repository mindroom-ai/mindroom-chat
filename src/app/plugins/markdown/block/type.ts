import type { InlineMDParser } from '../inline/type';

/** Turns block Markdown into HTML, rendering the text of each block with `parseInline`. */
export type BlockMDParser = (text: string, parseInline?: InlineMDParser) => string;

/**
 * Finds the first block of a rule in `text`, like `String.prototype.match`: `index` is where the
 * block starts and `[0]` the block, including the line break that ends it.
 */
export type BlockMDMatcher = (text: string) => RegExpMatchArray | null;

/** Renders one block as HTML. */
export type BlockMDRenderer = (parseInline: InlineMDParser, match: RegExpMatchArray) => string;

/**
 * Reads the whole `text` once and returns a search for the first block that starts at or after
 * `from`, with `index` counted from the start of `text`.
 */
export type BlockMDScanner = (text: string) => (from: number) => RegExpMatchArray | null;

/** One kind of block, such as a heading or a fenced code block. */
export type BlockMDRule = {
  match: BlockMDMatcher;
  /** Used by the parser instead of `match` on each rest of the text, for blocks costly to find. */
  scan?: BlockMDScanner;
  html: BlockMDRenderer;
};
