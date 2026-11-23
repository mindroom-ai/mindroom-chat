import { dateTimeFormat } from '../../lib/time';
import { revealDirectionControls } from '../../ui/directional';
import { isValidTimestampMs, safeStringifyJson } from './eventSourceDocuments';

export const LONG_STRING_THRESHOLD = 120;
export const LONG_STRING_SNIPPET_LENGTH = 48;
export const MAX_TREE_NODES = 5_000;
export const MAX_RAW_HIGHLIGHT_LENGTH = 200_000;

const DEFAULT_COLLAPSED_KEYS = new Set(['m.mentions', 'm.relates_to', 'io.mindroom.tool_trace']);

export type JsonContainer = Record<string, unknown> | unknown[];
export type JsonEntry = { key: string | undefined; segment: string; path: string; value: unknown };
export type TreeStructureMeta = {
  allCollapsibleAtDepthGte1: string[];
  defaultCollapsed: Set<string>;
};
export type TreeFilterResult = {
  query: string;
  matchCount: number;
  visiblePaths: Set<string>;
  autoExpandPaths: Set<string>;
  matchedValuePaths: Set<string>;
};
export type HighlightSegment = { text: string; match: boolean };

export const getContainerEntries = (container: JsonContainer, parentPath = ''): JsonEntry[] => {
  const make = (segment: string, value: unknown, key?: string): JsonEntry => ({
    key,
    segment,
    path: `${parentPath}/${segment.replace(/~/g, '~0').replace(/\//g, '~1')}`,
    value,
  });
  return Array.isArray(container)
    ? container.map((value, i) => make(String(i), value))
    : Object.entries(container).map(([key, value]) => make(key, value, key));
};

export const isTimestampField = (key: string | undefined, value: unknown): value is number =>
  isValidTimestampMs(value) &&
  key !== undefined &&
  (key === 'origin_server_ts' || key.endsWith('_ts'));

export const formatTimestampHint = (ts: number, language: string): string | undefined => {
  if (!isValidTimestampMs(ts)) return undefined;
  try {
    return dateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'medium' }).format(ts);
  } catch {
    return undefined;
  }
};

/** JSON string inner text (without quotes) with bidirectional controls revealed as `<U+XXXX>`. */
export const formatJsonStringInner = (value: string): string =>
  revealDirectionControls(JSON.stringify(value).slice(1, -1));

export const exceedsTreeNodeLimit = (root: unknown, limit = MAX_TREE_NODES): boolean => {
  let count = 0;
  const visit = (node: unknown): boolean => {
    if ((count += 1) > limit) return true;
    if (node === null || typeof node !== 'object') return false;
    return (Array.isArray(node) ? node : Object.values(node)).some(visit);
  };
  return visit(root);
};

export const analyzeTreeStructure = (root: unknown): TreeStructureMeta => {
  const allCollapsibleAtDepthGte1: string[] = [];
  const defaultCollapsed = new Set<string>();

  const visit = (
    node: unknown,
    path: string,
    key: string | undefined,
    parentKey: string | undefined,
    depth: number
  ): void => {
    if (node === null || typeof node !== 'object') return;
    const entries = getContainerEntries(node as JsonContainer, path);
    if (entries.length === 0) return;

    if (depth >= 1) allCollapsibleAtDepthGte1.push(path);
    if (
      (depth === 1 && key === 'unsigned') ||
      (depth === 2 &&
        parentKey === 'content' &&
        key !== undefined &&
        DEFAULT_COLLAPSED_KEYS.has(key)) ||
      (Array.isArray(node) && depth >= 2 && entries.length > 5)
    ) {
      defaultCollapsed.add(path);
    }
    for (const entry of entries) visit(entry.value, entry.path, entry.key, key, depth + 1);
  };

  visit(root, '', undefined, undefined, 0);
  return { allCollapsibleAtDepthGte1, defaultCollapsed };
};

const searchRegex = (query: string, flags: 'iu' | 'giu'): RegExp =>
  new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);

export const computeTreeFilter = (root: unknown, rawQuery: string): TreeFilterResult | null => {
  const trimmed = rawQuery.trim();
  if (!trimmed) return null;

  const query = revealDirectionControls(trimmed);
  const matcher = searchRegex(query, 'iu');
  const visiblePaths = new Set<string>();
  const autoExpandPaths = new Set<string>();
  const matchedValuePaths = new Set<string>();
  let matchCount = 0;

  const visit = (
    node: unknown,
    path: string,
    key: string | undefined,
    ancestorMatched: boolean
  ): boolean => {
    const keyMatches = key !== undefined && matcher.test(formatJsonStringInner(key));
    if (node === null || typeof node !== 'object') {
      const text = typeof node === 'string' ? formatJsonStringInner(node) : String(node);
      const valueMatches = matcher.test(text);
      if (valueMatches) matchedValuePaths.add(path);
      if (keyMatches || valueMatches) matchCount += 1;
      if (keyMatches || valueMatches || ancestorMatched) visiblePaths.add(path);
      return keyMatches || valueMatches;
    }

    if (keyMatches) matchCount += 1;
    let descendantMatched = false;
    for (const entry of getContainerEntries(node as JsonContainer, path)) {
      if (visit(entry.value, entry.path, entry.key, ancestorMatched || keyMatches)) {
        descendantMatched = true;
      }
    }
    if (descendantMatched) autoExpandPaths.add(path);
    if (keyMatches || descendantMatched || ancestorMatched) visiblePaths.add(path);
    return keyMatches || descendantMatched;
  };

  visit(root, '', undefined, false);
  return { query, matchCount, visiblePaths, autoExpandPaths, matchedValuePaths };
};

/** Splits `text` case-insensitively on `query` for `<mark>` highlighting, preserving Unicode indices. */
export const splitHighlightSegments = (text: string, query: string): HighlightSegment[] => {
  if (!query) return [{ text, match: false }];
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(searchRegex(query, 'giu'))) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (end === start) continue;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), match: false });
    segments.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments.length > 0 ? segments : [{ text, match: false }];
};

/** Code-point-safe quoted preview for folded long strings, normalizing whitespace and revealing bidi controls. */
export const makeStringSnippet = (rawString: string): string => {
  const singleLine = rawString.replace(/\s+/g, ' ');
  const headUnits = LONG_STRING_SNIPPET_LENGTH * 2;
  const codePoints = Array.from(singleLine.slice(0, headUnits));
  const isCut = singleLine.length > headUnits || codePoints.length > LONG_STRING_SNIPPET_LENGTH;
  const snippet = isCut
    ? codePoints.slice(0, LONG_STRING_SNIPPET_LENGTH).join('').trimEnd()
    : singleLine;
  const escaped = formatJsonStringInner(snippet);
  return isCut || singleLine !== rawString ? `"${escaped}…"` : `"${escaped}"`;
};

export const formatCopyValue = (value: unknown): string =>
  typeof value === 'string' ? value : safeStringifyJson(value);
