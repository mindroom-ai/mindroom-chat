import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import { describeToolRun, isToolStep, toolRowWords } from './toolWords';

const t = i18next.t.bind(i18next);
const calls = (...names: string[]) => names.map((toolName) => ({ toolName }));

describe('describeToolRun', () => {
  it('says what a run did in words, its bookkeeping left out', () => {
    expect(
      describeToolRun(
        t,
        'en',
        calls('read_file', 'run_shell_command', 'read_file', 'list_files', 'duckduckgo_search')
      )
    ).toEqual({ title: 'Read 2 files, ran 1 command, and searched the web', detail: undefined });
  });

  it('counts the tools without words and names them as its detail', () => {
    expect(describeToolRun(t, 'en', calls('send_email', 'read_file', 'send_email'))).toEqual({
      title: 'Read 1 file and used 2 more tools',
      detail: 'send_email ×2',
    });
  });

  it('names bookkeeping when the run did nothing else', () => {
    expect(describeToolRun(t, 'en', calls('list_files', 'matrix_room'))?.title).toBe(
      'Listed files and looked up the room'
    );
  });

  it('says how many calls failed', () => {
    expect(describeToolRun(t, 'en', calls('bash', 'bash'), 1)?.title).toBe(
      'Ran 2 commands · 1 failed'
    );
  });

  it('has no words for a run of tools it does not know', () => {
    expect(describeToolRun(t, 'en', calls('send_email', 'share_app'))).toBeUndefined();
  });

  it("joins the phrases as the language's list does", () => {
    // English phrases, so only the separator comes from the language.
    expect(describeToolRun(t, 'ja', calls('read_file', 'web_search', 'grep'))?.title).toBe(
      'Read 1 file、searched the web、searched files'
    );
  });
});

describe('toolRowWords', () => {
  it('leads with what the call acts on, and keeps its other arguments', () => {
    const words = toolRowWords(t, 'read_file', 'path=notes/plan.md, offset=10');
    expect(words?.label).toBe('Read file');
    expect(words?.target).toBe('notes/plan.md');
    expect(words?.rest?.map(({ key }) => key)).toEqual(['offset']);
  });

  it('puts a long argument on one line', () => {
    expect(toolRowWords(t, 'bash', 'command=cd /tmp &&\n  ls -la')?.target).toBe(
      'cd /tmp && ls -la'
    );
  });

  it('keeps the arguments it cannot label', () => {
    expect(toolRowWords(t, 'web_search', 'weekly planning notes')).toEqual({
      label: 'Searched the web',
    });
  });

  it('has no words for a tool it does not know', () => {
    expect(toolRowWords(t, 'send_email', 'to=alice@example.org')).toBeUndefined();
  });
});

it('folds only bookkeeping, and names it alone', () => {
  expect(['list_files', 'ls', 'list_attachments', 'read_file'].map(isToolStep)).toEqual([
    true,
    true,
    true,
    false,
  ]);
  expect(describeToolRun(t, 'en', calls('list_files', 'ls', 'list_attachments'))?.title).toBe(
    'Listed files and checked attachments'
  );
});
