import { describe, expect, it } from 'vitest';
import { resolveToolCallStates, summarizeToolCalls } from './toolCallStatus';

const call = (toolName: string, pending = false) => ({ toolName, pending });

describe('resolveToolCallStates', () => {
  it('reads each call from its approval card, matching repeated tools in order', () => {
    expect(
      resolveToolCallStates(
        [call('send_email', true), call('send_message', true), call('send_message', true)],
        [
          { toolName: 'send_message', status: 'denied' },
          { toolName: 'send_email', status: 'pending' },
          { toolName: 'send_message', status: 'pending' },
        ]
      )
    ).toEqual(['waiting', 'denied', 'waiting']);
  });

  it('falls back to the trace when a call needed no approval', () => {
    expect(resolveToolCallStates([call('web_search'), call('read_file', true)], [])).toEqual([
      'done',
      'running',
    ]);
  });

  it('treats a denied or expired call as not run even though the trace completed it', () => {
    expect(
      resolveToolCallStates(
        [call('run_shell_command'), call('write_file', true)],
        [
          { toolName: 'run_shell_command', status: 'denied' },
          { toolName: 'write_file', status: 'expired' },
        ]
      )
    ).toEqual(['denied', 'expired']);
  });
});

describe('resolveToolCallStates with call IDs', () => {
  const named = (toolName: string, toolCallId?: string) => ({
    toolName,
    pending: false,
    toolCallId,
  });
  const denied = (toolCallId: string | null) => ({
    toolName: 'shell',
    status: 'denied' as const,
    toolCallId,
  });

  it('gives a card to the call it names, before any call of its tool', () => {
    expect(
      resolveToolCallStates([named('shell', 'a'), named('shell', 'b')], [denied('b')])
    ).toEqual(['done', 'denied']);
  });

  it('never gives a card that names a call to a call that names another', () => {
    expect(
      resolveToolCallStates([named('shell', 'a'), named('shell', 'b')], [denied('c')])
    ).toEqual(['done', 'done']);
  });

  it('gives a card that names a call by its tool to a call from before call IDs', () => {
    expect(resolveToolCallStates([named('shell'), named('shell')], [denied('b')])).toEqual([
      'denied',
      'done',
    ]);
  });

  it('gives a card that names no call to the first call of its tool that no card named', () => {
    expect(
      resolveToolCallStates(
        [named('shell', 'a'), named('shell', 'b')],
        [denied(null), { ...denied('a'), status: 'expired' }]
      )
    ).toEqual(['expired', 'denied']);
  });

  it('gives a card to the call of its ID and tool, an ID that a reply may reuse', () => {
    expect(
      resolveToolCallStates([named('read_file', 'c1'), named('shell', 'c1')], [denied('c1')])
    ).toEqual(['done', 'denied']);
  });

  it('gives the cards of jobs first, then a job without one the card that names its call', () => {
    const job = (jobId: string) => ({ jobId, status: 'running' });
    expect(
      resolveToolCallStates(
        [
          named('shell', 'a'),
          { ...named('shell', 'b'), job: job('j2') },
          { ...named('shell', 'c'), job: job('j3') },
        ],
        [
          { ...denied('a'), jobId: 'j2' },
          { ...denied('c'), status: 'expired' },
        ]
      )
    ).toEqual(['done', 'denied', 'expired']);
  });

  it('gives cards only to the calls they name without byName', () => {
    expect(
      resolveToolCallStates(
        [named('shell', 'a'), named('shell')],
        [denied(null), denied('a')],
        false
      )
    ).toEqual(['denied', 'done']);
  });
});

describe('resolveToolCallStates with background jobs', () => {
  const job = (jobId: string) => ({ jobId, status: 'awaiting_approval' });

  it('keeps a call waiting while its card does, though the reply went on and completed it', () => {
    expect(
      resolveToolCallStates(
        [{ toolName: 'run_shell_command', pending: false }],
        [{ toolName: 'run_shell_command', status: 'pending' }]
      )
    ).toEqual(['waiting']);
  });

  it("gives a call the card of the job its handle names, whatever the cards' order", () => {
    expect(
      resolveToolCallStates(
        [
          { toolName: 'run_shell_command', pending: false },
          { toolName: 'run_shell_command', pending: false, job: job('b') },
        ],
        [
          { toolName: 'run_shell_command', status: 'denied', jobId: 'b' },
          { toolName: 'run_shell_command', status: 'approved', jobId: 'a' },
        ]
      )
    ).toEqual(['done', 'denied']);
  });

  it('reads a detached call from its handle until its card is known', () => {
    expect(
      resolveToolCallStates(
        [{ toolName: 'run_shell_command', pending: false, job: job('a') }],
        [{ toolName: 'run_shell_command', status: 'denied', jobId: 'c' }]
      )
    ).toEqual(['waiting']);
  });
});

describe('summarizeToolCalls', () => {
  it('says what the group is doing, counting calls and repeated tools', () => {
    expect(
      summarizeToolCalls(
        [call('send_email'), call('send_message'), call('send_message')],
        ['waiting', 'waiting', 'waiting']
      )
    ).toEqual({ state: 'waiting', count: 3, names: 'send_email, send_message ×2' });
    expect(
      summarizeToolCalls([call('web_search'), call('read_file')], ['done', 'running'])
    ).toEqual({ state: 'running', count: 2, names: 'web_search, read_file' });
  });

  it('counts only the calls that ran, and names a group that never ran by its outcome', () => {
    expect(summarizeToolCalls([call('a'), call('b')], ['done', 'denied'])).toEqual({
      state: 'done',
      count: 1,
      names: 'a, b',
    });
    expect(summarizeToolCalls([call('run_shell_command')], ['denied'])).toEqual({
      state: 'denied',
      count: 1,
      names: 'run_shell_command',
    });
    expect(summarizeToolCalls([call('a'), call('b')], ['expired', 'expired'])).toEqual({
      state: 'expired',
      count: 2,
      names: 'a, b',
    });
  });
});
