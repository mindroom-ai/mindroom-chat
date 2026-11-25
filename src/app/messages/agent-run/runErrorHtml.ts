import { isText, type ChildNode } from 'domhandler';
import type { DOMNode } from 'html-react-parser';
import type { AiRunErrorInfo } from '../../matrix/protocol/aiRun';
import { parseHtmlToDom } from '../../rich-text/parseHtml';
import { serializeHtmlNode } from './finishedWorkSplit';
import { isDomElementNode } from './toolRefDom';

const RESTART_SEAM_SENTINEL_REG = /^\uE000restart-seam:([1-9]\d*)\uE000$/;

const RESTART_MARKER_TEXTS = new Set([
  '[Response interrupted by service restart]',
  '[Response interrupted: agent restarted to apply a config change]',
]);

const FALLBACK_PREFIX_REG = /^(?:⚠️|⚠|❌|🔑|⏰|\[[^\]]+\]\s+)/u;

const INLINE_TAGS = new Set([
  'a',
  'b',
  'br',
  'code',
  'del',
  'em',
  'font',
  'i',
  's',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'u',
]);

const BLOCK_TAGS = new Set(
  'blockquote details div h1 h2 h3 h4 h5 h6 hr ol p pre table ul'.split(' ')
);

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();

const isBlank = (node: ChildNode | undefined): boolean =>
  !!node && isText(node) && node.data.trim() === '';

const isBreak = (node: ChildNode | undefined): boolean =>
  !!node && isDomElementNode(node) && node.name === 'br';

const inlineText = (nodes: ChildNode[]): string | undefined => {
  let text = '';
  for (const node of nodes) {
    if (isText(node)) text += node.data;
    else if (!isDomElementNode(node) || !INLINE_TAGS.has(node.name)) return undefined;
    else if (node.name === 'br') text += '\n';
    else {
      const inner = inlineText(node.children);
      if (inner === undefined) return undefined;
      text += inner;
    }
  }
  return text;
};

type Part = { start: number; end: number; text?: string };

const partsOf = (all: ChildNode[]): Part[] => {
  const parts: Part[] = [];
  let run: number | undefined;
  const closeRun = (end: number) => {
    const nodes = run === undefined ? [] : all.slice(run, end);
    if (run !== undefined && !nodes.every((node) => isBlank(node) || isBreak(node))) {
      parts.push({ start: run, end, text: inlineText(nodes) });
    }
    run = undefined;
  };
  for (let index = 0; index < all.length; index += 1) {
    const node = all[index];
    if (node && isDomElementNode(node) && BLOCK_TAGS.has(node.name)) {
      closeRun(index);
      const text = node.name === 'p' ? inlineText(node.children) : undefined;
      parts.push({ start: index, end: index + 1, ...(text === undefined ? {} : { text }) });
    } else if (isBreak(node)) {
      let next = index + 1;
      while (isBlank(all[next])) next += 1;
      if (isBreak(all[next])) {
        closeRun(index);
        index = next;
      } else {
        run ??= index;
      }
    } else {
      run ??= index;
    }
  }
  closeRun(all.length);
  return parts;
};

export const isFallbackRunErrorParagraph = (text: string, error: AiRunErrorInfo): boolean => {
  const normalizedText = normalize(text);
  const normalizedSummary = normalize(error.summary);
  if (!normalizedText || !normalizedSummary) return false;
  if (normalizedText === normalizedSummary) return true;
  return normalizedText.includes(normalizedSummary) && FALLBACK_PREFIX_REG.test(normalizedText);
};

/**
 * Strips only the trailing fallback error paragraph from an agent reply's HTML when it repeats
 * `error.summary`, keeping all earlier paragraphs and tool markers intact above RunErrorCard.
 */
export const stripTrailingRunErrorHtml = (
  html: string,
  error: AiRunErrorInfo
): { html: string; stripped: boolean } => {
  const all = parseHtmlToDom(html) as ChildNode[];
  const parts = partsOf(all);
  const last = parts[parts.length - 1];
  if (!last || last.text === undefined || !isFallbackRunErrorParagraph(last.text, error)) {
    return { html, stripped: false };
  }
  let from = last.start;
  while (from > 0 && (isBlank(all[from - 1]) || isBreak(all[from - 1]))) from -= 1;
  return {
    html: all.slice(0, from).map(serializeHtmlNode).join(''),
    stripped: true,
  };
};

/** Plain-text counterpart of `stripTrailingRunErrorHtml` for replies without HTML. */
export const stripTrailingRunErrorText = (
  body: string,
  error: AiRunErrorInfo
): { body: string; stripped: boolean } => {
  const normalized = body.replace(/\r\n?/g, '\n');
  const paragraphs = normalized.split(/\n[ \t]*\n/);
  while (paragraphs.length > 0 && paragraphs[paragraphs.length - 1]!.trim() === '') {
    paragraphs.pop();
  }
  const last = paragraphs[paragraphs.length - 1];
  if (last === undefined || !isFallbackRunErrorParagraph(last, error)) {
    return { body, stripped: false };
  }
  paragraphs.pop();
  return {
    body: paragraphs.join('\n\n').trimEnd(),
    stripped: true,
  };
};

const restartCountOfPart = (text: string | undefined): number => {
  if (text === undefined) return 0;
  const lines = text
    .split('\n')
    .map((line) => normalize(line))
    .filter((line) => line.length > 0);
  if (lines.length === 0) return 0;
  return lines.every((line) => RESTART_MARKER_TEXTS.has(line)) ? lines.length : 0;
};

const restartSeamHtml = (count: number): string => `<p>\uE000restart-seam:${count}\uE000</p>`;

/**
 * Replaces standalone or consecutive service-restart interruption paragraphs with a sentinel
 * paragraph rendered as a quiet horizontal seam.
 */
export const collapseRestartMarkersHtml = (
  html: string
): { html: string; hasRestartSeam: boolean } => {
  const all = parseHtmlToDom(html) as ChildNode[];
  const parts = partsOf(all);
  let hasRestartSeam = false;
  let output = '';
  let cursor = 0;

  let index = 0;
  while (index < parts.length) {
    const part = parts[index]!;
    const firstCount = restartCountOfPart(part.text);
    if (firstCount === 0) {
      index += 1;
      continue;
    }

    hasRestartSeam = true;
    let totalCount = firstCount;
    let endIndex = index;
    while (endIndex + 1 < parts.length) {
      const nextCount = restartCountOfPart(parts[endIndex + 1]!.text);
      if (nextCount === 0) break;
      totalCount += nextCount;
      endIndex += 1;
    }

    let from = part.start;
    while (from > cursor && (isBlank(all[from - 1]) || isBreak(all[from - 1]))) from -= 1;
    let to = parts[endIndex]!.end;
    while (to < all.length && (isBlank(all[to]) || isBreak(all[to]))) to += 1;

    output += all.slice(cursor, from).map(serializeHtmlNode).join('');
    output += restartSeamHtml(totalCount);
    cursor = to;
    index = endIndex + 1;
  }

  if (!hasRestartSeam) return { html, hasRestartSeam: false };
  output += all.slice(cursor).map(serializeHtmlNode).join('');
  return { html: output, hasRestartSeam: true };
};

/** Reads the restart count from a sentinel paragraph emitted by `collapseRestartMarkersHtml`. */
export const parseRestartSeamNode = (node: DOMNode): number | undefined => {
  if (!isDomElementNode(node) || node.name !== 'p' || node.children.length !== 1) return undefined;
  const child = node.children[0];
  if (!child || !isText(child)) return undefined;
  const match = RESTART_SEAM_SENTINEL_REG.exec(child.data);
  return match ? Number(match[1]) : undefined;
};
