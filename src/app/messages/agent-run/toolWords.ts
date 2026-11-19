import type { TFunction } from 'i18next';
import { ArgumentField, toToolArgumentFields } from '../../approvals/argumentFields';
import { toolNames } from './toolCallStatus';

/**
 * The most used tools, which a run's line and its rows name in words; `keys` are the arguments a
 * row shows beside its words, the first one the call has. Other tools keep their names.
 */
const TOOL_WORDS = {
  read: { tools: ['read_file', 'read_file_chunk'], keys: ['path', 'file_name'] },
  write: { tools: ['write_file', 'save_file'], keys: ['path', 'file_name'] },
  edit: { tools: ['edit_file', 'replace_file_chunk'], keys: ['path', 'file_name'] },
  command: { tools: ['run_shell_command', 'bash'], keys: ['command', 'args'] },
  searchFiles: { tools: ['grep', 'find_files', 'search_files'], keys: ['pattern', 'query'] },
  searchWeb: { tools: ['web_search', 'search_web', 'duckduckgo_search'], keys: ['query'] },
  readPage: { tools: ['read_url', 'scrape_webpage'], keys: ['url'] },
  schedule: { tools: ['schedule'], keys: ['request'] },
  listFiles: { tools: ['list_files', 'ls'], keys: ['directory', 'path'] },
  attachments: { tools: ['list_attachments'], keys: ['target'] },
  room: { tools: ['matrix_room'], keys: ['action'] },
} satisfies Record<string, { tools: string[]; keys: string[] }>;

type ToolWordGroup = keyof typeof TOOL_WORDS;

// Bookkeeping: a finished call folds under its run's other calls, which its line names alone.
const TOOL_STEPS: readonly ToolWordGroup[] = ['listFiles', 'attachments', 'room'];

const groupOf = (toolName: string) =>
  (Object.keys(TOOL_WORDS) as ToolWordGroup[]).find((group) =>
    TOOL_WORDS[group].tools.includes(toolName)
  );

export const isToolStep = (toolName: string) =>
  TOOL_STEPS.some((group) => TOOL_WORDS[group].tools.includes(toolName));

/** A row's words for its call ("Read file"), what it acts on on one line, and its other arguments. */
export const toolRowWords = (
  t: TFunction,
  toolName: string,
  argsPreview?: string
): { label: string; target?: string; rest?: ArgumentField[] } | undefined => {
  const group = groupOf(toolName);
  if (!group) return undefined;
  const label = t(`mindroomUi.messages.mindroomHtmlBlocks.toolWords.${group}.row`);
  const parsed = toToolArgumentFields(argsPreview ?? '');
  const fields = 'fields' in parsed ? parsed.fields : [];
  const target = TOOL_WORDS[group].keys
    .map((key) => fields.find((field) => field.key === key))
    .find(Boolean);
  if (!target || target.value.kind === 'nested') return { label };
  const rest = fields.filter((field) => field !== target);
  return { label, target: target.value.text.replace(/\s+/g, ' ').trim(), rest };
};

/**
 * A finished run's line in words ("Read 3 files · 1 failed"), and the names of its other tools as
 * its detail; undefined when none has words, so the line keeps its count.
 */
export const describeToolRun = (
  t: TFunction,
  language: string,
  calls: readonly { toolName: string }[],
  failed?: number
): { title: string; detail?: string } | undefined => {
  const groups = new Map<ToolWordGroup, number>();
  const others = calls.filter(({ toolName }) => {
    const group = groupOf(toolName);
    if (group) groups.set(group, (groups.get(group) ?? 0) + 1);
    return !group;
  });
  if (groups.size === 0) return undefined;
  const lead = [...groups.keys()].some((group) => !TOOL_STEPS.includes(group));
  const phrases = [...groups].flatMap(([group, count]) =>
    lead && TOOL_STEPS.includes(group)
      ? []
      : [t(`mindroomUi.messages.mindroomHtmlBlocks.toolWords.${group}.title`, { count })]
  );
  const count = others.length;
  if (count)
    phrases.push(t('mindroomUi.messages.mindroomHtmlBlocks.toolWords.moreTools', { count }));
  const words = new Intl.ListFormat(language).format(phrases);
  const failures = failed
    ? t('mindroomUi.messages.mindroomHtmlBlocks.toolCallsAlsoFailed', { failed })
    : '';
  const title = `${words.charAt(0).toLocaleUpperCase(language)}${words.slice(1)} ${failures}`;
  return { title: title.trim(), detail: toolNames(others) || undefined };
};
