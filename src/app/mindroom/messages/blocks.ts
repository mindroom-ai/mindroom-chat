import { escapeMarkdownInlineSequences, parseBlockMD, parseInlineMD } from '../../plugins/markdown';
import { findDisplayLatexBlockMatch, findInlineLatexMatch } from '../../plugins/math';
import { CodeBlockRule } from '../../plugins/markdown/block/rules';
import { CodeRule, StrikeRule } from '../../plugins/markdown/inline/rules';
import { sanitizeText } from '../../utils/sanitize';
import {
  formatMindroomPasteMarkerAsHtml,
  formatMindroomPasteMarkerTextAsHtml,
  parseMindroomPasteMarker,
} from './pasteAttachmentMarker';

export type MindroomToolRefParseResult = {
  toolName: string;
  index: number;
  pending: boolean;
};

// Contract for matching formatted_body markers emitted by the server (v2).
export const MINDROOM_TOOL_REF_HTML_REG_G = /🔧 <code>([^<]+)<\/code> \[(\d+)\]( ⏳)?/g;

const MINDROOM_TOOL_REF_TEXT_REG = /^\s*🔧\s+`([^`]+)`\s+\[(\d+)\](?:\s+(⏳))?\s*$/u;

const parseToolRefMatch = (match: RegExpExecArray): MindroomToolRefParseResult | undefined => {
  const toolName = match[1]?.trim();
  const index = Number(match[2]);

  if (!toolName || !Number.isInteger(index) || index < 1) return undefined;

  return {
    toolName,
    index,
    pending: Boolean(match[3]),
  };
};

export const parseMindroomToolRefHtml = (html: string): MindroomToolRefParseResult | undefined => {
  const normalized = html.trim();
  MINDROOM_TOOL_REF_HTML_REG_G.lastIndex = 0;

  const match = MINDROOM_TOOL_REF_HTML_REG_G.exec(normalized);
  if (!match || match[0] !== normalized) return undefined;

  return parseToolRefMatch(match);
};

export const parseMindroomToolRefText = (text: string): MindroomToolRefParseResult | undefined => {
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

export const formatMindroomToolRefTextBodyAsHtml = (body: string): string | undefined => {
  const hasToolRef = body
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .some((line) => parseMindroomToolRefText(line));
  if (!hasToolRef) return undefined;

  const formattedBody = formatMindroomMessageTextBodyAsHtml(body);
  if (!formattedBody) return undefined;

  return formattedBody;
};

const formatMindroomToolRefLineAsHtml = (line: string): string | undefined => {
  const toolRef = parseMindroomToolRefText(line);
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
const MARKDOWN_INDENTED_CONTEXT_REG = /^(?:\t| {4})/;
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
  mapUnprotected: (text: string) => string
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
    output += remaining.slice(protectedBlock.start, protectedBlock.end);
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

const preserveListContainedToolMarkers = (markdown: string): string =>
  mapMarkdownOutsideParserBlocks(markdown, (text) =>
    text
      .split('\n')
      .map((line) => {
        const listItem = line.match(MARKDOWN_LIST_ITEM_REG);
        if (!listItem || !listItem[4].trimStart().startsWith('🔧')) return line;

        return `${listItem[1]}${listItem[2]}${listItem[3]}${escapeMarkdownInlineSequences(
          listItem[4]
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

const hasAmbiguousMarkdownMarkerContext = (body: string, lines: string[]): boolean => {
  if (findDisplayLatexBlockMatch(body)) return true;

  return lines.some((line) => {
    if (line === line.trim() && parseMindroomToolRefText(line)) return false;
    if (MARKDOWN_INDENTED_CONTEXT_REG.test(line) || findInlineLatexMatch(line)) return true;
    if (CodeRule.match(line) || StrikeRule.match(line)) return true;

    const unescapedMarkerText = line.replace(/\\([`~])/g, '');
    return unescapedMarkerText.includes('``') || unescapedMarkerText.includes('~~~');
  });
};

const formatStandaloneMindroomMarkerAsHtml = (
  line: string,
  allowRichMarkers: boolean
): string | undefined => {
  if (!allowRichMarkers || line !== line.trim()) return undefined;

  const toolHtml = formatMindroomToolRefLineAsHtml(line);
  if (toolHtml) return toolHtml;

  const pasteMarker = parseMindroomPasteMarker(line);
  return pasteMarker ? `<p>${formatMindroomPasteMarkerAsHtml(pasteMarker)}</p>` : undefined;
};

export const formatMindroomMessageTextBodyAsHtml = (body: string): string | undefined => {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const htmlParts: string[] = [];
  let paragraphLines: string[] = [];
  let hasMindroomMarker = false;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    htmlParts.push(`<p>${paragraphLines.map(escapeHtmlText).join('<br/>')}</p>`);
    paragraphLines = [];
  };

  lines.forEach((line) => {
    const markerHtml =
      formatMindroomToolRefLineAsHtml(line) ?? formatMindroomPasteMarkerTextAsHtml(line);
    if (markerHtml) {
      flushParagraph();
      hasMindroomMarker = true;
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

  return hasMindroomMarker ? htmlParts.join('') : undefined;
};

export const formatMindroomMarkdownTextBodyAsHtml = (body: string): string => {
  const blockLineCount = body.match(MARKDOWN_PREVIEW_BLOCK_LINE_REG)?.length ?? 0;
  if (blockLineCount > MAX_MARKDOWN_PREVIEW_BLOCK_LINES || exceedsInlineMarkerBudget(body)) {
    return '';
  }

  const normalizedBody = body.replace(/\r\n?/g, '\n');
  const lines = normalizedBody.split('\n');
  const hasAmbiguousMarkerContext = hasAmbiguousMarkdownMarkerContext(normalizedBody, lines);
  const htmlParts: string[] = [];
  let markdownLines: string[] = [];
  let formattingFailed = false;

  const flushMarkdown = () => {
    if (markdownLines.length === 0) return;
    const markdown = markdownLines.join('\n');
    if (!markdown.trim()) {
      markdownLines = [];
      return;
    }

    try {
      const normalizedMarkdown = normalizeMarkdownDashLists(markdown);
      const literalMarkerMarkdown = preserveListContainedToolMarkers(normalizedMarkdown);
      const parsedHtml = parseBlockMD(sanitizeMarkdownText(literalMarkerMarkdown), parseInlineMD);
      htmlParts.push(normalizeParsedMathEntities(parsedHtml));
    } catch {
      formattingFailed = true;
    }
    markdownLines = [];
  };

  lines.forEach((line) => {
    const markerHtml = formatStandaloneMindroomMarkerAsHtml(line, !hasAmbiguousMarkerContext);
    if (markerHtml) {
      flushMarkdown();
      htmlParts.push(markerHtml);
      return;
    }

    markdownLines.push(line);
  });

  flushMarkdown();
  return formattingFailed ? '' : htmlParts.join('');
};
