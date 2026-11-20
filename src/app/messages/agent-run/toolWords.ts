import type { TFunction } from 'i18next';
import { toToolArgumentFields } from '../../approvals/argumentFields';
import { toolNames, type ToolCallState } from './toolCallStatus';

/**
 * The most used tools, which a run's line and its rows name in words; `keys` are the arguments a
 * row shows beside its words, the first one the call has. Other tools keep their names.
 */
const TOOL_WORDS = {
  read: { tools: ['read_file'], keys: ['path', 'file_name'] },
  write: { tools: ['write_file', 'save_file'], keys: ['path', 'file_name'] },
  edit: { tools: ['edit_file', 'replace_file_chunk'], keys: ['path', 'file_name'] },
  command: { tools: ['run_shell_command', 'bash'], keys: ['command', 'args'] },
  searchFiles: { tools: ['grep', 'find_files', 'search_files'], keys: ['pattern', 'query'] },
  searchWeb: { tools: ['web_search', 'search_web', 'duckduckgo_search'], keys: ['query'] },
  readPage: { tools: ['read_url', 'scrape_webpage'], keys: ['url'] },
  schedule: { tools: ['schedule'], keys: ['request'] },
  listFiles: { tools: ['list_files', 'ls'], keys: ['directory', 'path'] },
  attachments: { tools: ['list_attachments'], keys: ['target'] },
} satisfies Record<string, { tools: string[]; keys: string[] }>;

type ToolWordGroup = keyof typeof TOOL_WORDS;

// These count what the calls act on (a file read in pages is one file); the others count calls.
const COUNTS_TARGETS: readonly ToolWordGroup[] = ['read', 'write', 'readPage'];

const groupOf = (toolName: string) =>
  (Object.keys(TOOL_WORDS) as ToolWordGroup[]).find((group) =>
    TOOL_WORDS[group].tools.includes(toolName)
  );

/** What a call acts on, from its labeled arguments, on one line. */
const targetOf = (group: ToolWordGroup, argsPreview?: string) => {
  const parsed = toToolArgumentFields(argsPreview ?? '');
  const fields = 'fields' in parsed ? parsed.fields : [];
  const value = TOOL_WORDS[group].keys
    .map((key) => fields.find((field) => field.key === key)?.value)
    .find(Boolean);
  return value && value.kind !== 'nested' ? value.text.replace(/\s+/g, ' ').trim() : undefined;
};

/**
 * A row's words for its call ("Read file", which claims no outcome: the row's icon says it), and
 * what it acts on; undefined for a tool without words.
 */
export const toolRowWords = (t: TFunction, toolName: string, argsPreview?: string) => {
  const group = groupOf(toolName);
  if (!group) return undefined;
  const label = t(`mindroomUi.messages.mindroomHtmlBlocks.toolWords.${group}.row`);
  return { label, target: targetOf(group, argsPreview) };
};

// What a run line says after its words for the calls that did not run, in this order.
const STATUS = {
  failed: 'mindroomUi.messages.mindroomHtmlBlocks.toolCallsAlsoFailed',
  denied: 'mindroomUi.messages.mindroomHtmlBlocks.toolWords.denied',
  expired: 'mindroomUi.messages.mindroomHtmlBlocks.toolWords.expired',
} as const;

type RunCall = { toolName: string; argsPreview?: string; state: ToolCallState };

/**
 * A finished run's line in words for the calls that ran ("Read 3 files"), the names of the tools
 * without words or that did not run as its detail, and how many did not run as its status
 * ("· 1 didn't complete · 1 denied"); undefined when no call with words ran.
 */
export const describeToolRun = (t: TFunction, language: string, calls: readonly RunCall[]) => {
  const groups = new Map<ToolWordGroup, Set<string | number>>();
  calls.forEach(({ toolName, argsPreview, state }, index) => {
    const group = groupOf(toolName);
    if (!group || state !== 'done') return;
    const target = COUNTS_TARGETS.includes(group) ? targetOf(group, argsPreview) : undefined;
    groups.set(group, (groups.get(group) ?? new Set()).add(target ?? index));
  });
  if (groups.size === 0) return undefined;
  const phrases = [...groups].map(([group, { size }]) =>
    t(`mindroomUi.messages.mindroomHtmlBlocks.toolWords.${group}.title`, { count: size })
  );
  const count = calls.filter((call) => !groupOf(call.toolName) && call.state === 'done').length;
  if (count)
    phrases.push(t('mindroomUi.messages.mindroomHtmlBlocks.toolWords.moreTools', { count }));
  const words = new Intl.ListFormat(language).format(phrases);
  const status = (Object.keys(STATUS) as (keyof typeof STATUS)[]).flatMap((state) => {
    const count = calls.filter((call) => call.state === state).length;
    return count ? [t(STATUS[state], { count, failed: count })] : [];
  });
  return {
    title: `${words.charAt(0).toLocaleUpperCase(language)}${words.slice(1)}`,
    detail: toolNames(calls.filter((call) => !groupOf(call.toolName) || call.state !== 'done')),
    status: status.join(' '),
  };
};
