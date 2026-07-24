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
};

const MARKDOWN_CODE_FENCE_OPEN_REG = /^ {0,3}(`{3,}|~{3,})(.*)$/;
// The in-repo parser recurses per block match, so remote preview bodies need a
// conservative boundary below the browser stack limit.
const MAX_MARKDOWN_PREVIEW_BLOCK_LINES = 512;
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

const sanitizeMarkdownText = (text: string): string =>
  sanitizeText(text)
    .replace(/^&gt;/gm, '>')
    .replace(/^\\&gt;/gm, '\\>');

const normalizeParsedMathEntities = (html: string): string =>
  html.replace(/<(span|div) data-mx-maths="[^"]*">[\s\S]*?<\/\1>/g, (mathHtml) =>
    mathHtml.replace(/&amp;(amp|lt|gt|quot|#39);/g, '&$1;')
  );

const replacePastePlaceholders = (
  html: string,
  pastePlaceholders: Map<string, PastePlaceholder>
): string => {
  let formattedHtml = html;

  pastePlaceholders.forEach(({ markerHtml, markerTextHtml }, placeholder) => {
    const placeholderIndex = formattedHtml.indexOf(placeholder);
    if (placeholderIndex === -1) return;

    const htmlBeforePlaceholder = formattedHtml.slice(0, placeholderIndex);
    const insideCode =
      htmlBeforePlaceholder.lastIndexOf('<code') > htmlBeforePlaceholder.lastIndexOf('</code>');
    formattedHtml = `${htmlBeforePlaceholder}${
      insideCode ? markerTextHtml : markerHtml
    }${formattedHtml.slice(placeholderIndex + placeholder.length)}`;
  });

  return formattedHtml;
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
  if (blockLineCount > MAX_MARKDOWN_PREVIEW_BLOCK_LINES) {
    return rememberMarkdownPreview(body, '');
  }

  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const htmlParts: string[] = [];
  let markdownLines: string[] = [];
  let codeFence: MarkdownCodeFence | undefined;
  let pastePlaceholderIndex = 0;
  let pastePlaceholderPrefix = '\uE000MINDROOMPASTE';
  let pastePlaceholders = new Map<string, PastePlaceholder>();
  let formattingFailed = false;
  const normalizedFence = '`'.repeat(Math.max(3, getLongestBacktickRun(body) + 1));

  while (body.includes(pastePlaceholderPrefix)) {
    pastePlaceholderPrefix += 'X';
  }

  const replacePasteMarkersWithPlaceholders = (line: string): string => {
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
      const parsedHtml = parseBlockMD(sanitizeMarkdownText(markdown), parseInlineMD);
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

  lines.forEach((line) => {
    if (codeFence) {
      if (isMarkdownCodeFenceClose(line, codeFence)) {
        markdownLines.push(normalizedFence);
        codeFence = undefined;
      } else {
        markdownLines.push(line);
      }
      return;
    }

    const openingFence = getMarkdownCodeFence(line);
    if (openingFence) {
      codeFence = openingFence;
      const info = line.match(MARKDOWN_CODE_FENCE_OPEN_REG)?.[2].trim().split(/\s+/, 1)[0] ?? '';
      markdownLines.push(`${normalizedFence}${info}`);
      return;
    }

    const markerHtml = formatMindroomToolRefLineAsHtml(line);
    if (markerHtml) {
      flushMarkdown();
      htmlParts.push(markerHtml);
      return;
    }

    const normalizedLine = line.replace(/^(\s*)- (?=\S)/, '$1* ');
    markdownLines.push(replacePasteMarkersWithPlaceholders(normalizedLine));
  });

  if (codeFence) markdownLines.push(normalizedFence);

  flushMarkdown();
  return rememberMarkdownPreview(body, formattingFailed ? '' : htmlParts.join(''));
};
