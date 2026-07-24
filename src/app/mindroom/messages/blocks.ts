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

const sanitizeMarkdownText = (text: string): string => sanitizeText(text).replace(/^&gt;/gm, '>');

const MARKDOWN_CODE_FENCE_OPEN_REG = /^(`{3,})(?!`)\S*$/;

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
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const htmlParts: string[] = [];
  let markdownLines: string[] = [];
  let codeFence: string | undefined;
  let pastePlaceholderIndex = 0;
  let pastePlaceholderHtml = new Map<string, string>();

  const replacePasteMarkersWithPlaceholders = (line: string): string => {
    let cursor = 0;
    let text = '';

    findMindroomPasteMarkersInText(line).forEach(({ marker, index, length }) => {
      let placeholder = `\uE000MINDROOMPASTE${pastePlaceholderIndex}\uE001`;
      pastePlaceholderIndex += 1;
      while (body.includes(placeholder)) {
        placeholder = `\uE000MINDROOMPASTE${pastePlaceholderIndex}\uE001`;
        pastePlaceholderIndex += 1;
      }

      text += line.slice(cursor, index);
      text += placeholder;
      pastePlaceholderHtml.set(placeholder, formatMindroomPasteMarkerAsHtml(marker));
      cursor = index + length;
    });

    return `${text}${line.slice(cursor)}`;
  };

  const flushMarkdown = () => {
    if (markdownLines.length === 0) return;
    let html = parseBlockMD(sanitizeMarkdownText(markdownLines.join('\n')), parseInlineMD);
    pastePlaceholderHtml.forEach((markerHtml, placeholder) => {
      html = html.split(placeholder).join(markerHtml);
    });
    htmlParts.push(html);
    markdownLines = [];
    pastePlaceholderHtml = new Map();
  };

  lines.forEach((line) => {
    if (codeFence) {
      markdownLines.push(line);
      if (line.trimEnd() === codeFence) codeFence = undefined;
      return;
    }

    const openingFence = line.match(MARKDOWN_CODE_FENCE_OPEN_REG)?.[1];
    if (openingFence) {
      codeFence = openingFence;
      markdownLines.push(line);
      return;
    }

    const markerHtml = formatMindroomToolRefLineAsHtml(line);
    if (markerHtml) {
      flushMarkdown();
      htmlParts.push(markerHtml);
      return;
    }

    markdownLines.push(replacePasteMarkersWithPlaceholders(line));
  });

  flushMarkdown();
  return htmlParts.join('');
};
