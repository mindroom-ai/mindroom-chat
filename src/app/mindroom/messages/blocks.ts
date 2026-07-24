import { parseBlockMD, parseInlineMD } from '../../plugins/markdown';
import { sanitizeText } from '../../utils/sanitize';
import {
  findMindroomPasteMarkersInText,
  formatMindroomPasteMarkerAsHtml,
  formatMindroomPasteMarkerTextAsHtml,
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

type MarkdownCodeFence = {
  character: '`' | '~';
  length: number;
};

type PastePlaceholder = {
  markerHtml: string;
  markerTextHtml: string;
  literal: boolean;
};

const MARKDOWN_CODE_FENCE_OPEN_REG = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const MARKDOWN_CONTAINER_FENCE_REG = /^((?: {0,3}> ?)+| {0,3}(?:[-+*]|\d+[.)]) {1,4})(`{3,}|~{3,})/;
const PASTE_PLACEHOLDER_BASE = '\uE000MINDROOMPASTE';
// The in-repo parser recurses per block match, so remote preview bodies need a
// conservative boundary below the browser stack limit.
const MAX_MARKDOWN_PREVIEW_BLOCK_LINES = 512;
const MAX_MARKDOWN_PREVIEW_INLINE_MARKERS = 512;
const MAX_MARKDOWN_PREVIEW_CACHE_ENTRIES = 32;
const MARKDOWN_PREVIEW_BLOCK_LINE_REG =
  /^(?:#{1,6} |>|\$\$| {0,3}(?:`{3,}|~{3,})| *(?:[-*]|[\dA-Za-z]+\.) )/gm;
// Timeline renders repeatedly revisit the same preview string while edits and
// receipts arrive; keep that deterministic work bounded and reusable.
const markdownPreviewCache = new Map<string, string>();

const getMarkdownCodeFence = (line: string): MarkdownCodeFence | undefined => {
  const match = line.match(MARKDOWN_CODE_FENCE_OPEN_REG);
  if (!match) return undefined;

  const fence = match[1];
  const character = fence[0] as '`' | '~';
  if (character === '`' && match[2].includes('`')) return undefined;

  return {
    character,
    length: fence.length,
  };
};

const isMarkdownCodeFenceClose = (line: string, fence: MarkdownCodeFence): boolean => {
  const stripped = line.replace(/^ {0,3}/, '');
  let runLength = 0;
  while (stripped[runLength] === fence.character) runLength += 1;

  return runLength >= fence.length && stripped.slice(runLength).trim() === '';
};

const getLongestBacktickRun = (text: string): number => {
  let longestRun = 0;
  let currentRun = 0;

  for (const character of text) {
    if (character === '`') {
      currentRun += 1;
      longestRun = Math.max(longestRun, currentRun);
    } else {
      currentRun = 0;
    }
  }

  return longestRun;
};

const sanitizeMarkdownText = (text: string): string => {
  const sanitizedText = sanitizeText(text).replace(/^&gt;/gm, '>');

  return sanitizedText.replace(/^(\\+)&gt;/gm, (_match, backslashes: string) => {
    const literalBackslashes = '&#92;'.repeat(Math.floor(backslashes.length / 2));
    return `${literalBackslashes}&gt;`;
  });
};

const normalizeParsedMathEntities = (html: string): string =>
  html.replace(/<(span|div) data-mx-maths="[^"]*">[\s\S]*?<\/\1>/g, (mathHtml) =>
    mathHtml.replace(/&amp;(amp|lt|gt|quot|#39);/g, '&$1;')
  );

const replacePastePlaceholders = (
  html: string,
  pastePlaceholders: Map<string, PastePlaceholder>
): string => {
  let formattedHtml = html;

  pastePlaceholders.forEach(({ literal, markerHtml, markerTextHtml }, placeholder) => {
    let searchIndex = 0;

    while (searchIndex < formattedHtml.length) {
      const placeholderIndex = formattedHtml.indexOf(placeholder, searchIndex);
      if (placeholderIndex === -1) break;

      const htmlBeforePlaceholder = formattedHtml.slice(0, placeholderIndex);
      const insideTag =
        htmlBeforePlaceholder.lastIndexOf('<') > htmlBeforePlaceholder.lastIndexOf('>');
      const insideCode =
        htmlBeforePlaceholder.lastIndexOf('<code') > htmlBeforePlaceholder.lastIndexOf('</code>');
      const insideInlineMath =
        htmlBeforePlaceholder.lastIndexOf('<span data-mx-maths=') >
        htmlBeforePlaceholder.lastIndexOf('</span>');
      const insideDisplayMath =
        htmlBeforePlaceholder.lastIndexOf('<div data-mx-maths=') >
        htmlBeforePlaceholder.lastIndexOf('</div>');
      const replacement =
        literal || insideTag || insideCode || insideInlineMath || insideDisplayMath
          ? markerTextHtml
          : markerHtml;

      formattedHtml = `${htmlBeforePlaceholder}${replacement}${formattedHtml.slice(
        placeholderIndex + placeholder.length
      )}`;
      searchIndex = placeholderIndex + replacement.length;
    }
  });

  return formattedHtml;
};

const exceedsInlineMarkerBudget = (text: string): boolean => {
  let markerCount = 0;
  for (const character of text) {
    if (!'*_~`|$['.includes(character)) continue;
    markerCount += 1;
    if (markerCount > MAX_MARKDOWN_PREVIEW_INLINE_MARKERS) return true;
  }
  return false;
};

const getPastePlaceholderPrefix = (text: string): string => {
  let longestSuffix = -1;
  let cursor = 0;

  while (cursor < text.length) {
    const prefixIndex = text.indexOf(PASTE_PLACEHOLDER_BASE, cursor);
    if (prefixIndex === -1) break;

    let suffixLength = 0;
    const suffixStart = prefixIndex + PASTE_PLACEHOLDER_BASE.length;
    while (text[suffixStart + suffixLength] === 'X') suffixLength += 1;
    longestSuffix = Math.max(longestSuffix, suffixLength);
    cursor = suffixStart + Math.max(1, suffixLength);
  }

  return `${PASTE_PLACEHOLDER_BASE}${'X'.repeat(longestSuffix + 1)}`;
};

type TextRange = {
  start: number;
  end: number;
};

const getMarkdownCodeSpanRanges = (text: string): TextRange[] => {
  const ranges: TextRange[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const openingStart = text.indexOf('`', cursor);
    if (openingStart === -1) break;

    let openingEnd = openingStart;
    while (text[openingEnd] === '`') openingEnd += 1;
    const delimiterLength = openingEnd - openingStart;
    let closingStart = text.indexOf('`', openingEnd);

    while (closingStart !== -1) {
      let closingEnd = closingStart;
      while (text[closingEnd] === '`') closingEnd += 1;
      if (closingEnd - closingStart === delimiterLength) {
        ranges.push({ start: openingEnd, end: closingStart });
        cursor = closingEnd;
        break;
      }
      closingStart = text.indexOf('`', closingEnd);
    }

    if (closingStart === -1) cursor = openingEnd;
  }

  return ranges;
};

type ContainerFenceScan = {
  lineIndexes: Set<number>;
  hasMarker: boolean;
};

const stripQuoteContainerPrefix = (line: string, depth: number): string | undefined => {
  let content = line;

  for (let index = 0; index < depth; index += 1) {
    const prefix = content.match(/^ {0,3}> ?/)?.[0];
    if (!prefix) return undefined;
    content = content.slice(prefix.length);
  }

  return content;
};

const scanContainerFences = (body: string): ContainerFenceScan => {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const lineIndexes = new Set<number>();
  let rootFence: MarkdownCodeFence | undefined;

  for (let openingIndex = 0; openingIndex < lines.length; openingIndex += 1) {
    if (rootFence) {
      if (isMarkdownCodeFenceClose(lines[openingIndex], rootFence)) rootFence = undefined;
      continue;
    }

    const rootOpeningFence = getMarkdownCodeFence(lines[openingIndex]);
    if (rootOpeningFence) {
      rootFence = rootOpeningFence;
      continue;
    }

    const openingMatch = lines[openingIndex].match(MARKDOWN_CONTAINER_FENCE_REG);
    if (!openingMatch) continue;

    const quoteContainer = openingMatch[1].includes('>');
    const quoteDepth = openingMatch[1].match(/>/g)?.length ?? 0;
    const listContentIndent = quoteContainer ? 0 : openingMatch[1].length;
    const listContentPrefix = ' '.repeat(listContentIndent);
    const fence: MarkdownCodeFence = {
      character: openingMatch[2][0] as '`' | '~',
      length: openingMatch[2].length,
    };
    lineIndexes.add(openingIndex);

    if (
      findMindroomPasteMarkersInText(lines[openingIndex].slice(openingMatch[0].length)).length > 0
    ) {
      return { lineIndexes, hasMarker: true };
    }

    for (let lineIndex = openingIndex + 1; lineIndex < lines.length; lineIndex += 1) {
      const content = quoteContainer
        ? stripQuoteContainerPrefix(lines[lineIndex], quoteDepth)
        : lines[lineIndex].startsWith(listContentPrefix)
        ? lines[lineIndex].slice(listContentIndent)
        : lines[lineIndex].trim()
        ? undefined
        : '';
      if (content === undefined) {
        openingIndex = lineIndex - 1;
        break;
      }

      lineIndexes.add(lineIndex);
      if (isMarkdownCodeFenceClose(content, fence)) {
        openingIndex = lineIndex;
        break;
      }

      if (findMindroomPasteMarkersInText(content).length > 0 || parseMindroomToolRefText(content)) {
        return { lineIndexes, hasMarker: true };
      }
    }
  }

  return { lineIndexes, hasMarker: false };
};

const rememberMarkdownPreview = (body: string, html: string): string => {
  if (markdownPreviewCache.has(body)) markdownPreviewCache.delete(body);
  markdownPreviewCache.set(body, html);

  if (markdownPreviewCache.size > MAX_MARKDOWN_PREVIEW_CACHE_ENTRIES) {
    const oldestBody = markdownPreviewCache.keys().next().value;
    if (typeof oldestBody === 'string') markdownPreviewCache.delete(oldestBody);
  }

  return html;
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
  const cachedHtml = markdownPreviewCache.get(body);
  if (cachedHtml !== undefined) {
    markdownPreviewCache.delete(body);
    markdownPreviewCache.set(body, cachedHtml);
    return cachedHtml;
  }

  const blockLineCount = body.match(MARKDOWN_PREVIEW_BLOCK_LINE_REG)?.length ?? 0;
  const containerFenceScan = scanContainerFences(body);
  if (
    blockLineCount > MAX_MARKDOWN_PREVIEW_BLOCK_LINES ||
    exceedsInlineMarkerBudget(body) ||
    containerFenceScan.hasMarker
  ) {
    return rememberMarkdownPreview(body, '');
  }

  const normalizedBody = body.replace(/\r\n?/g, '\n');
  const lines = normalizedBody.split('\n');
  const htmlParts: string[] = [];
  let markdownLines: string[] = [];
  let codeFence: MarkdownCodeFence | undefined;
  let codeFenceContentLineCount = 0;
  let displayMath = false;
  let pastePlaceholderIndex = 0;
  let pastePlaceholders = new Map<string, PastePlaceholder>();
  let formattingFailed = false;
  let sourceOffset = 0;
  const codeSpanRanges = getMarkdownCodeSpanRanges(normalizedBody);
  const pastePlaceholderPrefix = getPastePlaceholderPrefix(body);
  const normalizedFence = '`'.repeat(Math.max(3, getLongestBacktickRun(body) + 1));

  const replacePasteMarkersWithPlaceholders = (line: string, lineOffset: number): string => {
    let cursor = 0;
    let text = '';

    findMindroomPasteMarkersInText(line).forEach(({ marker, index, length }) => {
      const placeholder = `${pastePlaceholderPrefix}${pastePlaceholderIndex}\uE001`;
      pastePlaceholderIndex += 1;

      text += line.slice(cursor, index);
      text += placeholder;
      pastePlaceholders.set(placeholder, {
        markerHtml: formatMindroomPasteMarkerAsHtml(marker),
        markerTextHtml: escapeHtmlText(marker.raw),
        literal: codeSpanRanges.some(
          (range) => lineOffset + index >= range.start && lineOffset + index < range.end
        ),
      });
      cursor = index + length;
    });

    return `${text}${line.slice(cursor)}`;
  };

  const flushMarkdown = () => {
    if (markdownLines.length === 0) return;
    const markdown = markdownLines.join('\n');
    if (!markdown.trim()) {
      markdownLines = [];
      pastePlaceholders = new Map();
      return;
    }

    try {
      const parsedHtml = parseBlockMD(markdown, parseInlineMD);
      const html = replacePastePlaceholders(
        normalizeParsedMathEntities(parsedHtml),
        pastePlaceholders
      );
      htmlParts.push(html);
    } catch {
      formattingFailed = true;
    }
    markdownLines = [];
    pastePlaceholders = new Map();
  };

  lines.forEach((line, lineIndex) => {
    const lineOffset = sourceOffset;
    sourceOffset += line.length + 1;

    if (codeFence) {
      if (isMarkdownCodeFenceClose(line, codeFence)) {
        if (codeFenceContentLineCount === 0) markdownLines.push('');
        markdownLines.push(normalizedFence);
        codeFence = undefined;
      } else {
        markdownLines.push(sanitizeText(line));
        codeFenceContentLineCount += 1;
      }
      return;
    }

    const insideContainerFence = containerFenceScan.lineIndexes.has(lineIndex);
    if (displayMath) {
      markdownLines.push(sanitizeText(line));
      if (line === '$$') displayMath = false;
      return;
    }
    if (!insideContainerFence && line === '$$') {
      displayMath = true;
      markdownLines.push(line);
      return;
    }

    const openingFence = insideContainerFence ? undefined : getMarkdownCodeFence(line);
    if (openingFence) {
      codeFence = openingFence;
      codeFenceContentLineCount = 0;
      const info =
        line.match(MARKDOWN_CODE_FENCE_OPEN_REG)?.[2].trim().split(/\s+/, 1)[0].replace(/`/g, '') ??
        '';
      markdownLines.push(sanitizeText(`${normalizedFence}${info}`));
      return;
    }

    const markerHtml = insideContainerFence ? undefined : formatMindroomToolRefLineAsHtml(line);
    if (markerHtml) {
      flushMarkdown();
      htmlParts.push(markerHtml);
      return;
    }

    const normalizedLine = line.replace(/^(\s*)-( {1,4})(?=\S)/, '$1*$2');
    markdownLines.push(
      sanitizeMarkdownText(replacePasteMarkersWithPlaceholders(normalizedLine, lineOffset))
    );
  });

  if (codeFence) {
    if (codeFenceContentLineCount === 0) markdownLines.push('');
    markdownLines.push(normalizedFence);
  }

  flushMarkdown();
  return rememberMarkdownPreview(body, formattingFailed ? '' : htmlParts.join(''));
};
