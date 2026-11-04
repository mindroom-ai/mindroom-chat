import { Descendant, Element, Text } from 'slate';
import { sanitizeText } from '../../utils/sanitize';
import {
  parseBlockMD,
  parseInlineMD,
  unescapeMarkdownInlineSequences,
} from '../../plugins/markdown';
import { getMatrixToRoom, getMatrixToRoomEvent, getMatrixToUser } from '../../plugins/matrix-to';
import {
  mindroomEditorPasteMarkerElementToCustomHtml,
  mindroomEditorPasteMarkerElementToPlainText,
} from '../../mindroom/editor/MindroomEditorExtensions';
import { BlockType } from './types';
import type { CustomElement, FormattedText, MentionElement } from './slate';

export type OutputOptions = {
  /** Render text marks (bold, italic, ...) as HTML. */
  readonly allowTextFormatting?: boolean;
  /** Read inline Markdown (emphasis, code, links, math) in typed text. */
  readonly allowInlineMarkdown?: boolean;
  /** Read block Markdown (quotes, lists, headings, code blocks) across lines. */
  readonly allowBlockMarkdown?: boolean;
};

const LINE_BREAK = '<br/>';

const isMxcUri = (value: string): boolean => value.startsWith('mxc://');

const getMentionHref = (mention: MentionElement): string => {
  if (mention.id.startsWith('@')) return getMatrixToUser(mention.id);
  if (mention.eventId) return getMatrixToRoomEvent(mention.id, mention.eventId, mention.viaServers);
  return getMatrixToRoom(mention.id, mention.viaServers);
};

const textToCustomHtml = (node: FormattedText, opts: OutputOptions): string => {
  let html = sanitizeText(node.text);
  if (!opts.allowTextFormatting || html === '') return html;
  if (node.code) html = `<code>${html}</code>`;
  if (node.bold) html = `<strong>${html}</strong>`;
  if (node.italic) html = `<i>${html}</i>`;
  if (node.underline) html = `<u>${html}</u>`;
  if (node.strikeThrough) html = `<s>${html}</s>`;
  if (node.spoiler) html = `<span data-mx-spoiler>${html}</span>`;
  return html;
};

const inlineElementToCustomHtml = (node: CustomElement, children: string): string | undefined => {
  switch (node.type) {
    case BlockType.Mention:
      if (node.id === '@room') return '@room';
      return `<a href="${sanitizeText(getMentionHref(node))}">${sanitizeText(node.name)}</a>`;
    case BlockType.Emoticon:
      if (!isMxcUri(node.key)) return sanitizeText(node.key);
      return `<img data-mx-emoticon src="${sanitizeText(node.key)}" alt="${sanitizeText(
        node.shortcode
      )}" title="${sanitizeText(node.shortcode)}" height="32" />`;
    case BlockType.Link:
      return `<a href="${sanitizeText(node.href)}">${children}</a>`;
    case BlockType.PasteMarker:
      return mindroomEditorPasteMarkerElementToCustomHtml(node);
    default:
      return undefined;
  }
};

const childrenToCustomHtml = (nodes: Descendant[], opts: OutputOptions): string =>
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  nodes.map((child) => nodeToCustomHtml(child, opts)).join('');

/** Inline Markdown runs over each line of a block that holds typed text. */
const lineToCustomHtml = (nodes: Descendant[], opts: OutputOptions): string => {
  const html = childrenToCustomHtml(nodes, opts);
  return opts.allowInlineMarkdown ? parseInlineMD(html) : html;
};

function nodeToCustomHtml(node: Descendant, opts: OutputOptions): string {
  if (Text.isText(node)) return textToCustomHtml(node, opts);

  const inline = inlineElementToCustomHtml(node, childrenToCustomHtml(node.children, opts));
  if (inline !== undefined) return inline;

  switch (node.type) {
    case BlockType.Paragraph:
    case BlockType.QuoteLine:
      return `${lineToCustomHtml(node.children, opts)}${LINE_BREAK}`;
    case BlockType.Heading:
      return `<h${node.level}>${lineToCustomHtml(node.children, opts)}</h${node.level}>`;
    case BlockType.CodeLine:
      return `${childrenToCustomHtml(node.children, { ...opts, allowTextFormatting: false })}\n`;
    case BlockType.CodeBlock:
      return `<pre><code>${childrenToCustomHtml(node.children, opts)}</code></pre>`;
    case BlockType.BlockQuote:
      return `<blockquote>${childrenToCustomHtml(node.children, opts)}</blockquote>`;
    case BlockType.ListItem:
      return `<li><p>${lineToCustomHtml(node.children, opts)}</p></li>`;
    case BlockType.OrderedList:
      return `<ol>${childrenToCustomHtml(node.children, opts)}</ol>`;
    case BlockType.UnorderedList:
      return `<ul>${childrenToCustomHtml(node.children, opts)}</ul>`;
    default:
      return childrenToCustomHtml((node as Element).children, opts);
  }
}

const isParagraph = (node: Descendant): node is Element & { type: typeof BlockType.Paragraph } =>
  Element.isElement(node) && node.type === BlockType.Paragraph;

/**
 * Converts composer content to `org.matrix.custom.html`. With block Markdown on, runs of
 * paragraphs are read as one Markdown document, so quotes and lists may span lines.
 */
export const toMatrixCustomHTML = (
  content: Descendant | Descendant[],
  options: OutputOptions
): string => {
  const nodes = Array.isArray(content) ? content : [content];
  if (!options.allowBlockMarkdown) {
    return nodes.map((child) => nodeToCustomHtml(child, options)).join('');
  }

  const inlineOpts: OutputOptions = { ...options, allowInlineMarkdown: false };
  const parseInline = options.allowInlineMarkdown ? parseInlineMD : undefined;
  let html = '';
  let markdownLines: string[] = [];
  const flushMarkdown = () => {
    if (markdownLines.length === 0) return;
    html += parseBlockMD(markdownLines.join('\n'), parseInline);
    markdownLines = [];
  };
  nodes.forEach((child) => {
    if (isParagraph(child)) {
      markdownLines.push(childrenToCustomHtml(child.children, inlineOpts));
      return;
    }
    flushMarkdown();
    html += nodeToCustomHtml(child, options);
  });
  flushMarkdown();
  return html;
};

/** Removes the line breaks the block serializers leave at either end. */
export const trimCustomHtml = (customHtml: string): string =>
  customHtml.replace(/^(?:<br\s*\/?>)+/, '').replace(/(?:<br\s*\/?>)+$/, '');

/**
 * Whether the custom HTML adds nothing to the plain body: the same text, only escaped, with
 * `<br/>` for line breaks. A message like that is sent without a `formatted_body`.
 */
export const customHtmlEqualsPlainText = (customHtml: string, plainText: string): boolean =>
  customHtml.split(LINE_BREAK).join('\n') === sanitizeText(plainText);

const inlineElementToPlainText = (node: CustomElement, children: string): string | undefined => {
  switch (node.type) {
    case BlockType.Mention:
      return node.name;
    case BlockType.Link:
      return children;
    case BlockType.Emoticon:
      return isMxcUri(node.key) ? `:${node.shortcode}:` : node.key;
    case BlockType.PasteMarker:
      return mindroomEditorPasteMarkerElementToPlainText(node);
    default:
      return undefined;
  }
};

const childrenToPlainText = (nodes: Descendant[], isMarkdown: boolean): string =>
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  nodes.map((child) => nodeToPlainText(child, isMarkdown)).join('');

// Blocks that are a single line of text in the plain body.
const LINE_BLOCKS: ReadonlySet<string> = new Set([
  BlockType.Paragraph,
  BlockType.QuoteLine,
  BlockType.ListItem,
  BlockType.CodeLine,
]);

const prefixLines = (text: string, prefix: (index: number) => string): string =>
  text
    .split('\n')
    .filter((line, index, lines) => index < lines.length - 1 || line !== '')
    .map((line, index) => `${prefix(index)}${line}\n`)
    .join('');

function nodeToPlainText(node: Descendant, isMarkdown: boolean): string {
  if (Text.isText(node)) {
    return isMarkdown ? unescapeMarkdownInlineSequences(node.text) : node.text;
  }

  const children = childrenToPlainText(node.children, isMarkdown);
  const inline = inlineElementToPlainText(node, children);
  if (inline !== undefined) return inline;

  if (LINE_BLOCKS.has(node.type)) return `${children}\n`;

  switch (node.type) {
    case BlockType.Heading:
      return `${'#'.repeat(node.level)} ${children}\n`;
    case BlockType.CodeBlock:
      return `\`\`\`\n${childrenToPlainText(node.children, false)}\`\`\`\n`;
    case BlockType.BlockQuote:
      return prefixLines(children, () => '> ');
    case BlockType.OrderedList:
      return prefixLines(children, (index) => `${index + 1}. `);
    case BlockType.UnorderedList:
      return prefixLines(children, () => '- ');
    default:
      return children;
  }
}

/** Converts composer content to the plain-text `body`, one line per block. */
export const toPlainText = (node: Descendant | Descendant[], isMarkdown: boolean): string => {
  const nodes = Array.isArray(node) ? node : [node];
  const text = nodes.map((child) => nodeToPlainText(child, isMarkdown)).join('');
  // Every block ends its line; the body needs no newline after the last one.
  return text.endsWith('\n') ? text.slice(0, -1) : text;
};
