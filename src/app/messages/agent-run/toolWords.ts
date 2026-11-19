import type { TFunction } from 'i18next';
import { ArgumentField, toToolArgumentFields } from '../../approvals/argumentFields';
import { toolNames } from './toolCallStatus';

/**
 * The most used tools, which a run's line and its rows name in words, by the words their calls
 * share; `keys` are the arguments a row shows beside its words, the first one the call has.
 * Other tools keep their names.
 */
const TOOL_WORDS = {
  read: { tools: ['read_file', 'read_file_chunk'], keys: ['path', 'file_name'] },
  write: { tools: ['write_file', 'save_file'], keys: ['path', 'file_name'] },
  edit: { tools: ['edit_file', 'replace_file_chunk'], keys: ['path', 'file_name'] },
  command: { tools: ['run_shell_command', 'bash'], keys: ['command', 'args'] },
  searchFiles: {
    tools: ['grep', 'find_files', 'search_files', 'search_content'],
    keys: ['pattern', 'query'],
  },
  searchWeb: {
    tools: ['web_search', 'search_web', 'duckduckgo_search', 'google_search'],
    keys: ['query'],
  },
  readPage: { tools: ['read_url', 'scrape_webpage'], keys: ['url'] },
  schedule: { tools: ['schedule'], keys: ['request'] },
  listFiles: { tools: ['list_files', 'ls'], keys: ['directory', 'path'] },
  attachments: { tools: ['list_attachments'], keys: ['target'] },
  room: { tools: ['matrix_room'], keys: ['action'] },
} satisfies Record<string, { tools: string[]; keys: string[] }>;

type ToolWordGroup = keyof typeof TOOL_WORDS;

// Bookkeeping: a finished call folds under its run's other calls, and the line names it only
// when the run has no other words.
const TOOL_STEPS: readonly ToolWordGroup[] = ['listFiles', 'attachments', 'room'];

const groupOf = (toolName: string): ToolWordGroup | undefined =>
  (Object.keys(TOOL_WORDS) as ToolWordGroup[]).find((group) =>
    TOOL_WORDS[group].tools.includes(toolName)
  );

export const isToolStep = (toolName: string): boolean => {
  const group = groupOf(toolName);
  return group !== undefined && TOOL_STEPS.includes(group);
};

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

export type ToolRowWords = {
  label: string;
  /** The argument the call acts on, on one line; `rest` are its other arguments. */
  target?: string;
  rest?: ArgumentField[];
};

/** A row's words for its call ("Read file" and the file), or undefined for a tool without. */
export const toolRowWords = (
  t: TFunction,
  toolName: string,
  argsPreview?: string
): ToolRowWords | undefined => {
  const group = groupOf(toolName);
  if (!group) return undefined;
  const label = t(`mindroomUi.messages.mindroomHtmlBlocks.toolWords.${group}.row`);
  const parsed = argsPreview ? toToolArgumentFields(argsPreview) : undefined;
  if (!parsed || !('fields' in parsed)) return { label };
  const { keys } = TOOL_WORDS[group];
  const target = keys
    .map((key) => parsed.fields.find((field) => field.key === key))
    .find((field) => field && field.value.kind !== 'nested');
  if (!target || target.value.kind === 'nested') return { label };
  return {
    label,
    target: oneLine(target.value.text),
    rest: parsed.fields.filter((field) => field !== target),
  };
};

const capitalize = (text: string, language: string) =>
  text.charAt(0).toLocaleUpperCase(language) + text.slice(1);

/** The phrase for a run's finished bookkeeping calls ("listed files"), in call order. */
export const describeToolSteps = (
  t: TFunction,
  language: string,
  calls: readonly { toolName: string }[]
): string =>
  new Intl.ListFormat(language, { style: 'short', type: 'unit' }).format(
    [...new Set(calls.flatMap(({ toolName }) => groupOf(toolName) ?? []))].map((group) =>
      t(`mindroomUi.messages.mindroomHtmlBlocks.toolWords.${group}.title`, { count: 1 })
    )
  );

/**
 * A finished run's line in words ("Read 3 files, ran a command"), and the names of the tools
 * without words as its detail; undefined when no call has words, so the line keeps its count.
 */
export const describeToolRun = (
  t: TFunction,
  language: string,
  calls: readonly { toolName: string }[]
): { title: string; detail?: string } | undefined => {
  const groups = new Map<ToolWordGroup, number>();
  const others = calls.filter(({ toolName }) => {
    const group = groupOf(toolName);
    if (group) groups.set(group, (groups.get(group) ?? 0) + 1);
    return !group;
  });
  if (groups.size === 0) return undefined;
  const lead = [...groups.keys()].some((group) => !TOOL_STEPS.includes(group));
  const phrases = [...groups]
    .filter(([group]) => !lead || !TOOL_STEPS.includes(group))
    .map(([group, count]) =>
      t(`mindroomUi.messages.mindroomHtmlBlocks.toolWords.${group}.title`, { count })
    );
  if (others.length > 0) {
    phrases.push(
      t('mindroomUi.messages.mindroomHtmlBlocks.toolWords.moreTools', { count: others.length })
    );
  }
  const title = new Intl.ListFormat(language, { style: 'short', type: 'unit' }).format(phrases);
  return {
    title: capitalize(title, language),
    detail: others.length > 0 ? toolNames(others) : undefined,
  };
};
