import { describe, expect, it } from 'vitest';
import { toolIconName } from './toolIcon';

describe('toolIconName', () => {
  it.each([
    ['web_search', 'Globe'],
    ['duckduckgo_search', 'Search'],
    ['run_python_code', 'Code'],
    ['run_shell_command', 'Terminal'],
    ['read_file', 'File'],
    ['send_email', 'Mail'],
    ['list_calendar_events', 'Clock'],
    ['browser', 'Monitor'],
    ['matrix_message', 'Message'],
    ['generate_image', 'Photo'],
    ['save_memory', 'Bulb'],
  ])('gives %s the %s icon', (name, icon) => {
    expect(toolIconName(name)).toBe(icon);
  });

  it('reads whole words, so update_file is a file and not a date', () => {
    expect(toolIconName('update_file')).toBe('File');
  });

  it('reads camelCase and dotted names as words', () => {
    expect(toolIconName('readFile')).toBe('File');
    expect(toolIconName('gmail.send')).toBe('Mail');
  });

  it('gives any other tool the terminal icon', () => {
    expect(toolIconName('fetch_invoices')).toBe('Terminal');
  });
});
