import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import type { LiveDocs } from '../matrix/protocol/liveFrame';
import type { SubagentMeta, SubagentStatus } from '../matrix/protocol/subagentFrame';
import type { ToolTraceEvent } from '../matrix/protocol/toolTrace';
import { translateFromEn } from '../../test/utils/i18n';
import { lastWrittenLine, runStepText, toolArg, toolStep } from './runStep';

const t = translateFromEn as unknown as TFunction;

const step = (tool: string, preview?: string) =>
  toolStep({ tool, ...(preview === undefined ? {} : { preview }) }, t);

const meta = (status: SubagentStatus): SubagentMeta => ({
  agent: 'researcher',
  subagent: 'researcher-1',
  caller: 'lead',
  root: 'lead',
  parent: null,
  threadId: '$thread',
  source: 'delegate',
  status,
  startedAt: 100,
  endedAt: status === 'running' || status === 'awaiting_approval' ? null : 160,
});

const docs = (md: string, tools: ToolTraceEvent[] = []): LiveDocs => ({
  md,
  reasoning: '',
  tools,
  status: 'streaming',
  activity: '',
  segments: [],
});

const started = (tool: string, args?: string): ToolTraceEvent => ({
  type: 'tool_call_started',
  tool_name: tool,
  ...(args === undefined ? {} : { args_preview: args }),
});

describe('toolArg', () => {
  it('reads a key at the start or after a comma, its value up to the next key', () => {
    const preview = 'path=notes/2026-11-16.md, offset=10, limit=40';
    expect(toolArg(preview, 'path')).toBe('notes/2026-11-16.md');
    expect(toolArg(preview, 'offset')).toBe('10');
    expect(toolArg(preview, 'limit')).toBe('40');
    expect(toolArg(preview, 'pattern')).toBeUndefined();
    expect(toolArg(undefined, 'path')).toBeUndefined();
  });

  it('keeps the commas inside a value, and takes no key from inside one', () => {
    const preview = 'query=agenda, budget, and action items, path=notes, glob=*.md';
    expect(toolArg(preview, 'query')).toBe('agenda, budget, and action items');
    expect(toolArg('content=see file_path=x.md, path=notes/a.md', 'file_path')).toBeUndefined();
    expect(toolArg('content=see file_path=x.md, path=notes/a.md', 'path')).toBe('notes/a.md');
  });

  it('drops quotes around a value and reads an empty one as none', () => {
    expect(toolArg('query="weekly summary"', 'query')).toBe('weekly summary');
    expect(toolArg('query=, path=notes', 'query')).toBeUndefined();
  });
});

describe('toolStep', () => {
  it('names the file a call reads, writes or edits, without its folders', () => {
    expect(step('read_file', 'path=notes/2026-11-16.md, offset=1')).toBe('Reading 2026-11-16.md');
    expect(step('read_file_chunk', 'file_name=agenda.md')).toBe('Reading agenda.md');
    expect(step('write_file', 'path=notes/summary.md, content=# Week 47, done')).toBe(
      'Writing summary.md'
    );
    expect(step('save_file', 'file_name=draft.txt')).toBe('Writing draft.txt');
    expect(step('edit_file', 'path=notes\\plan.md, old_text=a, new_text=b')).toBe(
      'Editing plan.md'
    );
    expect(step('replace_file_chunk', 'file_path=/srv/notes/todo.md')).toBe('Editing todo.md');
  });

  it('says only what a file call does when it names no file', () => {
    expect(step('read_file')).toBe('Reading a file');
    expect(step('write_file', 'content=hello')).toBe('Writing a file');
    expect(step('edit_file', 'old_text=a')).toBe('Editing a file');
  });

  it('says what a file search looks for, cut short past forty characters', () => {
    expect(step('grep', 'pattern=action items, path=notes')).toBe(
      'Searching files for “action items”'
    );
    expect(step('search_content', 'query=budget')).toBe('Searching files for “budget”');
    expect(step('search_files')).toBe('Searching files');
    expect(step('grep', 'pattern=decisions about the shared calendar for the spring offsite')).toBe(
      'Searching files for “decisions about the shared calendar for…”'
    );
    // The cut counts whole characters, so an emoji at the boundary stays whole.
    expect(step('grep', `pattern=${'a'.repeat(38)}🎉🎉🎉`)).toBe(
      `Searching files for “${'a'.repeat(38)}🎉…”`
    );
    expect(step('grep', `pattern=${'🎉'.repeat(40)}`)).toBe(
      `Searching files for “${'🎉'.repeat(40)}”`
    );
  });

  it('looks through files, runs a command, asks a helper and uses the browser', () => {
    ['find_files', 'ls', 'list_files'].forEach((tool) =>
      expect(step(tool, 'path=notes')).toBe('Looking through files')
    );
    ['run_shell_command', 'shell', 'run_shell'].forEach((tool) =>
      expect(step(tool, 'args=ls notes')).toBe('Running a command')
    );
    ['run_subagent', 'continue_subagent'].forEach((tool) =>
      expect(step(tool, 'task=Summarize the notes')).toBe('Asking a helper')
    );
    ['browser', 'browser_control', 'browser_navigate'].forEach((tool) =>
      expect(step(tool)).toBe('Using the browser')
    );
  });

  it('names the site a call opens, else opens a web page', () => {
    expect(step('read_url', 'url=https://www.example.org/notes?week=47')).toBe(
      'Opening example.org'
    );
    expect(step('read', 'url=docs.example.com/guide')).toBe('Opening docs.example.com');
    expect(step('crawl', 'url=https://example.net, max_depth=2')).toBe('Opening example.net');
    expect(step('scrape_webpage')).toBe('Opening a web page');
    expect(step('read_url', 'url=not a web address')).toBe('Opening a web page');
  });

  it('says what a web search looks for', () => {
    [
      'search_google',
      'search_news',
      'google_search',
      'web_search',
      'duckduckgo_search',
      'search_web',
    ].forEach((tool) =>
      expect(step(tool, 'query=meeting notes template, max_results=5')).toBe(
        'Searching the web for “meeting notes template”'
      )
    );
    expect(step('search_news')).toBe('Searching the web');
  });

  it("words MindRoom's memory, message and scheduler tools", () => {
    expect(step('search_memories', 'query=offsite')).toBe('Checking memory');
    expect(step('get_memory')).toBe('Checking memory');
    expect(step('add_memory', 'memory=prefers mornings')).toBe('Updating memory');
    expect(step('delete_memory')).toBe('Updating memory');
    expect(step('matrix_message', 'action=send, message=Done')).toBe('Sending a message');
    expect(step('matrix_message', 'action=read, limit=20')).toBe('Reading messages');
    expect(step('matrix_message', 'action=edit, event_id=$e, message=Fixed')).toBe(
      'Editing a message'
    );
    expect(step('matrix_message', 'action=react, event_id=$e, message=👍')).toBe(
      'Reacting to a message'
    );
    // Another action, or none in a preview that may be cut before it, says no action.
    expect(step('matrix_message', 'message=Done')).toBe('Using Matrix messages');
    expect(step('matrix_message', 'action=forward')).toBe('Using Matrix messages');
    expect(step('matrix_message', 'action=constructor')).toBe('Using Matrix messages');
    expect(step('schedule', 'when=tomorrow 9am')).toBe('Scheduling a task');
    expect(step('list_schedules')).toBe('Checking the schedule');
    expect(step('cancel_schedule', 'task_id=t1')).toBe('Updating the schedule');
  });

  it('uses any other tool by its name in words', () => {
    expect(step('set_thread_summary', 'summary=Week 47')).toBe('Using set thread summary');
    expect(step('calculator')).toBe('Using calculator');
  });

  it('writes out the direction controls of the names a call sent', () => {
    expect(step('read_file', 'path=notes/report\u202Edm.exe')).toBe('Reading report<U+202E>dm.exe');
    expect(step('grep', 'pattern=a\u2066b')).toBe('Searching files for “a<U+2066>b”');
    expect(step('my\u202Etool')).toBe('Using my<U+202E>tool');
  });
});

describe('lastWrittenLine', () => {
  it('takes the last line with words, as plain text', () => {
    expect(
      lastWrittenLine('First I read the notes.\n\n## **Next:** the [agenda](https://x.y)\n')
    ).toBe('Next: the agenda');
    expect(lastWrittenLine('- *Done* with `notes/2026-11-16.md`')).toBe(
      'Done with notes/2026-11-16.md'
    );
    // Underscores are names far more often than emphasis.
    expect(lastWrittenLine('Reading `__init__.py` and my_notes_file')).toBe(
      'Reading __init__.py and my_notes_file'
    );
    expect(lastWrittenLine('> Quoted line')).toBe('Quoted line');
    // A line past the bound is cut without the half of an emoji.
    expect(lastWrittenLine(`${'a'.repeat(1999)}🎉 more`)).toBe('a'.repeat(1999));
  });

  it('passes over code blocks, rules, table dividers and tool markers', () => {
    expect(lastWrittenLine('Comparing the weeks.\n```\nconst week = 47;\n```\n---\n')).toBe(
      'Comparing the weeks.'
    );
    expect(lastWrittenLine('| Week | Notes |\n| --- | --- |\n🔧 `read_file` [1] ⏳')).toBe(
      'Week · Notes'
    );
  });

  it('closes a code block only on a fence of its own kind and length', () => {
    // A shorter fence inside a longer one is code; so is a tilde fence inside backticks.
    expect(lastWrittenLine('Before.\n````md\n```\nInside.\n```\n````\nAfter the example.\n')).toBe(
      'After the example.'
    );
    expect(lastWrittenLine('Before.\n````\n```\nStill code.\n')).toBe('Before.');
    expect(lastWrittenLine('Before.\n```\n~~~\nStill code.\n')).toBe('Before.');
  });

  it('is nothing before the run wrote a word', () => {
    expect(lastWrittenLine('')).toBeUndefined();
    expect(lastWrittenLine('\n\n```\n')).toBeUndefined();
  });
});

describe('runStepText', () => {
  it('says the call a running run makes, as a step under way', () => {
    const run = {
      meta: meta('running'),
      docs: docs('', [started('read_file', 'path=notes/a.md')]),
    };
    expect(runStepText(run, t)).toBe('Reading a.md…');
  });

  it("asks for the reader's OK for the call that waits", () => {
    const run = {
      meta: meta('awaiting_approval'),
      docs: docs('', [started('run_shell_command', 'args=rm notes/old.md')]),
    };
    expect(runStepText(run, t)).toBe('Waiting for your OK: Running a command');
  });

  it('says what a running run without a call last wrote, else that it thinks', () => {
    const wrote = {
      meta: meta('running'),
      docs: docs('I read the notes.\n\nNow the **summary**.'),
    };
    expect(runStepText(wrote, t)).toBe('Now the summary.');
    // What it wrote shows its direction controls.
    expect(runStepText({ meta: meta('running'), docs: docs('Saved \u202Eagenda') }, t)).toBe(
      'Saved <U+202E>agenda'
    );
    // A completed call is no call it makes now.
    const thinking = {
      meta: meta('running'),
      docs: docs('', [{ type: 'tool_call_completed', tool_name: 'read_file' }]),
    };
    expect(runStepText(thinking, t)).toBe('Thinking…');
  });

  it('says nothing for a run that is not at it, whose line stays as it was', () => {
    (['completed', 'failed', 'cancelled', 'paused'] as const).forEach((status) =>
      expect(runStepText({ meta: meta(status), docs: docs('Done.') }, t)).toBeUndefined()
    );
  });
});
