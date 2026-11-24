import { isRecord } from '../../lib/isRecord';
import { getLongTextSource } from './longText';

export const TODO_POKE_CONTENT_KEY = 'io.mindroom.todo_poke';
export const HOOK_SOURCE_KEY = 'com.mindroom.hook_source';
export const TODO_POKE_METADATA_KEYS: readonly string[] = [TODO_POKE_CONTENT_KEY, HOOK_SOURCE_KEY];

export type TodoPokePriority = 'critical' | 'high' | 'medium' | 'low';
export type TodoPokeItem = { id: string; title: string; priority: TodoPokePriority };
export type TodoPokeInfo = {
  assignedAgent?: string;
  items: TodoPokeItem[];
  totalCount: number;
  rawBody: string;
};

const TEXT_MSGTYPES: ReadonlySet<unknown> = new Set(['m.text', 'm.notice']);
const PRIORITIES: ReadonlySet<string> = new Set(['critical', 'high', 'medium', 'low']);
const LEGACY_HEADER =
  /^(?:(@\S+)\s+)?Todo work is ready\.\s+Continue with these actionable items:$/i;
const NEW_HEADER =
  /^(?:(@\S+)\s+)?\*\*(\d+)\s+todo(?:\(s\)|s)?\s+ready\*\*(?::|\s+(?:—|–|--|-)\s+.*)?$/i;
const LEGACY_PRIORITY_GAP = /^\s+\[(critical|high|medium|low)\]\s+/i;
const NEW_PRIORITY_SEP = /\s+—\s+(critical|high|medium|low)\s+·\s+$/i;
const OVERFLOW_LINE =
  /^(?:-\s+)?(?:…|\.\.\.)and\s+(\d+)\s+more\s+actionable\s+item(?:\(s\)|s)?\.?$/i;
const MARKDOWN_ESCAPES = /\\([\\`*_[\]~<>])/g;

const nonEmpty = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const isPriority = (value: unknown): value is TodoPokePriority =>
  typeof value === 'string' && PRIORITIES.has(value);

const decodeCodeInner = (inner: string): string => {
  const unpadded =
    inner.length >= 2 &&
    inner.startsWith(' ') &&
    inner.endsWith(' ') &&
    (inner[1] === '`' || inner[inner.length - 2] === '`')
      ? inner.slice(1, -1)
      : inner;
  return unpadded.replaceAll('@\u200b', '@');
};

const readLeadingCodeSpan = (
  text: string,
  start: number
): { value: string; nextIndex: number } | null => {
  if (text[start] !== '`') return null;
  let fence = 0;
  while (text[start + fence] === '`') fence += 1;
  for (let i = start + fence; i < text.length;) {
    if (text[i] !== '`') {
      i += 1;
      continue;
    }
    let end = i;
    while (text[end] === '`') end += 1;
    if (end - i === fence) {
      return { value: decodeCodeInner(text.slice(start + fence, i)), nextIndex: end };
    }
    i = end;
  }
  return null;
};

const readTrailingCodeSpan = (text: string): { value: string; before: string } | null => {
  if (!text.endsWith('`')) return null;
  let fence = 0;
  while (fence < text.length && text[text.length - 1 - fence] === '`') fence += 1;
  const closeStart = text.length - fence;
  for (let i = closeStart - 1; i >= 0;) {
    if (text[i] !== '`') {
      i -= 1;
      continue;
    }
    let runStart = i;
    while (runStart > 0 && text[runStart - 1] === '`') runStart -= 1;
    if (i - runStart + 1 === fence) {
      return {
        value: decodeCodeInner(text.slice(i + 1, closeStart)),
        before: text.slice(0, runStart),
      };
    }
    i = runStart - 1;
  }
  return null;
};

const extractAssignedAgent = (mention: string | undefined): string | undefined => {
  if (!mention) return undefined;
  const normalized = mention.replaceAll('@\u200b', '@');
  return (
    /^@mindroom_([^:\s]+):[^\s]+$/i.exec(normalized)?.[1] ??
    /^@([^:\s]+)(?::[^\s]*)?$/.exec(normalized)?.[1]
  );
};

const parseLegacyItem = (line: string): TodoPokeItem | null => {
  const rest = line.replace(/^-\s+/, '');
  if (rest === line) return null;
  const idSpan = readLeadingCodeSpan(rest, 0);
  const id = idSpan ? nonEmpty(idSpan.value) : undefined;
  if (!idSpan || !id) return null;
  const gap = LEGACY_PRIORITY_GAP.exec(rest.slice(idSpan.nextIndex));
  const priority = gap?.[1]?.toLowerCase();
  if (!gap || !isPriority(priority)) return null;
  const titleSpan = readLeadingCodeSpan(rest, idSpan.nextIndex + gap[0].length);
  const title = titleSpan ? nonEmpty(titleSpan.value) : undefined;
  if (!titleSpan || !title || rest.slice(titleSpan.nextIndex).trim().length > 0) return null;
  return { id, title, priority };
};

const parseNewItem = (line: string): TodoPokeItem | null => {
  const rest = line.replace(/^-\s+/, '');
  if (rest === line) return null;
  const idSpan = readTrailingCodeSpan(rest);
  const id = idSpan ? nonEmpty(idSpan.value) : undefined;
  if (!idSpan || !id) return null;
  const sep = NEW_PRIORITY_SEP.exec(idSpan.before);
  const priority = sep?.[1]?.toLowerCase();
  if (!sep || !isPriority(priority)) return null;
  const title = nonEmpty(
    idSpan.before.slice(0, sep.index).replace(MARKDOWN_ESCAPES, '$1').replaceAll('@\u200b', '@')
  );
  return title ? { id, title, priority } : null;
};

const readStructuredTodoPoke = (payload: unknown, rawBody: string): TodoPokeInfo | null => {
  if (
    !isRecord(payload) ||
    payload.version !== 1 ||
    !Array.isArray(payload.items) ||
    payload.items.length === 0
  ) {
    return null;
  }
  const items: TodoPokeItem[] = [];
  for (const entry of payload.items) {
    if (!isRecord(entry)) return null;
    const id = nonEmpty(entry.id);
    const title = nonEmpty(entry.title);
    if (!id || !title || !isPriority(entry.priority)) return null;
    items.push({ id, title, priority: entry.priority });
  }
  const assignedAgent = nonEmpty(payload.assigned_agent);
  const rawTotal = payload.total_count;
  const totalCount =
    typeof rawTotal === 'number' && Number.isInteger(rawTotal) && rawTotal >= items.length
      ? rawTotal
      : items.length;
  return { ...(assignedAgent !== undefined && { assignedAgent }), items, totalCount, rawBody };
};

const readMarkdownTodoPoke = (rawBody: string): TodoPokeInfo | null => {
  const lines = rawBody
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2 || !lines[0]) return null;
  const legacyHeader = LEGACY_HEADER.exec(lines[0]);
  const newHeader = legacyHeader ? null : NEW_HEADER.exec(lines[0]);
  if (!legacyHeader && !newHeader) return null;

  const assignedAgent = extractAssignedAgent(legacyHeader?.[1] ?? newHeader?.[1]);
  const parsedHeaderCount = newHeader?.[2] ? Number.parseInt(newHeader[2], 10) : 0;
  const headerCount = Number.isSafeInteger(parsedHeaderCount) ? parsedHeaderCount : 0;
  const parseItem = legacyHeader ? parseLegacyItem : parseNewItem;

  const items: TodoPokeItem[] = [];
  let remaining = 0;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const overflow = OVERFLOW_LINE.exec(line);
    if (overflow) {
      if (i !== lines.length - 1) return null;
      const count = Number.parseInt(overflow[1] ?? '', 10);
      if (!Number.isSafeInteger(count) || count < 0) return null;
      remaining = count;
      break;
    }
    const item = parseItem(line);
    if (!item) return null;
    items.push(item);
  }
  if (items.length === 0) return null;
  const totalCount = Math.max(items.length, items.length + remaining, headerCount);
  return { ...(assignedAgent !== undefined && { assignedAgent }), items, totalCount, rawBody };
};

/**
 * Reads a MindRoom todo wake-up message (`io.mindroom.todo_poke` v1, or Markdown fallback gated on
 * `com.mindroom.hook_source === 'todo_poke'`). Returns null if unrecognized or malformed.
 */
export const readTodoPoke = (content: Record<string, unknown>): TodoPokeInfo | null => {
  const isLongText = content.msgtype === 'm.file' && getLongTextSource(content) !== undefined;
  if (!TEXT_MSGTYPES.has(content.msgtype) && !isLongText) return null;
  const rawBody = typeof content.body === 'string' ? content.body : '';
  if (content[TODO_POKE_CONTENT_KEY] !== undefined) {
    return readStructuredTodoPoke(content[TODO_POKE_CONTENT_KEY], rawBody);
  }
  return content[HOOK_SOURCE_KEY] === 'todo_poke' ? readMarkdownTodoPoke(rawBody) : null;
};
