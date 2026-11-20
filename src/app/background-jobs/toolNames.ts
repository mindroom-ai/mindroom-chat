import type { TFunction } from 'i18next';
import { revealDirectionControls } from '../ui/directional';

/** A tool job's name in plain words, under `mindroomUi.backgroundJobs.toolNames`. */
type ToolNameKey =
  | 'readingFile'
  | 'writingFile'
  | 'editingFile'
  | 'searchingFiles'
  | 'lookingThroughFiles'
  | 'runningCommand'
  | 'openingPage'
  | 'searchingWeb'
  | 'askingHelper'
  | 'usingBrowser'
  | 'checkingMemory'
  | 'updatingMemory'
  | 'usingMessages'
  | 'scheduling'
  | 'checkingSchedule'
  | 'updatingSchedule';

/** Each name and the tools (MindRoom's own and its bundled toolkits') that it stands for. */
const TOOL_NAME_TABLE: readonly (readonly [ToolNameKey, readonly string[]])[] = [
  ['readingFile', ['read_file', 'read_file_chunk']],
  ['writingFile', ['write_file', 'save_file']],
  ['editingFile', ['edit_file', 'replace_file_chunk']],
  ['searchingFiles', ['grep', 'search_content', 'search_files']],
  ['lookingThroughFiles', ['find_files', 'ls', 'list_files']],
  ['runningCommand', ['run_shell_command', 'shell', 'run_shell']],
  ['openingPage', ['read_url', 'read', 'crawl', 'scrape_webpage']],
  [
    'searchingWeb',
    [
      'search_google',
      'search_news',
      'google_search',
      'web_search',
      'duckduckgo_search',
      'search_web',
    ],
  ],
  ['askingHelper', ['run_subagent', 'continue_subagent']],
  ['checkingMemory', ['search_memories', 'list_memories', 'get_memory']],
  ['updatingMemory', ['add_memory', 'update_memory', 'delete_memory']],
  ['usingMessages', ['matrix_message']],
  ['scheduling', ['schedule', 'schedule_tool_call']],
  ['checkingSchedule', ['list_schedules']],
  ['updatingSchedule', ['edit_schedule', 'cancel_schedule']],
];

const TOOL_NAMES: ReadonlyMap<string, ToolNameKey> = new Map(
  TOOL_NAME_TABLE.flatMap(([key, tools]) => tools.map((tool) => [tool, key] as const))
);

/**
 * A tool job's name in plain words, from its tool alone: its row of the table, every browser tool
 * (`browser`, `browser_control`, …) the browser, else "Using" its name in words, its direction
 * controls written out so none can reorder the phrase.
 */
export const plainToolName = (tool: string, t: TFunction): string => {
  const key = TOOL_NAMES.get(tool) ?? (tool.startsWith('browser') ? 'usingBrowser' : undefined);
  if (key) return t(`mindroomUi.backgroundJobs.toolNames.${key}`);
  const name = revealDirectionControls(tool.replace(/_+/g, ' ').trim());
  return t('mindroomUi.backgroundJobs.toolNames.using', { tool: name });
};
