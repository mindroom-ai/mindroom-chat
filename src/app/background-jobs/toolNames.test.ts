import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { translateFromEn } from '../../test/utils/i18n';
import { plainToolName } from './toolNames';

const t = translateFromEn as unknown as TFunction;
const name = (tool: string) => plainToolName(tool, t);

describe('plainToolName', () => {
  it('names a known tool in plain words, from its tool alone', () => {
    expect(name('read_file')).toBe('Reading a file');
    expect(name('save_file')).toBe('Writing a file');
    expect(name('replace_file_chunk')).toBe('Editing a file');
    expect(name('grep')).toBe('Searching files');
    expect(name('ls')).toBe('Looking through files');
    ['run_shell_command', 'shell', 'run_shell'].forEach((tool) =>
      expect(name(tool)).toBe('Running a command')
    );
    expect(name('read_url')).toBe('Opening a web page');
    expect(name('web_search')).toBe('Searching the web');
    expect(name('run_subagent')).toBe('Asking a helper');
    expect(name('search_memories')).toBe('Checking memory');
    expect(name('add_memory')).toBe('Updating memory');
    expect(name('matrix_message')).toBe('Using Matrix messages');
    expect(name('schedule')).toBe('Scheduling a task');
    expect(name('list_schedules')).toBe('Checking the schedule');
    expect(name('cancel_schedule')).toBe('Updating the schedule');
  });

  it('names every browser tool the browser', () => {
    ['browser', 'browser_control', 'browser_navigate'].forEach((tool) =>
      expect(name(tool)).toBe('Using the browser')
    );
  });

  it('says "Using" any other tool, its name in words and its direction controls shown', () => {
    expect(name('run_tests')).toBe('Using run tests');
    expect(name('mcp__github_create_issue')).toBe('Using mcp github create issue');
    expect(name('my\u202Etool')).toBe('Using my<U+202E>tool');
  });
});
