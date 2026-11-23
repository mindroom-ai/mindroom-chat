import { revealDirectionControls } from '../../ui/directional';
import { safeStringifyJson } from './eventSourceDocuments';

export const LONG_STRING_THRESHOLD = 120;
export const LONG_STRING_SNIPPET_LENGTH = 48;
export const MAX_TREE_NODES = 5_000;
export const MAX_RAW_HIGHLIGHT_LENGTH = 200_000;

const MIN_TIMESTAMP_MS = 1e12;
const MAX_TIMESTAMP_MS = 1e14;

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

/** Entries of a container in display order, skipping `undefined` object properties just like JSON. */
export const getContainerEntries = (container: JsonContainer): JsonEntry[] => {
  if (Array.isArray(container)) {
    return container.map((value, index) => ({
      key: undefined,
      segment: String(index),
      value: value === undefined ? null : value,
    }));
  }
  const entries: JsonEntry[] = [];
  for (const [key, value] of Object.entries(container)) {
    if (value !== undefined) {
      entries.push({ key, segment: key, value });
    }
  }
  return entries;
};

/** Whether a numeric value looks like a millisecond epoch timestamp on a `*_ts` field. */
export const isTimestampField = (key: string | undefined, value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= MIN_TIMESTAMP_MS &&
  value <= MAX_TIMESTAMP_MS &&
  key !== undefined &&
  (key === 'origin_server_ts' || key.endsWith('_ts'));

/** Counts total nodes in `value`, stopping once `limit` is reached. */
export const countTreeNodes = (value: unknown, limit = MAX_TREE_NODES + 1): number => {
  let count = 0;
  const ancestors = new Set<object>();

  const visit = (node: unknown): void => {
    if (count >= limit) return;
    count += 1;
    if (!isJsonContainer(node) || ancestors.has(node)) return;
    ancestors.add(node);
    try {
      for (const entry of getContainerEntries(node)) {
        if (count >= limit) break;
        visit(entry.value);
      }
    } finally {
      ancestors.delete(node);
    }
  };

  visit(value);
  return count;
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
  allCollapsibleAtDepthGte1: string[];
  defaultCollapsed: Set<string>;
};

export const analyzeTreeStructure = (root: unknown): TreeStructureMeta => {
  const allCollapsibleAtDepthGte1: string[] = [];
  const defaultCollapsed = new Set<string>();
  const ancestors = new Set<object>();

  const visit = (
    node: unknown,
    path: string,
    key: string | undefined,
    parentKey: string | undefined,
    depth: number
  ): void => {
    if (!isJsonContainer(node) || ancestors.has(node)) return;
    const entries = getContainerEntries(node);
    if (entries.length === 0) return;

    if (depth >= 1) {
      allCollapsibleAtDepthGte1.push(path);
    }
    if (shouldCollapseByDefault(key, parentKey, node, depth)) {
      defaultCollapsed.add(path);
    }

    ancestors.add(node);
    try {
      for (const entry of entries) {
        visit(entry.value, joinPointer(path, entry.segment), entry.key, key, depth + 1);
      }
    } finally {
      ancestors.delete(node);
    }
  };

  visit(root, '', undefined, undefined, 0);
  return { allCollapsibleAtDepthGte1, defaultCollapsed };
};

export type TreeFilterResult = {
  query: string;
  matchCount: number;
  visiblePaths: Set<string>;
  autoExpandPaths: Set<string>;
  matchedValuePaths: Set<string>;
};

const formatPrimitiveForSearch = (value: unknown): string => {
  if (typeof value === 'string') return revealDirectionControls(value);
  if (typeof value === 'bigint') return value.toString();
  if (value === null) return 'null';
  return String(value);
};

/**
 * Case-insensitive substring filter over keys and primitive values. Matching branches are marked
 * for auto-expansion, and when a container's own key matches its descendants remain accessible.
 */
export const computeTreeFilter = (root: unknown, rawQuery: string): TreeFilterResult | null => {
  const trimmed = rawQuery.trim();
  if (trimmed.length === 0) return null;

  const needle = revealDirectionControls(trimmed).toLowerCase();
  const visiblePaths = new Set<string>();
  const autoExpandPaths = new Set<string>();
  const matchedValuePaths = new Set<string>();
  const ancestors = new Set<object>();
  let matchCount = 0;

  const visit = (
    node: unknown,
    path: string,
    key: string | undefined,
    ancestorMatched: boolean
  ): boolean => {
    const keyText = key !== undefined ? revealDirectionControls(key).toLowerCase() : '';
    const keyMatches = key !== undefined && keyText.includes(needle);

    if (!isJsonContainer(node) || ancestors.has(node)) {
      const valueText = isJsonContainer(node)
        ? '[circular]'
        : formatPrimitiveForSearch(node).toLowerCase();
      const valueMatches = valueText.includes(needle);
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

    ancestors.add(node);
    try {
      for (const entry of getContainerEntries(node)) {
        const childMatched = visit(
          entry.value,
          joinPointer(path, entry.segment),
          entry.key,
          ancestorMatched || keyMatches
        );
        if (childMatched) descendantMatched = true;
      }
    } finally {
      ancestors.delete(node);
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
    query: revealDirectionControls(trimmed),
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

/** Splits `text` case-insensitively on `query` for `<mark>` highlighting. */
export const splitHighlightSegments = (text: string, query: string): HighlightSegment[] => {
  if (!query) return [{ text, match: false }];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  if (!lowerQuery) return [{ text, match: false }];

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  let found = lowerText.indexOf(lowerQuery, cursor);
  while (found !== -1) {
    if (found > cursor) {
      segments.push({ text: text.slice(cursor, found), match: false });
    }
    segments.push({ text: text.slice(found, found + query.length), match: true });
    cursor = found + query.length;
    found = lowerText.indexOf(lowerQuery, cursor);
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), match: false });
  }
  return segments.length > 0 ? segments : [{ text, match: false }];
};

/** Single-line snippet for folded long strings (takes already direction-revealed text). */
export const makeStringSnippet = (revealedText: string): string => {
  const singleLine = revealedText.replace(/\s+/g, ' ');
  if (singleLine.length <= LONG_STRING_SNIPPET_LENGTH) return singleLine;
  return `${singleLine.slice(0, LONG_STRING_SNIPPET_LENGTH).trimEnd()}…`;
};

/** Raw copy payload for a JSON node: raw string for string leaves, formatted JSON otherwise. */
export const formatCopyValue = (value: unknown): string =>
  typeof value === 'string' ? value : safeStringifyJson(value);
