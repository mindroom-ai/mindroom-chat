import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { translateFromEn } from '../../test/utils/i18n';
import { plainToolName } from './toolNames';

const t = translateFromEn as unknown as TFunction;
const name = (tool: string) => plainToolName(tool, t);

describe('plainToolName', () => {
  it('names a known tool in plain words, from its tool alone', () => {
    expect(name('read_file')).toBe('Read a file');
    expect(name('save_file')).toBe('Write a file');
    expect(name('replace_file_chunk')).toBe('Edit a file');
    expect(name('grep')).toBe('Search files');
    expect(name('ls')).toBe('Look through files');
    ['run_shell_command', 'shell', 'run_shell'].forEach((tool) =>
      expect(name(tool)).toBe('Run a command')
    );
    expect(name('read_url')).toBe('Open a web page');
    expect(name('web_search')).toBe('Search the web');
    expect(name('search_memories')).toBe('Check memory');
    expect(name('add_memory')).toBe('Update memory');
    expect(name('delete_memory')).toBe('Delete a memory');
    expect(name('matrix_message')).toBe('Use Matrix messages');
    expect(name('schedule')).toBe('Schedule a task');
    expect(name('list_schedules')).toBe('Check the schedule');
    expect(name('edit_schedule')).toBe('Update the schedule');
    expect(name('cancel_schedule')).toBe('Cancel a scheduled task');
  });

  it('names every browser tool the browser', () => {
    ['browser', 'browser_control', 'browser_navigate'].forEach((tool) =>
      expect(name(tool)).toBe('Use the browser')
    );
  });

  it('says "Use" any other tool, its name in words and its direction controls shown', () => {
    expect(name('run_tests')).toBe('Use run tests');
    expect(name('mcp__github_create_issue')).toBe('Use mcp github create issue');
    expect(name('my\u202Etool')).toBe('Use my<U+202E>tool');
  });
});
