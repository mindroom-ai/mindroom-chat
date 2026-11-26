// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createStore, Provider as JotaiProvider } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import type { SubagentFrame, SubagentMeta } from '../../matrix/protocol/subagentFrame';
import type { ToolTraceEvent } from '../../matrix/protocol/toolTrace';
import { subagentsPanelAtom } from '../../navigation/subagentsPanel';
import { getSubagentRunStore, type SubagentRun } from '../live/subagentRunStore';
import { ToolCallClockContext } from './toolCallStatus';
import {
  extractPrimaryArg,
  findLinkedSubagentRun,
  LiveToolPreview,
  type LiveToolItem,
} from './LiveToolPreview';

const ROOM_ID = '!room:example.org';
const THREAD_ID = '$thread-root:example.org';
const SENDER = '@mindroom_dev:example.org';
const NOW = 1_762_790_100;

const makeMeta = (overrides: Partial<SubagentMeta> = {}): SubagentMeta => ({
  agent: 'researcher',
  subagent: 'del-1',
  caller: 'lead',
  root: 'lead',
  parent: null,
  threadId: THREAD_ID,
  source: 'delegate',
  status: 'running',
  startedAt: NOW - 30,
  endedAt: null,
  ...overrides,
});

const makeFrame = (
  run: string,
  meta: Partial<SubagentMeta>,
  tools: ToolTraceEvent[],
  seq = 0
): SubagentFrame => ({
  run,
  sid: '1762790000000-abcdef01',
  seq,
  meta: makeMeta({ subagent: run, ...meta }),
  snapshot: { md: '', reasoning: '', tools, status: 'streaming', activity: '', segments: [] },
});

const toolItem = (overrides: Partial<LiveToolItem> = {}): LiveToolItem => ({
  index: 1,
  toolName: 'run_shell_command',
  command: 'run_shell_command',
  ...overrides,
});

describe('extractPrimaryArg', () => {
  it('prefers target keys via toToolArgumentFields and falls back to trimmed args_preview', () => {
    expect(extractPrimaryArg('timeout=60, command=pytest -q tests/live.py')).toBe(
      'pytest -q tests/live.py'
    );
    expect(extractPrimaryArg('args=["git", "status"], cwd=/repo')).toBe('git, status');
    expect(extractPrimaryArg('offset=10, file_path=src/app/HtmlBlocks.tsx')).toBe(
      'src/app/HtmlBlocks.tsx'
    );
    expect(extractPrimaryArg('{"query": "live bash steps"}')).toBe('live bash steps');
    expect(extractPrimaryArg('room=#dev, text=hello\nworld')).toBe('room=#dev, text=hello world');
    expect(extractPrimaryArg('command=echo \u202ehi')).toBe('echo <U+202E>hi');
    expect(extractPrimaryArg('   ')).toBeUndefined();
  });
});

describe('findLinkedSubagentRun', () => {
  const runOf = (run: string, meta: Partial<SubagentMeta>): SubagentRun => ({
    roomId: ROOM_ID,
    run,
    sender: '@bot:example.org',
    meta: makeMeta({ subagent: run, ...meta }),
    docs: { md: '', reasoning: '', tools: [], status: 'streaming', activity: '', segments: [] },
    sid: '1762790000000-abcdef01',
    seq: 0,
    lastFrameAt: NOW * 1000,
    stale: false,
  });

  it('scopes matches to the same conversation and prefers active then newest runs', () => {
    const otherThread = runOf('other', {
      callerToolCallId: 'call_1',
      threadId: '$other:example.org',
    });
    const completed = runOf('done', {
      callerToolCallId: 'call_1',
      status: 'completed',
      startedAt: NOW - 5,
    });
    const active = runOf('live', {
      callerToolCallId: 'call_1',
      status: 'running',
      startedAt: NOW - 20,
    });
    expect(findLinkedSubagentRun([otherThread, completed, active], 'call_1', THREAD_ID)?.run).toBe(
      'live'
    );
    expect(findLinkedSubagentRun([otherThread], 'call_1', THREAD_ID)).toBeUndefined();
    expect(
      findLinkedSubagentRun(
        [runOf('room', { callerToolCallId: 'call_1', threadId: null })],
        'call_1',
        undefined
      )?.run
    ).toBe('room');
  });
});

describe('LiveToolPreview', () => {
  let container: HTMLDivElement;
  let root: Root;
  let mx: MatrixClient;
  let jotaiStore: ReturnType<typeof createStore>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW * 1000 });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mx = {} as MatrixClient;
    jotaiStore = createStore();
  });

  afterEach(() => {
    act(() => root.unmount());
    getSubagentRunStore(mx).clear();
    container.remove();
    vi.useRealTimers();
  });

  const render = (
    running: LiveToolItem[],
    {
      roomId = ROOM_ID,
      threadId = THREAD_ID,
      withClient = true,
      clockNow,
    }: {
      roomId?: string;
      threadId?: string;
      withClient?: boolean;
      clockNow?: number | null;
    } = {}
  ) => {
    let tree = <LiveToolPreview running={running} roomId={roomId} threadId={threadId} />;
    if (clockNow !== undefined) {
      tree = <ToolCallClockContext value={clockNow}>{tree}</ToolCallClockContext>;
    }
    if (withClient) {
      tree = <MatrixClientProvider value={mx}>{tree}</MatrixClientProvider>;
    }
    act(() => {
      root.render(<JotaiProvider store={jotaiStore}>{tree}</JotaiProvider>);
    });
  };

  it('renders a linked subagent card with up to 4 steps, durations, stdout toggle, and Sub-agents jump', () => {
    const store = getSubagentRunStore(mx);
    const bashOutput = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'].join('\n');
    act(() => {
      store.ingest(
        ROOM_ID,
        SENDER,
        makeFrame(
          'del-2',
          {
            subagent: 'del-1',
            title: 'Verify live steps',
            callerToolCallId: 'call_sub_1',
            usage: { inputTokens: 1000, outputTokens: 200, toolCalls: 5 },
          },
          [
            {
              type: 'tool_call_completed',
              tool_name: 'list_files',
              args_preview: 'path=src',
              started_at: NOW - 25,
              ended_at: NOW - 24,
            },
            {
              type: 'tool_call_completed',
              tool_name: 'read_file',
              args_preview: 'file_path=src/app/HtmlBlocks.tsx',
              started_at: NOW - 20,
              ended_at: NOW - 19.8,
            },
            {
              type: 'tool_call_completed',
              tool_name: 'grep',
              args_preview: 'pattern=LiveToolPreview',
              started_at: NOW - 15,
              ended_at: NOW - 12,
              is_error: true,
            },
            {
              type: 'tool_call_completed',
              tool_name: 'write_file',
              args_preview: 'path=src/app/LiveToolPreview.tsx',
              started_at: NOW - 10,
            },
            {
              type: 'tool_call_started',
              tool_name: 'bash',
              args_preview: 'command=vitest run LiveToolPreview',
              started_at: NOW - 4,
              progress: bashOutput,
            },
          ]
        ),
        NOW * 1000
      );
    });

    render([
      toolItem({
        index: 1,
        toolName: 'run_subagent',
        command: 'run_subagent',
        toolCallId: 'call_sub_1',
        progress: 'Calling bash (started 12:00:00 UTC)',
      }),
    ]);

    expect(container.textContent).toContain('Verify live steps');
    expect(container.querySelector('[data-live-subagent-count]')?.textContent).toContain('5 calls');
    expect(container.textContent).not.toContain('Calling bash (started');

    const steps = [...container.querySelectorAll<HTMLElement>('[data-live-step]')];
    expect(steps).toHaveLength(4);
    expect(steps.map((el) => el.dataset.liveStep)).toEqual(['done', 'failed', 'done', 'running']);
    // Oldest step (list_files) dropped once > 4 steps exist; remaining are oldest-to-newest.
    expect(container.textContent).not.toContain('list_files');
    expect(steps[0]?.textContent).toContain('read_file');
    expect(steps[0]?.textContent).toContain('src/app/HtmlBlocks.tsx');
    expect(steps[0]?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Done');
    expect(steps[0]?.querySelector('[role="img"] > *')?.getAttribute('aria-hidden')).toBe('true');
    expect(steps[0]?.querySelector('[data-live-step-elapsed]')?.textContent).toBe('1s');
    expect(steps[1]?.textContent).toContain('grep');
    expect(steps[1]?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
      "Didn't complete"
    );
    expect(steps[1]?.querySelector('[data-live-step-elapsed]')?.textContent).toBe('3s');
    // Missing ended_at omits duration cleanly.
    expect(steps[2]?.querySelector('[data-live-step-elapsed]')).toBeNull();
    // Active running step ticks live, exposes accessible status label, and uses 3-line subagent output well.
    expect(steps[3]?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Running');
    expect(steps[3]?.querySelector('[role="img"] > *')?.getAttribute('aria-hidden')).toBe('true');
    expect(steps[3]?.querySelector('[data-live-step-elapsed]')?.textContent).toBe('4s');
    const subagentOutput = steps[3]?.querySelector('[data-live-output]');
    expect(subagentOutput?.className).toBe('live-tool-terminal-output-subagent');
    expect(subagentOutput?.textContent).toBe('line 3\nline 4\nline 5');

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(steps[3]?.querySelector('[data-live-step-elapsed]')?.textContent).toBe('7s');

    // Clicking active step toggles stdout well with aria-expanded.
    const activeToggle = steps[3]?.querySelector<HTMLButtonElement>('button[aria-expanded]');
    expect(activeToggle?.getAttribute('aria-expanded')).toBe('true');
    act(() => activeToggle?.click());
    expect(activeToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(steps[3]?.querySelector('[data-live-output]')).toBeNull();
    act(() => activeToggle?.click());
    expect(activeToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(steps[3]?.querySelector('[data-live-output]')?.textContent).toBe(
      'line 3\nline 4\nline 5'
    );

    // Clicking Sub-agents button opens the panel directly at this turn's run ID.
    const openBtn = container.querySelector<HTMLButtonElement>('[data-live-subagent-open]');
    act(() => openBtn?.click());
    expect(jotaiStore.get(subagentsPanelAtom)).toEqual({
      roomId: ROOM_ID,
      threadId: THREAD_ID,
      run: 'del-2',
    });
  });

  it('renders a clean header card when a linked subagent has not started its first tool yet', () => {
    const store = getSubagentRunStore(mx);
    act(() => {
      store.ingest(
        ROOM_ID,
        SENDER,
        makeFrame('del-1', { agent: 'researcher', callerToolCallId: 'call_sub_empty' }, []),
        NOW * 1000
      );
    });

    render([
      toolItem({
        toolName: 'continue_subagent',
        command: 'continue_subagent',
        toolCallId: 'call_sub_empty',
      }),
    ]);

    expect(container.querySelector('[data-live-subagent="del-1"]')?.textContent).toContain(
      'researcher'
    );
    expect(container.querySelector('[data-live-step]')).toBeNull();
    expect(container.querySelector('[data-live-output]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    // Non-redundant pre-tool progress shows under the header; once the run ends, lingering started steps settle.
    render([
      toolItem({
        toolName: 'continue_subagent',
        command: 'continue_subagent',
        toolCallId: 'call_sub_empty',
        progress: 'Warming up workspace…',
      }),
    ]);
    expect(container.querySelector('[data-live-output]')?.textContent).toBe(
      'Warming up workspace…'
    );

    act(() => {
      store.ingest(
        ROOM_ID,
        SENDER,
        makeFrame(
          'del-1',
          { status: 'failed', callerToolCallId: 'call_sub_empty' },
          [{ type: 'tool_call_started', tool_name: 'bash', started_at: NOW - 5 }],
          1
        ),
        (NOW + 1) * 1000
      );
    });
    expect(container.querySelector<HTMLElement>('[data-live-step]')?.dataset.liveStep).toBe(
      'failed'
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('renders direct run_shell_command immediately before stdout, then reveals 4-line toggleable output', () => {
    const shell = toolItem({
      index: 1,
      toolName: 'run_shell_command',
      argsPreview: 'command=cargo test --workspace',
      startedAt: NOW - 2,
    });
    render([shell]);

    expect(container.querySelector('[data-live-shell="1"]')).not.toBeNull();
    expect(container.textContent).toContain('run_shell_command');
    expect(container.textContent).toContain('cargo test --workspace');
    expect(container.querySelector('[data-live-step-elapsed]')?.textContent).toBe('2s');
    expect(container.querySelector('[data-live-output]')).toBeNull();
    expect(container.querySelector('button[aria-expanded]')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(container.querySelector('[data-live-step-elapsed]')?.textContent).toBe('4s');

    // Stdout arrives: 4-line terminal well opens by default and toggles on click.
    render([
      {
        ...shell,
        progress: ['out 1', 'out 2', 'out 3', 'out 4', 'out 5', 'out 6'].join('\n'),
      },
    ]);
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    const shellOutput = container.querySelector('[data-live-output]');
    expect(shellOutput?.className).toBe('live-tool-terminal-output-shell');
    expect(shellOutput?.textContent).toBe('out 3\nout 4\nout 5\nout 6');
    act(() => toggle?.click());
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-live-output]')).toBeNull();
  });

  it('shows parallel running calls together without shadowing each other', () => {
    const store = getSubagentRunStore(mx);
    act(() => {
      store.ingest(
        ROOM_ID,
        SENDER,
        makeFrame('del-p', { title: 'Check docs', callerToolCallId: 'call_p' }, [
          { type: 'tool_call_started', tool_name: 'read_file', args_preview: 'path=README.md' },
        ]),
        NOW * 1000
      );
    });

    render([
      toolItem({
        index: 1,
        toolName: 'run_subagent',
        command: 'run_subagent',
        toolCallId: 'call_p',
      }),
      toolItem({ index: 2, toolName: 'bash', argsPreview: 'command=npm test' }),
      toolItem({
        index: 3,
        toolName: 'search_web',
        command: 'search_web(q=folds)',
        progress: 'querying…',
      }),
    ]);

    expect(container.querySelector('[data-live-subagent="del-p"]')?.textContent).toContain(
      'README.md'
    );
    expect(container.querySelector('[data-live-shell="2"]')?.textContent).toContain('npm test');
    expect(container.textContent).toContain('search_web(q=folds)');
    expect(container.textContent).toContain('querying…');
  });

  it('falls back cleanly when backend omits new fields and stops clocks and subscriptions when idle', () => {
    const store = getSubagentRunStore(mx);
    const subscribeSpy = vi.spyOn(store, 'subscribe');

    // Direct shell call without subagent call adds zero SubagentRunStore subscriptions.
    render([toolItem({ index: 1, toolName: 'bash', argsPreview: 'command=ls', startedAt: NOW })]);
    expect(subscribeSpy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    // Providing ToolCallClockContext reuses it with zero local interval timers.
    render(
      [toolItem({ index: 1, toolName: 'bash', argsPreview: 'command=ls', startedAt: NOW - 5 })],
      { clockNow: NOW * 1000 }
    );
    expect(container.querySelector('[data-live-step-elapsed]')?.textContent).toBe('5s');
    expect(vi.getTimerCount()).toBe(0);

    // Unlinked run_subagent (older backend) falls back to 6-line progress preview cleanly even without MatrixClient.
    const sixPlus = Array.from({ length: 8 }, (_, i) => `row ${i + 1}`).join('\n');
    render(
      [
        toolItem({
          index: 2,
          toolName: 'run_subagent',
          command: 'run_subagent(task=old)',
          progress: sixPlus,
        }),
      ],
      { withClient: false }
    );
    expect(container.textContent).toContain('run_subagent(task=old)');
    expect(container.textContent).toContain('row 3');
    expect(container.textContent).not.toContain('row 2');
    expect(vi.getTimerCount()).toBe(0);

    // Non-shell tool without progress renders nothing and leaves zero timers.
    render([toolItem({ index: 3, toolName: 'read_file', command: 'read_file' })]);
    expect(container.innerHTML).toBe('');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['paused' as const, 'Paused'],
    ['awaiting_approval' as const, 'Waiting for approval'],
  ])(
    'renders unfinished child steps as waiting with zero ticking timers when subagent is %s',
    (status, expectedLabel) => {
      const store = getSubagentRunStore(mx);
      act(() => {
        store.ingest(
          ROOM_ID,
          SENDER,
          makeFrame('del-wait', { status, title: 'Waiting run', callerToolCallId: 'call_wait' }, [
            {
              type: 'tool_call_completed',
              tool_name: 'read_file',
              args_preview: 'path=src/index.ts',
              started_at: NOW - 20,
              ended_at: NOW - 18,
            },
            {
              type: 'tool_call_started',
              tool_name: 'bash',
              args_preview: 'command=rm -rf tmp',
              started_at: NOW - 15,
            },
          ]),
          NOW * 1000
        );
      });

      const subagentItem = toolItem({
        index: 1,
        toolName: 'run_subagent',
        command: 'run_subagent',
        toolCallId: 'call_wait',
      });
      render([subagentItem]);

      const steps = [...container.querySelectorAll<HTMLElement>('[data-live-step]')];
      expect(steps.map((el) => el.dataset.liveStep)).toEqual(['done', 'waiting']);
      expect(steps[0]?.querySelector('[data-live-step-elapsed]')?.textContent).toBe('2s');
      const waitingIcon = steps[1]?.querySelector('[role="img"]');
      expect(waitingIcon?.className).toBe('live-tool-step-icon-waiting');
      expect(waitingIcon?.getAttribute('aria-label')).toBe(expectedLabel);
      expect(waitingIcon?.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
      expect(steps[1]?.querySelector('[data-live-step-elapsed]')).toBeNull();
      expect(vi.getTimerCount()).toBe(0);

      // Even alongside a ticking parallel shell call, a waiting step never renders or ticks elapsed time.
      render([
        subagentItem,
        toolItem({
          index: 2,
          toolName: 'bash',
          argsPreview: 'command=sleep 5',
          startedAt: NOW - 3,
        }),
      ]);
      act(() => {
        vi.advanceTimersByTime(4_000);
      });
      const subagentSteps = [
        ...container.querySelectorAll<HTMLElement>(
          '[data-live-subagent="del-wait"] [data-live-step]'
        ),
      ];
      expect(subagentSteps[1]?.querySelector('[data-live-step-elapsed]')).toBeNull();
      expect(
        container.querySelector('[data-live-shell="2"] [data-live-step-elapsed]')?.textContent
      ).toBe('7s');
    }
  );

  it('starts no local interval and hides elapsed time when ToolCallClockContext is explicitly null', () => {
    render(
      [
        toolItem({
          index: 1,
          toolName: 'bash',
          argsPreview: 'command=sleep 10',
          startedAt: NOW - 15,
        }),
      ],
      { clockNow: null }
    );

    expect(container.querySelector('[data-live-shell="1"]')).not.toBeNull();
    expect(container.querySelector('[data-live-step-elapsed]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(container.querySelector('[data-live-step-elapsed]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a collapsed shell row state stable when a parallel subagent starts and ends', () => {
    const store = getSubagentRunStore(mx);
    act(() => {
      store.ingest(
        ROOM_ID,
        SENDER,
        makeFrame('del-stable', { title: 'Side check', callerToolCallId: 'call_stable' }, [
          { type: 'tool_call_started', tool_name: 'grep', args_preview: 'pattern=foo' },
        ]),
        NOW * 1000
      );
    });

    const shell = toolItem({
      index: 2,
      toolName: 'bash',
      argsPreview: 'command=npm test',
      progress: 'running tests...',
    });
    const subagent = toolItem({
      index: 1,
      toolName: 'run_subagent',
      command: 'run_subagent',
      toolCallId: 'call_stable',
    });

    render([shell]);
    const shellToggle = () =>
      container.querySelector<HTMLButtonElement>('[data-live-shell="2"] button[aria-expanded]');
    expect(shellToggle()?.getAttribute('aria-expanded')).toBe('true');
    act(() => shellToggle()?.click());
    expect(shellToggle()?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-live-shell="2"] [data-live-output]')).toBeNull();

    // Parallel subagent starts: shell row must not remount or reopen.
    render([subagent, shell]);
    expect(container.querySelector('[data-live-subagent="del-stable"]')).not.toBeNull();
    expect(shellToggle()?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-live-shell="2"] [data-live-output]')).toBeNull();

    // Parallel subagent finishes: shell row still stays collapsed.
    render([shell]);
    expect(container.querySelector('[data-live-subagent="del-stable"]')).toBeNull();
    expect(shellToggle()?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-live-shell="2"] [data-live-output]')).toBeNull();
  });
});
