import type { TFunction } from 'i18next';
import { revealDirectionControls } from '../ui/directional';

/** A tool job's name in plain words, under `mindroomUi.backgroundJobs.toolNames`. */
type ToolNameKey = keyof typeof TOOL_NAME_TABLE | 'useBrowser';

/** Each name and the tools (MindRoom's own and its bundled toolkits') that it stands for. */
const TOOL_NAME_TABLE = {
  readFile: ['read_file', 'read_file_chunk'],
  writeFile: ['write_file', 'save_file'],
  editFile: ['edit_file', 'replace_file_chunk'],
  searchFiles: ['grep', 'search_content', 'search_files'],
  browseFiles: ['find_files', 'ls', 'list_files'],
  runCommand: ['run_shell_command', 'shell', 'run_shell'],
  openPage: ['read_url', 'read', 'crawl', 'scrape_webpage'],
  searchWeb: [
    'search_google',
    'search_news',
    'google_search',
    'web_search',
    'duckduckgo_search',
    'search_web',
  ],
  askHelper: ['run_subagent', 'continue_subagent'],
  checkMemory: ['search_memories', 'list_memories', 'get_memory'],
  updateMemory: ['add_memory', 'update_memory', 'delete_memory'],
  useMessages: ['matrix_message'],
  schedule: ['schedule', 'schedule_tool_call'],
  checkSchedule: ['list_schedules'],
  updateSchedule: ['edit_schedule', 'cancel_schedule'],
} as const;

const TOOL_NAMES: ReadonlyMap<string, ToolNameKey> = new Map(
  Object.entries(TOOL_NAME_TABLE).flatMap(([key, tools]) =>
    tools.map((tool) => [tool, key as keyof typeof TOOL_NAME_TABLE] as const)
  )
);

/**
 * A tool job's name in plain words, from its tool alone: its row of the table, every browser tool
 * (`browser`, `browser_control`, …) the browser, else "Use" its name in words, its direction
 * controls written out so none can reorder the phrase.
 */
export const plainToolName = (tool: string, t: TFunction): string => {
  const key = TOOL_NAMES.get(tool) ?? (tool.startsWith('browser') ? 'useBrowser' : undefined);
  if (key) return t(`mindroomUi.backgroundJobs.toolNames.${key}`);
  const name = revealDirectionControls(tool.replace(/_+/g, ' ').trim());
  return t('mindroomUi.backgroundJobs.toolNames.use', { tool: name });
};
