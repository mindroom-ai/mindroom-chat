import type { Icons } from 'folds';

export type ToolIconName = keyof typeof Icons;

// The first rule with a word of the tool's name picks its icon, so `send_email` is mail before
// it is a message, and `web_search` is the web before it is a search.
const RULES: readonly [ToolIconName, readonly string[]][] = [
  ['Mail', ['mail', 'email', 'gmail', 'inbox']],
  ['Clock', ['calendar', 'event', 'events', 'schedule', 'remind', 'reminder', 'time', 'date']],
  ['Monitor', ['browser', 'screenshot', 'desktop', 'computer', 'screen']],
  ['Globe', ['web', 'website', 'url', 'http', 'crawl', 'scrape', 'navigate', 'wikipedia']],
  ['Search', ['search', 'find', 'lookup', 'query']],
  ['Bulb', ['memory', 'memories', 'remember', 'knowledge', 'note', 'notes']],
  ['Code', ['python', 'code', 'script', 'javascript', 'sql']],
  ['Terminal', ['shell', 'command', 'bash', 'terminal', 'exec']],
  ['File', ['file', 'files', 'read', 'write', 'save', 'document', 'doc', 'docs', 'pdf', 'csv']],
  ['Photo', ['image', 'images', 'photo', 'photos', 'picture', 'video', 'draw']],
  ['Message', ['message', 'messages', 'matrix', 'chat', 'slack', 'discord', 'telegram', 'send']],
];

/** The icon for a tool, from the words of its name; a tool none of them describes gets a terminal. */
export const toolIconName = (toolName: string): ToolIconName => {
  const words = new Set(
    toolName
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
  );
  return RULES.find(([, keywords]) => keywords.some((word) => words.has(word)))?.[0] ?? 'Terminal';
};
