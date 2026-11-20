import type { TFunction } from 'i18next';
import type { LiveDocs } from '../matrix/protocol/liveFrame';
import type { SubagentMeta } from '../matrix/protocol/subagentFrame';
import { runLine, type ToolActivity } from './runActivity';

/**
 * A tool call in plain words ("Reading notes.md"), for readers who leave the usage details off:
 * a fixed table from the tool's name, filled from its arguments where it names a file, a query or
 * a page. No model is asked.
 */

/** The step phrases, under `mindroomUi.subagents.step`. */
type StepKey =
  | 'reading'
  | 'readingAny'
  | 'writing'
  | 'writingAny'
  | 'editing'
  | 'editingAny'
  | 'searchingFiles'
  | 'searchingFilesFor'
  | 'lookingThroughFiles'
  | 'runningCommand'
  | 'opening'
  | 'openingPage'
  | 'searchingWeb'
  | 'searchingWebFor'
  | 'askingHelper'
  | 'usingBrowser'
  | 'checkingMemory'
  | 'updatingMemory'
  | 'sendingMessage'
  | 'scheduling'
  | 'checkingSchedule'
  | 'updatingSchedule';

/** What a phrase names from the call's arguments. */
type StepArg = 'file' | 'query' | 'site';

/**
 * A row of the table: the phrase, and when it names something, which argument and the phrase
 * without it (`bare`), for a call that did not send it.
 */
type Step = { key: StepKey } | { key: StepKey; arg: StepArg; bare: StepKey };

const READING: Step = { key: 'reading', arg: 'file', bare: 'readingAny' };
const WRITING: Step = { key: 'writing', arg: 'file', bare: 'writingAny' };
const EDITING: Step = { key: 'editing', arg: 'file', bare: 'editingAny' };
const SEARCHING_FILES: Step = { key: 'searchingFilesFor', arg: 'query', bare: 'searchingFiles' };
const OPENING: Step = { key: 'opening', arg: 'site', bare: 'openingPage' };
const SEARCHING_WEB: Step = { key: 'searchingWebFor', arg: 'query', bare: 'searchingWeb' };

/** Each phrase and the tools (MindRoom's own and its bundled toolkits') that it stands for. */
const STEP_TABLE: readonly (readonly [Step, readonly string[]])[] = [
  [READING, ['read_file', 'read_file_chunk']],
  [WRITING, ['write_file', 'save_file']],
  [EDITING, ['edit_file', 'replace_file_chunk']],
  [SEARCHING_FILES, ['grep', 'search_content', 'search_files']],
  [{ key: 'lookingThroughFiles' }, ['find_files', 'ls', 'list_files']],
  [{ key: 'runningCommand' }, ['run_shell_command', 'shell', 'run_shell']],
  [OPENING, ['read_url', 'read', 'crawl', 'scrape_webpage']],
  [
    SEARCHING_WEB,
    [
      'search_google',
      'search_news',
      'google_search',
      'web_search',
      'duckduckgo_search',
      'search_web',
    ],
  ],
  [{ key: 'askingHelper' }, ['run_subagent', 'continue_subagent']],
  [{ key: 'checkingMemory' }, ['search_memories', 'list_memories', 'get_memory']],
  [{ key: 'updatingMemory' }, ['add_memory', 'update_memory', 'delete_memory']],
  [{ key: 'sendingMessage' }, ['matrix_message']],
  [{ key: 'scheduling' }, ['schedule', 'schedule_tool_call']],
  [{ key: 'checkingSchedule' }, ['list_schedules']],
  [{ key: 'updatingSchedule' }, ['edit_schedule', 'cancel_schedule']],
];

const STEPS: ReadonlyMap<string, Step> = new Map(
  STEP_TABLE.flatMap(([step, tools]) => tools.map((tool) => [tool, step] as const))
);

/** Every browser tool (`browser`, `browser_control`, …) uses the browser. */
const BROWSER: Step = { key: 'usingBrowser' };

/** The arguments each named thing is read from, the first one sent winning. */
const ARG_KEYS: Record<StepArg, readonly string[]> = {
  file: ['path', 'file_path', 'file_name'],
  query: ['pattern', 'query'],
  site: ['url'],
};

/** How long a query may run in a phrase before it is cut. */
const QUERY_CHARS = 40;

/**
 * An argument from a call's preview (`key=value, key=value`, MindRoom's `_format_tool_args`).
 * A value may hold `, ` itself, so a key counts only at the start or after `, `, and its value
 * runs to the next `, <name>=` or the end. Quotes around it are dropped.
 */
export const toolArg = (preview: string | undefined, key: string): string | undefined => {
  if (!preview) return undefined;
  const match = new RegExp(`(?:^|, )${key}=(.*?)(?=, [A-Za-z_][A-Za-z0-9_]*=|$)`).exec(preview);
  const value = match?.[1]
    ?.trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .trim();
  return value || undefined;
};

/** The file's own name, without its folders. */
const baseName = (path: string): string => {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
};

/** The page's host ("example.org"), or nothing for a value that is no web address. */
const hostName = (url: string): string | undefined => {
  try {
    const { hostname } = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
    return hostname.replace(/^www\./, '') || undefined;
  } catch {
    return undefined;
  }
};

const shortQuery = (query: string): string =>
  query.length > QUERY_CHARS ? `${query.slice(0, QUERY_CHARS - 1).trimEnd()}…` : query;

/** The named thing of a phrase, from the call's arguments; none when the call sent none. */
const stepValue = (arg: StepArg, preview: string | undefined): string | undefined => {
  const value = ARG_KEYS[arg].map((key) => toolArg(preview, key)).find(Boolean);
  if (!value) return undefined;
  if (arg === 'file') return baseName(value);
  if (arg === 'site') return hostName(value);
  return shortQuery(value);
};

/** A tool call in plain words: its row of the table, else "Using" its name in words. */
export const toolStep = (activity: ToolActivity, t: TFunction): string => {
  const { tool, preview } = activity;
  const step = STEPS.get(tool) ?? (tool.startsWith('browser') ? BROWSER : undefined);
  if (!step) return t('mindroomUi.subagents.step.using', { tool: tool.replace(/_+/g, ' ').trim() });
  if (!('arg' in step)) return t(`mindroomUi.subagents.step.${step.key}`);
  const value = stepValue(step.arg, preview);
  return value === undefined
    ? t(`mindroomUi.subagents.step.${step.bare}`)
    : t(`mindroomUi.subagents.step.${step.key}`, { [step.arg]: value });
};

/** A Markdown line as plain text: no marks of headings, lists, quotes, emphasis, code or links. */
const plainLine = (line: string): string =>
  line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/^(?:\s*(?:>|#{1,6}\s|[-*+]\s+(?:\[[ xX]\]\s)?|\d+[.)]\s))+/, '')
    .replace(/\|/g, ' ')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=$|[\s).,;:!?])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();

/** A line that says nothing in words: a fence, a rule, a table's divider, a tool call's marker. */
const WORDLESS = /^(?:\s*(?:`{3,}|~{3,}).*|\s*(?:[-*_]\s*){3,}|[\s|:-]+|\s*🔧.*)$/u;

/**
 * The last line of what a run wrote, as plain text, for a run that thinks between calls; nothing
 * before it wrote a word. Lines inside code blocks are passed over.
 */
export const lastWrittenLine = (md: string): string | undefined => {
  let fenced = false;
  let last: string | undefined;
  md.split(/\r?\n/).forEach((line) => {
    if (/^\s*(?:`{3,}|~{3,})/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced || WORDLESS.test(line)) return;
    const text = plainLine(line);
    if (text) last = text;
  });
  return last;
};

/**
 * What a run at work does now, in plain words: the call that waits for the reader's OK, the call
 * it makes, else the last line it wrote, else that it thinks. Nothing for a run that is not at it
 * (paused or ended), whose line stays as it was. Without `written` it never says what it wrote,
 * for a view that is not drawn again as the text grows (the jobs bar).
 */
export const runStepText = (
  run: { meta: SubagentMeta; docs: LiveDocs },
  t: TFunction,
  written = true
): string | undefined => {
  const line = runLine(run, undefined, undefined);
  if (line.kind === 'approval')
    return t('mindroomUi.subagents.step.waitingForOk', { step: toolStep(line.activity, t) });
  if (line.kind === 'now')
    return t('mindroomUi.subagents.step.doing', { step: toolStep(line.activity, t) });
  if (run.meta.status !== 'running') return undefined;
  return (
    (written ? lastWrittenLine(run.docs.md) : undefined) ??
    t('mindroomUi.messages.mindroomThinkingPlaceholder.thinking')
  );
};
