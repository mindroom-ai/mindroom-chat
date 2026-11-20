import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import type { ToolCallState } from './toolCallStatus';
import { describeToolRun, toolRowWords } from './toolWords';

const t = i18next.t.bind(i18next);
const call = (toolName: string, state: ToolCallState = 'done', argsPreview?: string) => ({
  toolName,
  state,
  argsPreview,
});
const done = (...names: string[]) => names.map((name) => call(name));

describe('describeToolRun', () => {
  it('says what a run did in words', () => {
    expect(describeToolRun(t, 'en', done('read_file', 'run_shell_command', 'web_search'))).toEqual({
      title: 'Read a file, ran 1 command, and searched the web',
      detail: '',
      status: '',
    });
  });

  it('counts the reads as times, as a preview cannot tell two files apart', () => {
    const pages = ['path=notes.md, offset=1', 'path=notes.md, offset=200', 'path=plan.md'];
    const calls = pages.map((args) => call('read_file', 'done', args));
    expect(describeToolRun(t, 'en', calls)?.title).toBe('Read files 3 times');
    expect(describeToolRun(t, 'en', done('edit_file', 'write_file', 'edit_file'))?.title).toBe(
      'Edited files 2 times and wrote a file'
    );
  });

  it('counts the tools without words and names them as its detail', () => {
    expect(describeToolRun(t, 'en', done('send_email', 'read_file', 'send_email'))).toMatchObject({
      title: 'Read a file and used 2 more tools',
      detail: 'send_email ×2',
    });
  });

  it('puts only the calls that ran in words, and names and counts the others together', () => {
    const calls = [
      call('read_file'),
      call('schedule', 'failed'),
      call('send_email', 'denied'),
      call('write_file', 'expired'),
    ];
    expect(describeToolRun(t, 'en', calls)).toEqual({
      title: 'Read a file',
      detail: 'schedule, send_email, write_file',
      status: "· 3 didn't complete",
    });
    expect(describeToolRun(t, 'en', [call('read_file'), call('write_file', 'denied')])).toEqual({
      title: 'Read a file',
      detail: 'write_file',
      status: '· 1 denied',
    });
  });

  it('has no words when no call with words ran', () => {
    expect(describeToolRun(t, 'en', done('send_email', 'share_app'))).toBeUndefined();
    expect(describeToolRun(t, 'en', [call('read_file', 'failed')])).toBeUndefined();
  });

  it("joins the phrases as the language's list does", () => {
    // English phrases, so only the separator comes from the language.
    expect(describeToolRun(t, 'ja', done('read_file', 'web_search', 'grep'))?.title).toBe(
      'Read a file、searched the web、searched files'
    );
  });
});

describe('toolRowWords', () => {
  it('names the call without saying how it went, with what it acts on on one line', () => {
    expect(toolRowWords(t, 'write_file', 'path=notes/plan.md, content=Weekly planning')).toEqual({
      label: 'Write file',
      target: 'notes/plan.md',
    });
    expect(toolRowWords(t, 'bash', 'command=cd /tmp &&\n  ls -la')?.target).toBe(
      'cd /tmp && ls -la'
    );
  });

  it('keeps arguments it cannot label out of the target', () => {
    expect(toolRowWords(t, 'web_search', 'weekly planning notes')).toEqual({
      label: 'Search the web',
      target: undefined,
    });
  });

  it('has no words for a tool it does not know, or one whose action changes what it does', () => {
    expect(toolRowWords(t, 'send_email', 'to=alice@example.org')).toBeUndefined();
    expect(toolRowWords(t, 'matrix_room', 'action=threads, room_id=all')).toBeUndefined();
    expect(toolRowWords(t, 'read_file_chunk', 'file_name=notes.md')).toBeUndefined();
    // These return errors as plain results, so a done call may not have listed anything.
    expect(toolRowWords(t, 'ls', 'path=notes')).toBeUndefined();
    expect(describeToolRun(t, 'en', done('list_files'))).toBeUndefined();
  });
});
