import { describe, expect, it } from 'vitest';
import type { LiveDocs } from '../matrix/protocol/liveFrame';
import type { SubagentMeta, SubagentStatus } from '../matrix/protocol/subagentFrame';
import type { ToolTraceEvent } from '../matrix/protocol/toolTrace';
import { currentToolCall, runLine, runToolCall, toolActivity } from './runActivity';

const meta = (status: SubagentStatus, extra: Partial<SubagentMeta> = {}): SubagentMeta => ({
  agent: 'researcher',
  subagent: 'researcher-1',
  caller: 'devagent',
  root: 'devagent',
  parent: null,
  threadId: '$thread',
  source: 'delegate',
  status,
  startedAt: 100,
  endedAt: status === 'running' || status === 'awaiting_approval' ? null : 160,
  ...extra,
});

const docs = (tools: ToolTraceEvent[] = []): LiveDocs => ({
  md: '',
  reasoning: '',
  tools,
  status: 'streaming',
  activity: '',
  segments: [],
});

const started = (tool: string, args?: string, extra: Partial<ToolTraceEvent> = {}) => ({
  type: 'tool_call_started',
  tool_name: tool,
  ...(args === undefined ? {} : { args_preview: args }),
  ...extra,
});

describe('toolActivity', () => {
  it('gives a call its tool, its arguments on one line and when it started', () => {
    expect(toolActivity(started('run_shell_command', '  pytest\n   tests/export  -x '))).toEqual({
      tool: 'run_shell_command',
      preview: 'pytest tests/export -x',
    });
    expect(toolActivity(started('read_file', 'a.ts', { started_at: 120.5 }))).toEqual({
      tool: 'read_file',
      preview: 'a.ts',
      startedAt: 120.5,
    });
  });

  it('cuts long arguments short, and leaves out empty ones and calls without a tool', () => {
    const long = toolActivity(started('write_file', 'x'.repeat(400)));
    expect(long?.preview).toHaveLength(160);
    expect(long?.preview?.endsWith('…')).toBe(true);
    expect(toolActivity(started('list_files', '   '))).toEqual({ tool: 'list_files' });
    expect(toolActivity({ type: 'tool_call_started', tool_name: '' })).toBeUndefined();
    expect(toolActivity(undefined)).toBeUndefined();
  });
});

describe('currentToolCall', () => {
  it('is the newest call still started, never one that completed', () => {
    // A call keeps its place in the list; completing it changes its entry.
    const tools = [
      { type: 'tool_call_completed', tool_name: 'read_file', args_preview: 'a.ts' },
      started('search_files', 'retry'),
      { type: 'tool_call_completed', tool_name: 'write_file', args_preview: 'b.ts' },
    ];
    expect(currentToolCall(tools)).toEqual({ tool: 'search_files', preview: 'retry' });
    expect(currentToolCall([...tools, started('run_shell_command', 'just test')])).toEqual({
      tool: 'run_shell_command',
      preview: 'just test',
    });
  });

  it('is none without started calls, as from MindRoom before tool frames', () => {
    expect(currentToolCall([])).toBeUndefined();
    expect(currentToolCall([{ type: 'tool_call_completed', tool_name: 'read_file' }])).toBe(
      undefined
    );
  });
});

describe('runToolCall', () => {
  it('names the call of a run at work or waiting for approval only', () => {
    const tools = [started('run_shell_command', 'just test')];
    expect(runToolCall({ meta: meta('running'), docs: docs(tools) })?.tool).toBe(
      'run_shell_command'
    );
    expect(runToolCall({ meta: meta('awaiting_approval'), docs: docs(tools) })?.tool).toBe(
      'run_shell_command'
    );
    (['paused', 'completed', 'cancelled', 'failed'] as const).forEach((status) =>
      expect(runToolCall({ meta: meta(status), docs: docs(tools) })).toBeUndefined()
    );
  });
});

describe('runLine', () => {
  const call = [started('search_files', 'schedule_retry')];

  it('labels a running call Now and a waiting one Needs approval', () => {
    expect(runLine({ meta: meta('running'), docs: docs(call) }, 'Text', undefined)).toEqual({
      kind: 'now',
      activity: { tool: 'search_files', preview: 'schedule_retry' },
    });
    expect(
      runLine({ meta: meta('awaiting_approval'), docs: docs(call) }, 'Text', undefined).kind
    ).toBe('approval');
  });

  it('shows what a run at work wrote, unlabelled, while it makes no call', () => {
    expect(runLine({ meta: meta('running'), docs: docs() }, 'Looking.', undefined)).toEqual({
      kind: 'plain',
      text: 'Looking.',
    });
    expect(runLine({ meta: meta('paused'), docs: docs(call) }, undefined, undefined)).toEqual({
      kind: 'plain',
    });
  });

  it('labels a finished run Result, with the start of what it wrote', () => {
    expect(runLine({ meta: meta('completed'), docs: docs() }, 'Paged.', 'Paged.')).toEqual({
      kind: 'result',
      text: 'Paged.',
    });
    expect(runLine({ meta: meta('completed'), docs: docs() }, undefined, undefined)).toEqual({
      kind: 'plain',
    });
  });

  it('says how a run ended that did not finish, and why when it says', () => {
    expect(runLine({ meta: meta('cancelled'), docs: docs() }, 'Half.', 'By you.')).toEqual({
      kind: 'ended',
      status: 'cancelled',
      reason: 'By you.',
    });
    expect(runLine({ meta: meta('cancelled'), docs: docs() }, 'Half.', undefined)).toEqual({
      kind: 'ended',
      status: 'cancelled',
    });
    expect(runLine({ meta: meta('failed'), docs: docs() }, 'Boom.', 'Boom.')).toEqual({
      kind: 'ended',
      status: 'failed',
      reason: 'Boom.',
    });
    expect(runLine({ meta: meta('denied'), docs: docs() }, undefined, undefined).kind).toBe(
      'ended'
    );
    const cut = meta('failed', { interruptedByRestart: true });
    expect(runLine({ meta: cut, docs: docs() }, 'Restarted.', 'Restarted.')).toEqual({
      kind: 'ended',
      status: 'interrupted',
      reason: 'Restarted.',
    });
  });
});
