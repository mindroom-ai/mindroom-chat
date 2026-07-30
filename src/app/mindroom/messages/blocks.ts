import { parseBlockMD, parseInlineMD } from '../../plugins/markdown';
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
const MARKDOWN_AMBIGUOUS_MARKER_CONTEXT_REG = /[`~$]|^(?:\t| {4})/;
const MARKDOWN_ROOT_CODE_FENCE_REG = /^ {0,3}(`{3,}|~{3,})(.*)$/;

const sanitizeMarkdownText = (text: string): string => sanitizeText(text).replace(/^&gt;/gm, '>');

const normalizeParsedMathEntities = (html: string): string =>
  html.replace(/<(span|div) data-mx-maths="[^"]*">[\s\S]*?<\/\1>/g, (mathHtml) =>
    mathHtml.replace(/&amp;(amp|lt|gt|quot|#39);/g, '&$1;')
  );

type MarkdownCodeFence = {
  character: '`' | '~';
  length: number;
};

const getMarkdownCodeFence = (line: string): MarkdownCodeFence | undefined => {
  const match = line.match(MARKDOWN_ROOT_CODE_FENCE_REG);
  if (!match) return undefined;

  const fence = match[1];
  const character = fence[0] as '`' | '~';
  if (character === '`' && match[2].includes('`')) return undefined;

  return { character, length: fence.length };
};

const isMarkdownCodeFenceClose = (line: string, fence: MarkdownCodeFence): boolean => {
  const stripped = line.replace(/^ {0,3}/, '');
  let runLength = 0;
  while (stripped[runLength] === fence.character) runLength += 1;

  return runLength >= fence.length && stripped.slice(runLength).trim() === '';
};

const normalizeMarkdownDashLists = (markdown: string): string => {
  let codeFence: MarkdownCodeFence | undefined;
  let displayMath = false;

  return markdown
    .split('\n')
    .map((line) => {
      if (codeFence) {
        if (isMarkdownCodeFenceClose(line, codeFence)) codeFence = undefined;
        return line;
      }

      if (line === '$$') {
        displayMath = !displayMath;
        return line;
      }
      if (displayMath) return line;

      const openingFence = getMarkdownCodeFence(line);
      if (openingFence) {
        codeFence = openingFence;
        return line;
      }

      return line.replace(/^(\s*)-( +)(?=\S)/, '$1*$2');
    })
    .join('\n');
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

  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const hasAmbiguousMarkerContext = lines.some(
    (line) =>
      MARKDOWN_AMBIGUOUS_MARKER_CONTEXT_REG.test(line) &&
      !(line === line.trim() && parseMindroomToolRefText(line))
  );
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
      const parsedHtml = parseBlockMD(sanitizeMarkdownText(normalizedMarkdown), parseInlineMD);
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
