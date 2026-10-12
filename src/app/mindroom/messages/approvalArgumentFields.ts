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

const EMPTY_TEXT = new Set(['', '[]', '{}', 'null']);

const renderedLength = (value: ArgumentValue): number =>
  value.kind === 'nested'
    ? value.fields.reduce(
        (total, field) => total + field.key.length + renderedLength(field.value),
        0
      )
    : value.text.length;

const isEmptyValue = (value: ArgumentValue): boolean =>
  value.kind === 'nested' ? value.fields.length === 0 : EMPTY_TEXT.has(value.text.trim());

/**
 * Fields worth a glance before expanding: Matrix stores event JSON with sorted keys, so event
 * order puts `body` before `to`. Prefer filled-in fields, shortest first.
 */
export const pickPreviewFields = (fields: ArgumentField[], limit: number): ArgumentField[] => {
  const filled = fields.filter((field) => !isEmptyValue(field.value));
  return (filled.length > 0 ? filled : fields)
    .map((field, index) => ({ field, index, length: renderedLength(field.value) }))
    .sort((a, b) => a.length - b.length || a.index - b.index)
    .slice(0, limit)
    .map(({ field }) => field);
};

const valueText = (value: ArgumentValue): string =>
  value.kind === 'nested'
    ? value.fields.map((field) => `${field.key}: ${valueText(field.value)}`).join(', ')
    : value.text;

/**
 * One set of fields for several calls of the same tool: values they share show once,
 * values that differ are joined, so a group reads like the mockup's "#a · #b".
 */
export const mergeArgumentFields = (values: unknown): ArgumentFields => {
  const parsed = (Array.isArray(values) ? values : [values]).map(toArgumentFields);
  const [first] = parsed;
  if (!first) return { raw: '' };
  const labeled = parsed.filter((item): item is { fields: ArgumentField[] } => 'fields' in item);
  if (parsed.length === 1 || labeled.length !== parsed.length) return first;
  return {
    fields: labeled[0].fields.map(({ key, value }) => {
      const texts = labeled.map((item) => {
        const match = item.fields.find((field) => field.key === key);
        return match ? valueText(match.value) : '';
      });
      const distinct = [...new Set(texts)];
      return distinct.length === 1
        ? { key, value }
        : { key, value: { kind: 'text', text: distinct.filter(Boolean).join(' · ') } };
    }),
  };
};

/** The most telling argument as "key value" on one line, for a summary next to a decision. */
export const summarizeArguments = (value: unknown): string | undefined => {
  const parsed = toArgumentFields(value);
  if (!('fields' in parsed)) return undefined;
  const [field] = pickPreviewFields(parsed.fields, 1);
  if (!field) return undefined;
  const text = field.value.kind === 'nested' ? '{…}' : field.value.text;
  return `${field.key} ${text.replace(/\s+/g, ' ').trim()}`;
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
      const end =
        index + 1 < matches.length ? matches[index + 1].index ?? preview.length : preview.length;
      return { key: match[1], value: toValue(preview.slice(start, end), false) };
    }),
  };
};
