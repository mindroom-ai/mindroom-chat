export type ArgumentValue =
  | { kind: 'text'; text: string }
  | { kind: 'scalar'; text: string }
  | { kind: 'nested'; fields: ArgumentField[] }
  | { kind: 'json'; text: string };

export type ArgumentField = { key: string; value: ArgumentValue };

/** Labeled fields for an object of arguments, or the raw text when there is no object to label. */
export type ArgumentFields = { fields: ArgumentField[] } | { raw: string };

const INLINE_LIST_MAX_ITEMS = 5;
const INLINE_LIST_MAX_CHARS = 80;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const formatJson = (value: unknown): string => JSON.stringify(value, null, 2) ?? '';

// Tool arguments often carry JSON encoded as a string; only complete objects or arrays count.
const parseJsonContainer = (text: string): unknown => {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const toListValue = (items: unknown[]): ArgumentValue => {
  if (items.length === 0) return { kind: 'scalar', text: '[]' };
  const primitives = items.every(
    (item) => item === null || ['string', 'number', 'boolean'].includes(typeof item)
  );
  const inline = items.map(String).join(', ');
  return primitives &&
    items.length <= INLINE_LIST_MAX_ITEMS &&
    inline.length <= INLINE_LIST_MAX_CHARS &&
    !inline.includes('\n')
    ? { kind: 'scalar', text: inline }
    : { kind: 'json', text: formatJson(items) };
};

function toValue(value: unknown, nested: boolean): ArgumentValue {
  if (typeof value === 'string') {
    const container = parseJsonContainer(value);
    return container === undefined ? { kind: 'text', text: value } : toValue(container, nested);
  }
  if (Array.isArray(value)) return toListValue(value);
  if (isRecord(value)) {
    return nested
      ? { kind: 'json', text: formatJson(value) }
      : { kind: 'nested', fields: toFields(value, true) };
  }
  return { kind: 'scalar', text: value === undefined ? '' : String(value) };
}

function toFields(record: Record<string, unknown>, nested: boolean): ArgumentField[] {
  return Object.entries(record).map(([key, value]) => ({ key, value: toValue(value, nested) }));
}

export const toArgumentFields = (value: unknown): ArgumentFields => {
  const parsed = typeof value === 'string' ? parseJsonContainer(value) : value;
  if (isRecord(parsed)) return { fields: toFields(parsed, false) };
  if (typeof value === 'string') return { raw: value };
  return { raw: value === undefined ? '' : formatJson(value) };
};

// MindRoom writes tool-call previews as `key=value, key=value`; values are text or compact JSON.
const TOOL_ARGUMENT_KEY = /(?:^|, )([A-Za-z_][\w.-]*)=/g;

/** Labeled fields for a tool-call `args_preview`, accepting JSON previews from older senders. */
export const toToolArgumentFields = (preview: unknown): ArgumentFields => {
  if (typeof preview !== 'string' || parseJsonContainer(preview) !== undefined) {
    return toArgumentFields(preview);
  }
  const matches = [...preview.matchAll(TOOL_ARGUMENT_KEY)];
  if (matches.length === 0 || matches[0].index !== 0) return { raw: preview };
  return {
    fields: matches.map((match, index) => {
      const start = (match.index ?? 0) + match[0].length;
      const end = index + 1 < matches.length ? matches[index + 1].index ?? preview.length : preview.length;
      return { key: match[1], value: toValue(preview.slice(start, end), false) };
    }),
  };
};
