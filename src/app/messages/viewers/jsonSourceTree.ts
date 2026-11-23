import { dateTimeFormat } from '../../lib/time';
import { revealDirectionControls } from '../../ui/directional';
import { isValidTimestampMs, safeStringifyJson } from './eventSourceDocuments';

export const LONG_STRING_THRESHOLD = 120;
export const LONG_STRING_SNIPPET_LENGTH = 48;
export const MAX_TREE_NODES = 5_000;
export const MAX_RAW_HIGHLIGHT_LENGTH = 200_000;

const DEFAULT_COLLAPSED_CONTENT_KEYS = new Set([
  'm.mentions',
  'm.relates_to',
  'io.mindroom.tool_trace',
]);

export type JsonContainer = Record<string, unknown> | unknown[];

export type JsonEntry = {
  key: string | undefined;
  segment: string;
  value: unknown;
};

export const isJsonContainer = (value: unknown): value is JsonContainer =>
  value !== null && typeof value === 'object';

export const encodePointerSegment = (segment: string): string =>
  segment.replace(/~/g, '~0').replace(/\//g, '~1');

export const joinPointer = (parentPath: string, segment: string): string =>
  `${parentPath}/${encodePointerSegment(segment)}`;

/** Entries of a sanitized JSON container in display order. */
export const getContainerEntries = (container: JsonContainer): JsonEntry[] => {
  if (Array.isArray(container)) {
    return container.map((value, index) => ({
      key: undefined,
      segment: String(index),
      value,
    }));
  }
  return Object.entries(container).map(([key, value]) => ({
    key,
    segment: key,
    value,
  }));
};

/** Whether a numeric value looks like a millisecond epoch timestamp on a `*_ts` field. */
export const isTimestampField = (key: string | undefined, value: unknown): value is number =>
  isValidTimestampMs(value) &&
  key !== undefined &&
  (key === 'origin_server_ts' || key.endsWith('_ts'));

/** Safely formats a millisecond epoch timestamp for display, returning `undefined` if out of range. */
export const formatTimestampHint = (ts: number, language: string): string | undefined => {
  if (!isValidTimestampMs(ts)) return undefined;
  try {
    return dateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'medium' }).format(ts);
  } catch {
    return undefined;
  }
};

/**
 * Formats a JSON key or string value as valid JSON string inner text (without outer quotes) with
 * bidirectional controls revealed as `<U+XXXX>` code points.
 */
export const formatJsonStringInner = (value: string): string =>
  revealDirectionControls(JSON.stringify(value).slice(1, -1));

/** Fast short-circuit check for whether a sanitized JSON tree exceeds `limit` nodes. */
export const exceedsTreeNodeLimit = (root: unknown, limit = MAX_TREE_NODES): boolean => {
  let count = 0;

  const visit = (node: unknown): boolean => {
    count += 1;
    if (count > limit) return true;
    if (!isJsonContainer(node)) return false;
    for (const entry of getContainerEntries(node)) {
      if (visit(entry.value)) return true;
    }
    return false;
  };

  return visit(root);
};

export const shouldCollapseByDefault = (
  key: string | undefined,
  parentKey: string | undefined,
  value: JsonContainer,
  depth: number
): boolean => {
  const entries = getContainerEntries(value);
  if (entries.length === 0) return false;
  if (depth === 1 && key === 'unsigned') return true;
  if (depth === 2 && parentKey === 'content' && key !== undefined) {
    if (DEFAULT_COLLAPSED_CONTENT_KEYS.has(key)) return true;
  }
  if (Array.isArray(value) && depth >= 2 && entries.length > 5) return true;
  return false;
};

export type TreeStructureMeta = {
  nodeCount: number;
  allCollapsibleAtDepthGte1: string[];
  defaultCollapsed: Set<string>;
};

export const EMPTY_TREE_STRUCTURE: TreeStructureMeta = {
  nodeCount: 0,
  allCollapsibleAtDepthGte1: [],
  defaultCollapsed: new Set(),
};

/** Single-pass structural analysis collecting node count, collapsible paths, and default folds. */
export const analyzeTreeStructure = (root: unknown): TreeStructureMeta => {
  let nodeCount = 0;
  const allCollapsibleAtDepthGte1: string[] = [];
  const defaultCollapsed = new Set<string>();

  const visit = (
    node: unknown,
    path: string,
    key: string | undefined,
    parentKey: string | undefined,
    depth: number
  ): void => {
    nodeCount += 1;
    if (!isJsonContainer(node)) return;
    const entries = getContainerEntries(node);
    if (entries.length === 0) return;

    if (depth >= 1) {
      allCollapsibleAtDepthGte1.push(path);
    }
    if (shouldCollapseByDefault(key, parentKey, node, depth)) {
      defaultCollapsed.add(path);
    }

    for (const entry of entries) {
      visit(entry.value, joinPointer(path, entry.segment), entry.key, key, depth + 1);
    }
  };

  visit(root, '', undefined, undefined, 0);
  return { nodeCount, allCollapsibleAtDepthGte1, defaultCollapsed };
};

export type TreeFilterResult = {
  query: string;
  matchCount: number;
  visiblePaths: Set<string>;
  autoExpandPaths: Set<string>;
  matchedValuePaths: Set<string>;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildSearchRegex = (query: string, global: boolean): RegExp =>
  new RegExp(escapeRegExp(query), global ? 'giu' : 'iu');

const formatPrimitiveForSearch = (value: unknown): string => {
  if (typeof value === 'string') return formatJsonStringInner(value);
  if (value === null) return 'null';
  return String(value);
};

/**
 * Case-insensitive substring filter over rendered keys and primitive values. Matching branches are
 * marked for auto-expansion, and when a container's own key matches its descendants remain visible.
 */
export const computeTreeFilter = (root: unknown, rawQuery: string): TreeFilterResult | null => {
  const trimmed = rawQuery.trim();
  if (trimmed.length === 0) return null;

  const query = revealDirectionControls(trimmed);
  const matcher = buildSearchRegex(query, false);
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

    if (!isJsonContainer(node)) {
      const valueMatches = matcher.test(formatPrimitiveForSearch(node));
      if (valueMatches) matchedValuePaths.add(path);
      const selfMatches = keyMatches || valueMatches;
      if (selfMatches) matchCount += 1;
      if (selfMatches || ancestorMatched) {
        visiblePaths.add(path);
      }
      return selfMatches;
    }

    if (keyMatches) matchCount += 1;
    let descendantMatched = false;

    for (const entry of getContainerEntries(node)) {
      const childMatched = visit(
        entry.value,
        joinPointer(path, entry.segment),
        entry.key,
        ancestorMatched || keyMatches
      );
      if (childMatched) descendantMatched = true;
    }

    if (descendantMatched) {
      autoExpandPaths.add(path);
    }
    if (keyMatches || descendantMatched || ancestorMatched) {
      visiblePaths.add(path);
    }
    return keyMatches || descendantMatched;
  };

  visit(root, '', undefined, false);
  return {
    query,
    matchCount,
    visiblePaths,
    autoExpandPaths,
    matchedValuePaths,
  };
};

export type HighlightSegment = {
  text: string;
  match: boolean;
};

/** Splits `text` case-insensitively on `query` for `<mark>` highlighting, preserving Unicode indices. */
export const splitHighlightSegments = (text: string, query: string): HighlightSegment[] => {
  if (!query) return [{ text, match: false }];

  const regex = buildSearchRegex(query, true);
  const segments: HighlightSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(regex)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (end === start) continue;
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), match: false });
    }
    segments.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), match: false });
  }
  return segments.length > 0 ? segments : [{ text, match: false }];
};

/**
 * Single-line JSON-escaped quoted preview for folded long strings (`> LONG_STRING_THRESHOLD` chars),
 * with whitespace normalized and bidirectional controls revealed.
 */
export const makeStringSnippet = (rawString: string): string => {
  const singleLine = rawString.replace(/\s+/g, ' ');
  const isTruncated = singleLine.length > LONG_STRING_SNIPPET_LENGTH || singleLine !== rawString;
  const snippet =
    singleLine.length > LONG_STRING_SNIPPET_LENGTH
      ? singleLine.slice(0, LONG_STRING_SNIPPET_LENGTH).trimEnd()
      : singleLine;
  const escaped = formatJsonStringInner(snippet);
  return isTruncated ? `"${escaped}…"` : `"${escaped}"`;
};

/** Raw copy payload for a JSON node: raw string for string leaves, formatted JSON otherwise. */
export const formatCopyValue = (value: unknown): string =>
  typeof value === 'string' ? value : safeStringifyJson(value);
