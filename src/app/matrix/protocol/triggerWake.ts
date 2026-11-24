import { isRecord } from '../../lib/isRecord';

export const SOURCE_KIND_KEY = 'com.mindroom.source_kind';
export const REACTIVE_TRIGGER_ID_KEY = 'io.mindroom.reactive_trigger.id';
export const REACTIVE_TRIGGER_DEDUPE_KEY = 'io.mindroom.reactive_trigger.dedupe_key';
export const EXTERNAL_TRIGGER_ID_KEY = 'io.mindroom.external_trigger.id';
export const EXTERNAL_TRIGGER_KIND_KEY = 'io.mindroom.external_trigger.kind';
export const EXTERNAL_TRIGGER_EVENT_ID_KEY = 'io.mindroom.external_trigger.event_id';

export type TriggerWakeSourceKind = 'reactive' | 'external';

export type TriggerWakeInfo = {
  sourceKind: TriggerWakeSourceKind;
  triggerId?: string;
  kind?: string;
  sourceType?: string;
  triage?: string;
  prompt: string;
  eventJson?: string;
  rawBody: string;
};

type ContextKey = 'trigger' | 'source' | 'kind' | 'triage';

const TEXT_MSGTYPES: ReadonlySet<unknown> = new Set(['m.text', 'm.notice']);
const UNTRUSTED_OPEN = /(?:^|\n)[ \t]*<untrusted_event_data>[ \t]*(?:\n|$)/;
const UNTRUSTED_CLOSE = /[ \t]*<\/untrusted_event_data>/;
const FENCE_OPEN = /^```(?:json)?[ \t]*\n/i;
const TRAILING_JSON_OPEN = /(?:^|\n)[ \t]*```json[ \t]*\n/gi;
const FENCE_CLOSE_LINE = /(?:^|\n)[ \t]*```[ \t]*(?:\n|$)/;
const CONTEXT_LINE = /^[ \t]*Reactive trigger context:[ \t]*(.*)$/gm;
const CONTEXT_FIELD = /(?:^|,\s*)(trigger|source|kind|triage)=/g;
const LEADING_AGENT_MENTION = /^@mindroom_[^\s:]+:[^\s]+(?:\s+|$)/i;

const nonEmpty = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const isContextKey = (value: string | undefined): value is ContextKey =>
  value === 'trigger' || value === 'source' || value === 'kind' || value === 'triage';

const readSourceKind = (content: Record<string, unknown>): TriggerWakeSourceKind | null => {
  const kind = content[SOURCE_KIND_KEY];
  if (kind === 'reactive_trigger') return 'reactive';
  if (kind === 'external_trigger') return 'external';
  if (kind !== undefined) return null;
  if (nonEmpty(content[REACTIVE_TRIGGER_ID_KEY])) return 'reactive';
  return nonEmpty(content[EXTERNAL_TRIGGER_ID_KEY]) ? 'external' : null;
};

const extractPayload = (body: string) => {
  const untrusted = UNTRUSTED_OPEN.exec(body);
  if (untrusted) {
    const after = body.slice(untrusted.index + untrusted[0].length);
    const close = UNTRUSTED_CLOSE.exec(after);
    const inner = (close ? after.slice(0, close.index) : after).trim();
    const rawJson = nonEmpty(
      FENCE_OPEN.test(inner) ? inner.replace(FENCE_OPEN, '').replace(/\n?```[ \t]*$/, '') : inner
    );
    return { head: body.slice(0, untrusted.index), rawJson, fromUntrusted: true };
  }
  const lastOpen = [...body.matchAll(TRAILING_JSON_OPEN)].at(-1);
  if (lastOpen?.index === undefined) return { head: body, fromUntrusted: false };
  const rest = body.slice(lastOpen.index + lastOpen[0].length);
  const close = FENCE_CLOSE_LINE.exec(rest);
  if (close && rest.slice(close.index + close[0].length).trim()) {
    return { head: body, fromUntrusted: false };
  }
  const rawJson = nonEmpty(close ? rest.slice(0, close.index) : rest);
  return { head: body.slice(0, lastOpen.index), rawJson, fromUntrusted: false };
};

const parseContextFields = (line: string): Partial<Record<ContextKey, string>> => {
  const entries: Array<{ key: ContextKey; start: number; valueStart: number }> = [];
  for (const match of line.matchAll(CONTEXT_FIELD)) {
    if (!isContextKey(match[1]) || match.index === undefined) continue;
    entries.push({ key: match[1], start: match.index, valueStart: match.index + match[0].length });
    if (match[1] === 'triage') break;
  }
  const fields: Partial<Record<ContextKey, string>> = {};
  entries.forEach(({ key, valueStart }, index) => {
    const value = nonEmpty(line.slice(valueStart, entries[index + 1]?.start ?? line.length));
    if (value && fields[key] === undefined) fields[key] = value;
  });
  return fields;
};

const parseJsonObject = (raw: string | undefined): Record<string, unknown> | undefined => {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

/**
 * MindRoom's reactive or direct external trigger wake message: its trigger metadata, human prompt
 * (with any single leading `@mindroom_<localpart>:<server>` mention stripped) and event JSON.
 * Returns null for non-text, empty or non-trigger messages; never throws on malformed bodies.
 */
export const readTriggerWake = (content: Record<string, unknown>): TriggerWakeInfo | null => {
  if (!TEXT_MSGTYPES.has(content.msgtype)) return null;
  if (typeof content.body !== 'string' || !content.body.trim()) return null;
  const sourceKind = readSourceKind(content);
  if (!sourceKind) return null;

  const rawBody = content.body;
  const { head, rawJson, fromUntrusted } = extractPayload(rawBody.replace(/\r\n?/g, '\n'));
  const contextMatch = [...head.matchAll(CONTEXT_LINE)].at(-1);
  const ctx = contextMatch ? parseContextFields(contextMatch[1] ?? '') : {};
  const promptSection =
    contextMatch?.index !== undefined ? head.slice(0, contextMatch.index) : head;
  const prompt = promptSection.trim().replace(LEADING_AGENT_MENTION, '').trim();

  const json = fromUntrusted ? parseJsonObject(rawJson) : undefined;
  const triggerId =
    nonEmpty(
      content[sourceKind === 'reactive' ? REACTIVE_TRIGGER_ID_KEY : EXTERNAL_TRIGGER_ID_KEY]
    ) ?? ctx.trigger;
  const kind = nonEmpty(content[EXTERNAL_TRIGGER_KIND_KEY]) ?? ctx.kind ?? nonEmpty(json?.kind);
  const sourceType = ctx.source ?? nonEmpty(json?.source_type);
  const eventJson = rawJson?.replace(/<\\\//g, '</');

  return {
    sourceKind,
    ...(triggerId !== undefined && { triggerId }),
    ...(kind !== undefined && { kind }),
    ...(sourceType !== undefined && { sourceType }),
    ...(ctx.triage !== undefined && { triage: ctx.triage }),
    prompt,
    ...(eventJson !== undefined && { eventJson }),
    rawBody,
  };
};
