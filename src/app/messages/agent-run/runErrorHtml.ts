import type { ChildNode } from 'domhandler';
import type { AiRunErrorInfo } from '../../matrix/protocol/aiRun';
import {
  createReplySlotNode,
  domContainsText,
  expandOverBlanks,
  normalize,
  topLevelParts,
} from './replyDomNodes';

const RESTART_MARKER_PREFIX = '[Response interrupted';
const RESTART_MARKER_TEXTS = new Set([
  '[Response interrupted by service restart]',
  '[Response interrupted: agent restarted to apply a config change]',
]);

const stripSimpleMarkdown = (text: string): string =>
  text
    .replace(/\*\*\*([^\s*](?:.*?[^\s*])??)\*\*\*/g, '$1')
    .replace(/(^|[^\w])___([^\s_](?:.*?[^\s_])??)___(?=$|[^\w])/g, '$1$2')
    .replace(/\*\*([^\s*](?:.*?[^\s*])??)\*\*/g, '$1')
    .replace(/(^|[^\w])__([^\s_](?:.*?[^\s_])??)__(?=$|[^\w])/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1');

const normalizeComparable = (text: string): string =>
  normalize(stripSimpleMarkdown(normalize(text)));

export const isFallbackRunErrorParagraph = (text: string, error: AiRunErrorInfo): boolean => {
  const normalizedText = normalizeComparable(text);
  if (!normalizedText) return false;
  const expected = normalizeComparable(error.fallback ?? error.summary);
  return Boolean(expected && normalizedText === expected);
};

/** Strips only the trailing fallback error paragraph from an agent reply's DOM when it matches. */
export const stripTrailingRunErrorDom = (
  dom: readonly ChildNode[],
  error: AiRunErrorInfo
): { nodes: ChildNode[]; stripped: boolean } => {
  const parts = topLevelParts(dom);
  const last = parts[parts.length - 1];
  if (!last || last.text === undefined || !isFallbackRunErrorParagraph(last.text, error)) {
    return { nodes: [...dom], stripped: false };
  }
  const [from] = expandOverBlanks(dom, last.start, last.end);
  return { nodes: dom.slice(0, from), stripped: true };
};

/** Plain-text counterpart of `stripTrailingRunErrorDom` for replies without HTML. */
export const stripTrailingRunErrorText = (
  body: string,
  error: AiRunErrorInfo
): { body: string; stripped: boolean } => {
  const paragraphs = body.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/);
  while (paragraphs.length > 0 && paragraphs[paragraphs.length - 1]!.trim() === '') {
    paragraphs.pop();
  }
  const last = paragraphs[paragraphs.length - 1];
  if (last === undefined || !isFallbackRunErrorParagraph(last, error)) {
    return { body, stripped: false };
  }
  paragraphs.pop();
  return { body: paragraphs.join('\n\n').trimEnd(), stripped: true };
};

const restartCountOfPart = (text: string | undefined): number => {
  if (text === undefined) return 0;
  const lines = text
    .split('\n')
    .map(normalize)
    .filter((line) => line.length > 0);
  return lines.length > 0 && lines.every((line) => RESTART_MARKER_TEXTS.has(line))
    ? lines.length
    : 0;
};

/** Replaces standalone or consecutive service-restart paragraphs with a symbol-tagged seam slot. */
export const collapseRestartMarkersDom = (
  dom: readonly ChildNode[]
): { nodes: ChildNode[]; hasRestartSeam: boolean } => {
  if (!domContainsText(dom, RESTART_MARKER_PREFIX)) {
    return { nodes: [...dom], hasRestartSeam: false };
  }
  const parts = topLevelParts(dom);
  const output: ChildNode[] = [];
  let hasRestartSeam = false;
  let cursor = 0;

  for (let index = 0; index < parts.length; index += 1) {
    const firstCount = restartCountOfPart(parts[index]!.text);
    if (firstCount === 0) continue;

    hasRestartSeam = true;
    let totalCount = firstCount;
    let endIndex = index;
    while (endIndex + 1 < parts.length) {
      const nextCount = restartCountOfPart(parts[endIndex + 1]!.text);
      if (nextCount === 0) break;
      totalCount += nextCount;
      endIndex += 1;
    }

    const [from, to] = expandOverBlanks(dom, parts[index]!.start, parts[endIndex]!.end, cursor);
    output.push(
      ...dom.slice(cursor, from),
      createReplySlotNode({ kind: 'restartSeam', count: totalCount })
    );
    cursor = to;
    index = endIndex;
  }

  if (!hasRestartSeam) return { nodes: [...dom], hasRestartSeam: false };
  output.push(...dom.slice(cursor));
  return { nodes: output, hasRestartSeam: true };
};
