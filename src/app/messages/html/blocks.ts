import { Element, Text as DOMText, htmlToDOM } from 'html-react-parser';
import type { DOMNode } from 'html-react-parser';
import { parseInlineMD } from '../../rich-text/markdown/inline/parser';
import { parseBlockMD } from '../../rich-text/markdown/block/parser';
import {
  escapeMarkdownInlineSequences,
  unescapeMarkdownInlineSequences,
} from '../../rich-text/markdown/utils';
import { findDisplayLatexBlockMatch } from '../../rich-text/math';
import { CodeBlockRule } from '../../rich-text/markdown/block/rules';
import { sanitizeText } from '../../rich-text/sanitize';
import {
  formatPasteMarkerAsHtml,
  formatPasteMarkerTextAsHtml,
  parsePasteMarker,
} from '../../matrix/protocol/pasteAttachmentMarker';
import { matchesEnum } from '../../lib/matchesEnum';

export type ToolRefParseResult = {
  toolName: string;
  index: number;
  pending: boolean;
};

export const MINDROOM_TOOL_REF_ICON = '🔧';

// Contract for matching formatted_body markers emitted by the server (v2).
export const MINDROOM_TOOL_REF_HTML_REG_G = /🔧 <code>([^<]+)<\/code> \[(\d+)\]( ⏳)?/g;

const MINDROOM_TOOL_REF_TEXT_REG = /^\s*🔧\s+`([^`]+)`\s+\[(\d+)\](?:\s+(⏳))?\s*$/u;

const parseToolRefMatch = (match: RegExpExecArray): ToolRefParseResult | undefined => {
  const toolName = match[1]?.trim();
  const index = Number(match[2]);

  if (!toolName || !Number.isInteger(index) || index < 1) return undefined;

  return {
    toolName,
    index,
    pending: Boolean(match[3]),
  };
};

export const parseToolRefHtml = (html: string): ToolRefParseResult | undefined => {
  const normalized = html.trim();
  MINDROOM_TOOL_REF_HTML_REG_G.lastIndex = 0;

  const match = MINDROOM_TOOL_REF_HTML_REG_G.exec(normalized);
  if (!match || match[0] !== normalized) return undefined;

  return parseToolRefMatch(match);
};

export const parseToolRefText = (text: string): ToolRefParseResult | undefined => {
  const match = MINDROOM_TOOL_REF_TEXT_REG.exec(text);
  if (!match) return undefined;
  return parseToolRefMatch(match);
};

const escapeHtmlText = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatToolRefLineAsHtml = (line: string): string | undefined => {
  const toolRef = parseToolRefText(line);
  if (!toolRef) return undefined;

  return `<p>🔧 <code>${escapeHtmlText(toolRef.toolName)}</code> [${toolRef.index}]${
    toolRef.pending ? ' ⏳' : ''
  }</p>`;
};

// The in-repo parser recurses per block match, so remote preview bodies need a
// conservative boundary below the browser stack limit.
const MAX_MARKDOWN_PREVIEW_BLOCK_LINES = 512;
const MAX_MARKDOWN_PREVIEW_INLINE_MARKERS = 512;
const MARKDOWN_PREVIEW_BLOCK_LINE_REG =
  /^(?:#{1,6} |>|\$\$| {0,3}(?:`{3,}|~{3,})| *(?:[-*]|[\dA-Za-z]+\.) )/gm;
const MARKDOWN_LIST_ITEM_REG = /^( *)([-*]|[\dA-Za-z]\.)( +)(.+)$/;

const sanitizeMarkdownText = (text: string): string => sanitizeText(text).replace(/^&gt;/gm, '>');

const normalizeParsedMathEntities = (html: string): string =>
  html.replace(/<(span|div) data-mx-maths="[^"]*">[\s\S]*?<\/\1>/g, (mathHtml) =>
    mathHtml.replace(/&amp;(amp|lt|gt|quot|#39);/g, '&$1;')
  );

type MarkdownProtectedBlock = {
  start: number;
  end: number;
};

const findNextMarkdownProtectedBlock = (markdown: string): MarkdownProtectedBlock | undefined => {
  const codeMatch = CodeBlockRule.match(markdown);
  const codeBlock =
    codeMatch && codeMatch.index !== undefined
      ? { start: codeMatch.index, end: codeMatch.index + codeMatch[0].length }
      : undefined;
  const mathMatch = findDisplayLatexBlockMatch(markdown);
  const mathBlock = mathMatch ? { start: mathMatch.start, end: mathMatch.end } : undefined;

  if (!codeBlock) return mathBlock;
  if (!mathBlock) return codeBlock;
  return codeBlock.start <= mathBlock.start ? codeBlock : mathBlock;
};

const mapMarkdownOutsideParserBlocks = (
  markdown: string,
  mapUnprotected: (text: string) => string,
  mapProtected: (text: string) => string = (text) => text
): string => {
  let cursor = 0;
  let output = '';

  while (cursor < markdown.length) {
    const remaining = markdown.slice(cursor);
    const protectedBlock = findNextMarkdownProtectedBlock(remaining);
    if (!protectedBlock) {
      output += mapUnprotected(remaining);
      break;
    }

    output += mapUnprotected(remaining.slice(0, protectedBlock.start));
    output += mapProtected(remaining.slice(protectedBlock.start, protectedBlock.end));
    cursor += protectedBlock.end;
  }

  return output;
};

const normalizeMarkdownDashLists = (markdown: string): string =>
  mapMarkdownOutsideParserBlocks(markdown, (text) =>
    text
      .split('\n')
      .map((line) => {
        const listItem = line.match(MARKDOWN_LIST_ITEM_REG);
        if (!listItem || listItem[2] !== '-') return line;

        return `${listItem[1]}*${listItem[3]}${listItem[4]}`;
      })
      .join('\n')
  );

const isDomTextNode = (node: DOMNode): node is DOMText => matchesEnum(node.type, 'text');

const isDomElementNode = (node: DOMNode): node is Element => matchesEnum(node.type, 'tag');

const extractDomText = (nodes: DOMNode[]): string =>
  nodes
    .map((node) => {
      if (isDomTextNode(node)) return node.data;
      if (isDomElementNode(node)) return extractDomText(node.children as DOMNode[]);
      return '';
    })
    .join('');

const listItemCanFlattenToToolRefPrefix = (markdown: string): boolean => {
  if (!markdown.includes(MINDROOM_TOOL_REF_ICON)) return false;

  const parsedInline = parseInlineMD(sanitizeMarkdownText(markdown.trimStart()));
  let flattenedInline = '';
  for (const node of htmlToDOM(parsedInline)) {
    if (isDomTextNode(node)) {
      flattenedInline += node.data;
    } else if (isDomElementNode(node) && node.name === 'code') {
      flattenedInline += `<code>${extractDomText(node.children as DOMNode[])}</code>`;
    } else if (isDomElementNode(node) && node.name === 'span') {
      flattenedInline += extractDomText(node.children as DOMNode[]);
    } else {
      break;
    }
  }

  MINDROOM_TOOL_REF_HTML_REG_G.lastIndex = 0;
  const match = MINDROOM_TOOL_REF_HTML_REG_G.exec(flattenedInline.trim());
  if (match?.index !== 0) return false;
  return parseToolRefHtml(match[0]) !== undefined;
};

const preserveListContainedToolMarkers = (markdown: string): string =>
  mapMarkdownOutsideParserBlocks(markdown, (text) =>
    text
      .split('\n')
      .map((line) => {
        const listItem = line.match(MARKDOWN_LIST_ITEM_REG);
        if (!listItem || !listItemCanFlattenToToolRefPrefix(listItem[4]!)) return line;

        return `${listItem[1]}${listItem[2]}${listItem[3]}${escapeMarkdownInlineSequences(
          unescapeMarkdownInlineSequences(listItem[4]!)
        )}`;
      })
      .join('\n')
  );

const exceedsInlineMarkerBudget = (text: string): boolean => {
  let markerCount = 0;
  for (const character of text) {
    if (!'*_~`|$['.includes(character)) continue;
    markerCount += 1;
    if (markerCount > MAX_MARKDOWN_PREVIEW_INLINE_MARKERS) return true;
  }
  return false;
};

const hasAmbiguousMarkdownMarkerContext = (lines: string[]): boolean =>
  lines.some((line) => {
    if (line === line.trim() && parseToolRefText(line)) return false;

    const unescapedMarkerText = line.replace(/\\([`~])/g, '');
    return unescapedMarkerText.includes('``') || unescapedMarkerText.includes('~~~');
  });

const formatStandaloneMarkerAsHtml = (
  line: string,
  allowRichMarkers: boolean
): string | undefined => {
  if (!allowRichMarkers || line !== line.trim()) return undefined;

  const toolHtml = formatToolRefLineAsHtml(line);
  if (toolHtml) return toolHtml;

  const pasteMarker = parsePasteMarker(line);
  return pasteMarker ? `<p>${formatPasteMarkerAsHtml(pasteMarker)}</p>` : undefined;
};

export const formatMessageTextBodyAsHtml = (body: string): string | undefined => {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const htmlParts: string[] = [];
  let paragraphLines: string[] = [];
  let hasMarker = false;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    htmlParts.push(`<p>${paragraphLines.map(escapeHtmlText).join('<br/>')}</p>`);
    paragraphLines = [];
  };

  lines.forEach((line) => {
    const markerHtml =
      formatToolRefLineAsHtml(line) ?? formatPasteMarkerTextAsHtml(line);
    if (markerHtml) {
      flushParagraph();
      hasMarker = true;
      htmlParts.push(markerHtml);
      return;
    }

    if (line.trim() === '') {
      flushParagraph();
      return;
    }

    paragraphLines.push(line);
  });

  flushParagraph();

  return hasMarker ? htmlParts.join('') : undefined;
};

// The block elements the Markdown parser writes; the rest of its output is inline text.
const PARSED_BLOCK_TAG_REG = /<\/?(?:h[1-6]|blockquote|ul|ol|pre|div)\b[^>]*>/g;

// Text that starts with the tool icon here is a marker kept literal (indented, or with more text on
// its line); in a paragraph the renderer would show it as a tool call.
const STARTS_WITH_TOOL_ICON_REG = new RegExp(`^(?:\\s|<br/>)*${MINDROOM_TOOL_REF_ICON}`, 'u');

// Wraps the inline text that starts the parsed Markdown (after a marker) and the inline text that
// ends it (before a marker) in paragraphs, as MindRoom's formatted body has them, so that text keeps
// a paragraph's spacing from the marker's block.
const wrapTextBesideMarkers = (html: string, afterMarker: boolean, beforeMarker: boolean) => {
  const tags = Array.from(html.matchAll(PARSED_BLOCK_TAG_REG));
  const paragraph = (text: string, wanted: boolean) =>
    wanted && text && !STARTS_WITH_TOOL_ICON_REG.test(text) ? `<p>${text}</p>` : text;
  if (tags.length === 0) return paragraph(html, afterMarker || beforeMarker);
  const firstTag = tags[0]!;
  const lastTag = tags[tags.length - 1]!;
  const start = firstTag.index ?? 0;
  const end = (lastTag.index ?? 0) + lastTag[0].length;
  return (
    paragraph(html.slice(0, start), afterMarker) +
    html.slice(start, end) +
    paragraph(html.slice(end), beforeMarker)
  );
};

const isBlankLine = (line: string | undefined): boolean => line !== undefined && !line.trim();

const formatMarkdownPreviewSegment = (body: string, allowRichMarkers: boolean): string => {
  const lines = body.split('\n');
  const htmlParts: string[] = [];
  let markdownLines: string[] = [];

  // `beforeMarker`: a marker or separator follows the text. The blank lines between the text and a
  // marker only set the marker apart, as they do in MindRoom's formatted body; given to the parser
  // they would each become an empty line.
  const flushMarkdown = (beforeMarker: boolean) => {
    const afterMarker = htmlParts.length > 0;
    let first = 0;
    let end = markdownLines.length;
    if (afterMarker) while (isBlankLine(markdownLines[first])) first += 1;
    if (beforeMarker) while (end > first && isBlankLine(markdownLines[end - 1])) end -= 1;
    const markdown = markdownLines.slice(first, end).join('\n');
    markdownLines = [];
    if (!markdown.trim()) return;

    const normalizedMarkdown = normalizeMarkdownDashLists(markdown);
    const literalMarkerMarkdown = preserveListContainedToolMarkers(normalizedMarkdown);
    const parsedHtml = parseBlockMD(sanitizeMarkdownText(literalMarkerMarkdown), parseInlineMD);
    htmlParts.push(
      wrapTextBesideMarkers(normalizeParsedMathEntities(parsedHtml), afterMarker, beforeMarker)
    );
  };

  lines.forEach((line, index) => {
    // Promote root separators isolated by blank lines or recognized code/math
    // blocks (segment boundaries). Ambiguous fence content remains literal.
    const separator =
      allowRichMarkers &&
      /^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(line) &&
      (index === 0 || lines[index - 1]!.trim() === '') &&
      (index === lines.length - 1 || lines[index + 1]!.trim() === '');
    const markerHtml = separator
      ? '<hr/>'
      : formatStandaloneMarkerAsHtml(line, allowRichMarkers);
    if (markerHtml) {
      flushMarkdown(true);
      htmlParts.push(markerHtml);
      return;
    }

    markdownLines.push(line);
  });

  flushMarkdown(false);
  return htmlParts.join('');
};

export const formatMarkdownTextBodyAsHtml = (body: string): string => {
  const normalizedBody = body.replace(/\r\n?/g, '\n');
  // Standalone tool markers become HTML without the parser, so a reply with
  // many tool calls must not spend the parser's budget on them.
  const textWithoutToolMarkers = normalizedBody
    .split('\n')
    .filter((line) => line !== line.trim() || !parseToolRefText(line))
    .join('\n');
  const blockLineCount = body.match(MARKDOWN_PREVIEW_BLOCK_LINE_REG)?.length ?? 0;
  if (
    blockLineCount > MAX_MARKDOWN_PREVIEW_BLOCK_LINES ||
    exceedsInlineMarkerBudget(textWithoutToolMarkers)
  ) {
    return '';
  }

  try {
    const unprotected = mapMarkdownOutsideParserBlocks(
      normalizedBody,
      (text) => text,
      () => '\n'
    );
    const allowRichMarkers = !hasAmbiguousMarkdownMarkerContext(unprotected.split('\n'));
    // Without rich markers the tool marker lines reach the parser too.
    if (!allowRichMarkers && exceedsInlineMarkerBudget(normalizedBody)) {
      return '';
    }
    // Use the parser's own block boundaries so code/math examples stay literal,
    // without disabling real tool markers elsewhere in the preview.
    return mapMarkdownOutsideParserBlocks(
      normalizedBody,
      (text) => formatMarkdownPreviewSegment(text, allowRichMarkers),
      (block) =>
        normalizeParsedMathEntities(parseBlockMD(sanitizeMarkdownText(block), parseInlineMD))
    );
  } catch {
    return '';
  }
};
