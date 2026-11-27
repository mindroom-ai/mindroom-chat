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
import { getSubagentRunStore } from '../live/subagentRunStore';
import {
  ToolCallClockContext,
  ToolCallWaitingStatusContext,
  type ToolCallWaitingStatus,
} from './toolCallStatus';
import * as css from './LiveToolPreview.css';
import { extractPrimaryArg, LiveToolPreview, type LiveToolItem } from './LiveToolPreview';

const copyMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn<(text: string, container?: Element | null) => Promise<boolean>>(),
}));

vi.mock('../../lib/dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/dom')>();
  return { ...actual, copyToClipboard: copyMocks.copyToClipboard };
});

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

const subagentItem = (toolCallId: string, overrides: Partial<LiveToolItem> = {}): LiveToolItem =>
  toolItem({
    toolName: 'run_subagent',
    command: 'run_subagent',
    toolCallId,
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

describe('LiveToolPreview', () => {
  let container: HTMLDivElement;
  let root: Root;
  let mx: MatrixClient;
  let jotaiStore: ReturnType<typeof createStore>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW * 1000 });
    copyMocks.copyToClipboard.mockReset().mockResolvedValue(true);
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

  const ingestRun = (
    run: string,
    meta: Partial<SubagentMeta>,
    tools: ToolTraceEvent[],
    seq = 0,
    sender = SENDER
  ) => {
    act(() => {
      getSubagentRunStore(mx).ingest(
        ROOM_ID,
        sender,
        makeFrame(run, meta, tools, seq),
        (NOW + seq) * 1000
      );
    });
  };

  const render = (
    running: LiveToolItem[],
    options: {
      roomId?: string;
      threadId?: string;
      sender?: string;
      withClient?: boolean;
      clockNow?: number | null;
      waitingStatus?: ToolCallWaitingStatus;
    } = {}
  ) => {
    const {
      roomId = ROOM_ID,
      threadId = THREAD_ID,
      withClient = true,
      clockNow,
      waitingStatus,
    } = options;
    const sender = 'sender' in options ? options.sender : SENDER;
    let tree = (
      <LiveToolPreview running={running} roomId={roomId} threadId={threadId} sender={sender} />
    );
    if (waitingStatus !== undefined) {
      tree = (
        <ToolCallWaitingStatusContext value={waitingStatus}>{tree}</ToolCallWaitingStatusContext>
      );
    }
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

  it('renders a linked subagent card with up to 4 steps, durations, expandable drawer, and Sub-agents jump', () => {
    const bashOutput = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'].join('\n');
    ingestRun(
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
    );

    render([subagentItem('call_sub_1', { progress: 'Calling bash (started 12:00:00 UTC)' })]);

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
    // Active running step ticks live, starts collapsed with 3-line rest output well.
    expect(steps[3]?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Running');
    expect(steps[3]?.querySelector('[role="img"] > *')?.getAttribute('aria-hidden')).toBe('true');
    expect(steps[3]?.querySelector('[data-live-step-elapsed]')?.textContent).toBe('4s');
    const subagentOutput = steps[3]?.querySelector('[data-live-output]');
    expect(subagentOutput?.className).toBe(css.TerminalOutput.subagent);
    expect(subagentOutput?.textContent).toBe('line 3\nline 4\nline 5');

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(steps[3]?.querySelector('[data-live-step-elapsed]')?.textContent).toBe('7s');

    // Clicking active step opens full drawer (command + full 5-line output, no duplicate) and collapses back.
    const activeToggle = steps[3]?.querySelector<HTMLButtonElement>('button[aria-expanded]');
    expect(activeToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(activeToggle?.getAttribute('aria-controls')).toBeNull();
    expect(steps[3]?.querySelector('[data-live-step-drawer]')).toBeNull();
    act(() => activeToggle?.click());
    expect(activeToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(steps[3]?.querySelector('[data-live-step-drawer]')?.id).toBe(
      activeToggle?.getAttribute('aria-controls')
    );
    expect(steps[3]?.querySelector('[data-live-step-command]')?.textContent).toBe(
      'vitest run LiveToolPreview'
    );
    expect(steps[3]?.querySelectorAll('[data-live-output]')).toHaveLength(1);
    expect(steps[3]?.querySelector('[data-live-output]')?.className).toBe(css.DrawerOutput);
    expect(steps[3]?.querySelector('[data-live-output]')?.textContent).toBe(bashOutput);
    act(() => activeToggle?.click());
    expect(activeToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(steps[3]?.querySelector('[data-live-step-drawer]')).toBeNull();
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

  it('keeps bare steps without args, output, or result non-interactive while previewing args at rest', () => {
    ingestRun('del-bare', { title: 'Mixed steps', callerToolCallId: 'call_bare' }, [
      { type: 'tool_call_completed', tool_name: 'pwd' },
      { type: 'tool_call_completed', tool_name: 'lint', is_error: true },
      { type: 'tool_call_started', tool_name: 'bash' },
      { type: 'tool_call_completed', tool_name: 'read_file', args_preview: 'path=src/index.ts' },
    ]);

    render([
      subagentItem('call_bare'),
      toolItem({ index: 2, toolName: 'bash', command: 'bash' }),
    ]);

    const subSteps = [
      ...container.querySelectorAll<HTMLElement>('[data-live-subagent="del-bare"] [data-live-step]'),
    ];
    expect(subSteps).toHaveLength(4);
    for (const bare of subSteps.slice(0, 3)) {
      expect(bare.querySelector('button[aria-expanded]')).toBeNull();
      expect(bare.querySelector(`.${css.StepChevron.split(' ')[0]}`)).toBeNull();
    }
    const withArg = subSteps[3]!;
    expect(withArg.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe(
      'false'
    );
    const argWrap = withArg.querySelector(`.${css.StepArgWrap.split(' ')[0]}`);
    const argText = argWrap?.querySelector(`.${css.StepArg.split(' ')[0]}`);
    expect(argWrap?.getAttribute('dir')).toBeNull();
    expect(argText?.getAttribute('dir')).toBe('auto');
    expect(argText?.textContent).toBe('src/index.ts');
    // Bare foreground shell step without args or progress is also non-interactive.
    expect(container.querySelector('[data-live-shell="2"] button[aria-expanded]')).toBeNull();
  });

  it('expands completed and failed steps with full command/multi-field args, results, and Copy feedback', async () => {
    vi.useFakeTimers({
      toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
      now: NOW * 1000,
    });
    ingestRun('del-detail', { title: 'Inspect details', callerToolCallId: 'call_detail' }, [
      {
        type: 'tool_call_completed',
        tool_name: 'grep',
        args_preview: 'pattern=LiveToolPreview, path=src/app/messages',
        result_preview: '3 matches\nLiveToolPreview.tsx',
        started_at: NOW - 10,
        ended_at: NOW - 9,
      },
      {
        type: 'tool_call_completed',
        tool_name: 'bash',
        args_preview: 'command=set -e\npytest -q',
        result_preview: 'AssertionError: boom',
        is_error: true,
        started_at: NOW - 8,
        ended_at: NOW - 5,
      },
    ]);

    render([subagentItem('call_detail')]);
    const steps = [...container.querySelectorAll<HTMLElement>('[data-live-step]')];
    const [doneStep, failedStep] = steps;

    // Collapsed non-shell step shows primary arg only; expanding hides StepArg and reveals full args + done result.
    const argClass = `.${css.StepArg.split(' ')[0]}`;
    expect(doneStep?.querySelector(argClass)?.textContent).toBe('src/app/messages');
    const doneToggle = doneStep?.querySelector<HTMLButtonElement>('button[aria-expanded]');
    act(() => doneToggle?.click());
    expect(doneToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(doneStep?.querySelector(argClass)).toBeNull();
    const doneDrawer = doneStep?.querySelector('[data-live-step-drawer]');
    expect(doneDrawer?.textContent).toContain('Arguments');
    expect(doneDrawer?.querySelector('[data-live-step-command]')?.textContent).toBe(
      'pattern=LiveToolPreview, path=src/app/messages'
    );
    const doneResult = doneDrawer?.querySelector('[data-live-step-result]');
    expect(doneResult?.className).toBe(css.DrawerResult.done);
    expect(doneResult?.textContent).toBe('3 matches\nLiveToolPreview.tsx');

    // Copy button sits outside the toggle button, copies full args, flips to Copied for 1500ms, then resets.
    const doneCopy = doneDrawer?.querySelector<HTMLButtonElement>('[data-live-step-copy]');
    expect(doneCopy).not.toBeNull();
    expect(doneToggle?.contains(doneCopy!)).toBe(false);
    expect(doneCopy?.textContent).toBe('Copy code');
    await act(async () => {
      doneCopy?.click();
      await Promise.resolve();
    });
    expect(copyMocks.copyToClipboard).toHaveBeenCalledWith(
      'pattern=LiveToolPreview, path=src/app/messages',
      doneCopy
    );
    expect(doneCopy?.textContent).toBe('Copied');
    act(() => {
      vi.advanceTimersByTime(1_499);
    });
    expect(doneCopy?.textContent).toBe('Copied');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(doneCopy?.textContent).toBe('Copy code');

    // Failed shell step shows Command header, multiline command, warning-tinted result, and Copy failed + cleanup on unmount.
    const failedToggle = failedStep?.querySelector<HTMLButtonElement>('button[aria-expanded]');
    act(() => failedToggle?.click());
    const failedDrawer = failedStep?.querySelector('[data-live-step-drawer]');
    expect(failedDrawer?.textContent).toContain('Command');
    expect(failedDrawer?.querySelector('[data-live-step-command]')?.textContent).toBe(
      'set -e\npytest -q'
    );
    const failedResult = failedDrawer?.querySelector('[data-live-step-result]');
    expect(failedResult?.className).toBe(css.DrawerResult.failed);
    expect(failedResult?.textContent).toBe('AssertionError: boom');

    const timersBeforeCopy = vi.getTimerCount();
    copyMocks.copyToClipboard.mockResolvedValueOnce(false);
    const failedCopy = failedDrawer?.querySelector<HTMLButtonElement>('[data-live-step-copy]');
    await act(async () => {
      failedCopy?.click();
      await Promise.resolve();
    });
    expect(copyMocks.copyToClipboard).toHaveBeenLastCalledWith('set -e\npytest -q', failedCopy);
    expect(failedCopy?.textContent).toBe('Copy failed');
    expect(vi.getTimerCount()).toBe(timersBeforeCopy + 1);

    // Unmounting clears pending copy feedback timeout cleanly.
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(timersBeforeCopy);
    root = createRoot(container);
  });

  it.each([
    [
      'shell JSON array with sibling arg',
      'bash',
      'args=["git", "status"], cwd=/repo',
      'args=["git", "status"], cwd=/repo',
    ],
    [
      'shell command containing comma-key syntax',
      'run_shell_command',
      "command=echo 'a=1, b=2'",
      "command=echo 'a=1, b=2'",
    ],
    [
      'single-key JSON shell command',
      'bash',
      '{"command": "echo \'a=1, b=2\'"}',
      "echo 'a=1, b=2'",
    ],
    [
      'non-shell multiline arg with indentation',
      'send_message',
      'text=first line\n  second line',
      'text=first line\n  second line',
    ],
  ])(
    'keeps lossless drawer text and copy payload for %s',
    async (_label, toolName, argsPreview, expectedDetail) => {
      ingestRun('del-lossless', { title: 'Lossless', callerToolCallId: 'call_lossless' }, [
        { type: 'tool_call_completed', tool_name: toolName, args_preview: argsPreview },
      ]);
      render([subagentItem('call_lossless')]);

      const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]');
      act(() => toggle?.click());
      expect(container.querySelector('[data-live-step-command]')?.textContent).toBe(expectedDetail);

      const copyBtn = container.querySelector<HTMLButtonElement>('[data-live-step-copy]');
      await act(async () => {
        copyBtn?.click();
        await Promise.resolve();
      });
      expect(copyMocks.copyToClipboard).toHaveBeenCalledWith(expectedDetail, copyBtn);
    }
  );

  it('auto-scrolls expanded live drawer output to bottom, pauses on scroll up, and resumes at bottom', () => {
    let mockScrollHeight = 400;
    const ownScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLPreElement.prototype,
      'scrollHeight'
    );
    const ownClientHeight = Object.getOwnPropertyDescriptor(
      HTMLPreElement.prototype,
      'clientHeight'
    );
    Object.defineProperty(HTMLPreElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => mockScrollHeight,
    });
    Object.defineProperty(HTMLPreElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 200,
    });

    try {
      const shell = toolItem({
        index: 1,
        toolName: 'run_shell_command',
        argsPreview: 'command=npm test',
        progress: 'line 1\nline 2',
      });
      render([shell]);

      // Opens scrolled to the bottom immediately.
      const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]');
      act(() => toggle?.click());
      const pre = container.querySelector<HTMLPreElement>('[data-live-output]');
      expect(pre).not.toBeNull();
      expect(pre?.scrollTop).toBe(400);

      // Follows new live output while pinned at bottom.
      mockScrollHeight = 520;
      render([{ ...shell, progress: 'line 1\nline 2\nline 3' }]);
      expect(pre?.scrollTop).toBe(520);

      // User scrolls up (> 4px from bottom): stops auto-scrolling on subsequent updates.
      act(() => {
        if (pre) {
          pre.scrollTop = 100;
          pre.dispatchEvent(new Event('scroll'));
        }
      });
      mockScrollHeight = 640;
      render([{ ...shell, progress: 'line 1\nline 2\nline 3\nline 4' }]);
      expect(pre?.scrollTop).toBe(100);

      // User scrolls back within 4px of bottom (640 - 438 - 200 = 2 <= 4): resumes auto-scrolling.
      act(() => {
        if (pre) {
          pre.scrollTop = 438;
          pre.dispatchEvent(new Event('scroll'));
        }
      });
      mockScrollHeight = 760;
      render([{ ...shell, progress: 'line 1\nline 2\nline 3\nline 4\nline 5' }]);
      expect(pre?.scrollTop).toBe(760);
    } finally {
      if (ownScrollHeight) {
        Object.defineProperty(HTMLPreElement.prototype, 'scrollHeight', ownScrollHeight);
      } else {
        Reflect.deleteProperty(HTMLPreElement.prototype, 'scrollHeight');
      }
      if (ownClientHeight) {
        Object.defineProperty(HTMLPreElement.prototype, 'clientHeight', ownClientHeight);
      } else {
        Reflect.deleteProperty(HTMLPreElement.prototype, 'clientHeight');
      }
    }
  });

    it('preserves expanded state across live frame updates and completion into result_preview', () => {
    const startedEvent: ToolTraceEvent = {
      type: 'tool_call_started',
      tool_call_id: 'call_live_1',
      tool_name: 'bash',
      args_preview: 'command=npm run build',
      started_at: NOW - 3,
      progress: 'line 1\nline 2\nline 3\nline 4',
    };
    ingestRun('del-flow', { title: 'Build app', callerToolCallId: 'call_flow' }, [startedEvent], 0);
    render([subagentItem('call_flow')]);

    const step = () => container.querySelector<HTMLElement>('[data-live-step]');
    const toggle = () => step()?.querySelector<HTMLButtonElement>('button[aria-expanded]');
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
    expect(step()?.querySelector('[data-live-output]')?.textContent).toBe('line 2\nline 3\nline 4');

    act(() => toggle()?.click());
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
    expect(step()?.querySelectorAll('[data-live-output]')).toHaveLength(1);
    expect(step()?.querySelector('[data-live-output]')?.textContent).toBe(
      'line 1\nline 2\nline 3\nline 4'
    );

    // Next streaming frame appends stdout: drawer stays open with updated output.
    ingestRun(
      'del-flow',
      { title: 'Build app', callerToolCallId: 'call_flow' },
      [{ ...startedEvent, progress: 'line 1\nline 2\nline 3\nline 4\nline 5' }],
      1
    );
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
    expect(step()?.querySelector('[data-live-output]')?.textContent).toBe(
      'line 1\nline 2\nline 3\nline 4\nline 5'
    );

    // Step completes with result_preview: stays expanded and transitions cleanly to result.
    ingestRun(
      'del-flow',
      { title: 'Build app', callerToolCallId: 'call_flow' },
      [
        {
          type: 'tool_call_completed',
          tool_call_id: 'call_live_1',
          tool_name: 'bash',
          args_preview: 'command=npm run build',
          started_at: NOW - 3,
          ended_at: NOW,
          result_preview: 'Build succeeded in 1.2s',
        },
      ],
      2
    );
    expect(step()?.dataset.liveStep).toBe('done');
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
    expect(step()?.querySelector('[data-live-output]')).toBeNull();
    expect(step()?.querySelector('[data-live-step-result]')?.textContent).toBe(
      'Build succeeded in 1.2s'
    );

    // Collapsing restores compact arg preview.
    act(() => toggle()?.click());
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
    expect(step()?.querySelector('[data-live-step-drawer]')).toBeNull();
    expect(step()?.querySelector(`.${css.StepArg.split(' ')[0]}`)?.textContent).toBe(
      'npm run build'
    );
  });

  it('renders a clean header card when a linked subagent has not started its first tool yet', () => {
    ingestRun('del-1', { agent: 'researcher', callerToolCallId: 'call_sub_empty' }, []);

    render([
      subagentItem('call_sub_empty', {
        toolName: 'continue_subagent',
        command: 'continue_subagent',
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
      subagentItem('call_sub_empty', {
        toolName: 'continue_subagent',
        command: 'continue_subagent',
        progress: 'Warming up workspace…',
      }),
    ]);
    expect(container.querySelector('[data-live-output]')?.textContent).toBe(
      'Warming up workspace…'
    );

    ingestRun(
      'del-1',
      { status: 'failed', callerToolCallId: 'call_sub_empty' },
      [{ type: 'tool_call_started', tool_name: 'bash', started_at: NOW - 5 }],
      1
    );
    expect(container.querySelector<HTMLElement>('[data-live-step]')?.dataset.liveStep).toBe(
      'failed'
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('renders direct run_shell_command with expandable command/copy drawer before and after stdout', async () => {
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
    const toggle = () => container.querySelector<HTMLButtonElement>('button[aria-expanded]');
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(container.querySelector('[data-live-step-elapsed]')?.textContent).toBe('4s');

    // Stdout arrives: 4-line terminal well stays visible at rest while row stays collapsed.
    const fullOutput = ['out 1', 'out 2', 'out 3', 'out 4', 'out 5', 'out 6'].join('\n');
    render([{ ...shell, progress: fullOutput }]);
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
    const restOutput = container.querySelector('[data-live-output]');
    expect(restOutput?.className).toBe(css.TerminalOutput.shell);
    expect(restOutput?.textContent).toBe('out 3\nout 4\nout 5\nout 6');

    // Expanding opens drawer with Command, Copy, and full 6-line output (no duplicate output).
    act(() => toggle()?.click());
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-live-step-command]')?.textContent).toBe(
      'cargo test --workspace'
    );
    expect(container.querySelectorAll('[data-live-output]')).toHaveLength(1);
    expect(container.querySelector('[data-live-output]')?.textContent).toBe(fullOutput);
    const copyBtn = container.querySelector<HTMLButtonElement>('[data-live-step-copy]');
    await act(async () => {
      copyBtn?.click();
      await Promise.resolve();
    });
    expect(copyMocks.copyToClipboard).toHaveBeenCalledWith('cargo test --workspace', copyBtn);
    expect(copyBtn?.textContent).toBe('Copied');

    // Collapsing restores 4-line rest well.
    act(() => toggle()?.click());
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-live-step-drawer]')).toBeNull();
    expect(container.querySelector('[data-live-output]')?.textContent).toBe(
      'out 3\nout 4\nout 5\nout 6'
    );
  });

  it('shows parallel running calls together without shadowing each other', () => {
    ingestRun('del-p', { title: 'Check docs', callerToolCallId: 'call_p' }, [
      { type: 'tool_call_started', tool_name: 'read_file', args_preview: 'path=README.md' },
    ]);

    render([
      subagentItem('call_p'),
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

    // Unlinked run_subagent (older backend) falls back to 6-line progress without repeating the command label.
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
    expect(container.textContent).not.toContain('run_subagent(task=old)');
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
      ingestRun('del-wait', { status, title: 'Waiting run', callerToolCallId: 'call_wait' }, [
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
      ]);

      const parentCall = subagentItem('call_wait');
      render([parentCall]);

      const steps = [...container.querySelectorAll<HTMLElement>('[data-live-step]')];
      expect(steps.map((el) => el.dataset.liveStep)).toEqual(['done', 'waiting']);
      expect(steps[0]?.querySelector('[data-live-step-elapsed]')?.textContent).toBe('2s');
      const waitingIcon = steps[1]?.querySelector('[role="img"]');
      expect(waitingIcon?.className).toBe(css.StepIcon.waiting);
      expect(waitingIcon?.getAttribute('aria-label')).toBe(expectedLabel);
      expect(waitingIcon?.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
      expect(steps[1]?.querySelector('[data-live-step-elapsed]')).toBeNull();
      expect(vi.getTimerCount()).toBe(0);

      // Even alongside a ticking parallel shell call, a waiting step never renders or ticks elapsed time.
      render([
        parentCall,
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

  it.each([
    ['paused' as const, 'Paused'],
    ['awaiting_approval' as const, 'Waiting for approval'],
  ])(
    'shows waiting state (%s -> %s), keeps stdout at rest with expandable drawer, and runs zero timers when clock is null',
    (waitingStatus, expectedLabel) => {
      render(
        [
          toolItem({
            index: 1,
            toolName: 'bash',
            argsPreview: 'command=sleep 10',
            startedAt: NOW - 15,
            progress: 'waiting line 1\nwaiting line 2',
          }),
        ],
        { clockNow: null, waitingStatus }
      );

      const step = container.querySelector('[data-live-shell="1"] [data-live-step]');
      expect(step?.getAttribute('data-live-step')).toBe('waiting');
      expect(step?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(expectedLabel);
      expect(container.querySelector('[data-live-step-elapsed]')).toBeNull();
      expect(vi.getTimerCount()).toBe(0);

      // Stdout well stays visible at rest; tapping opens drawer with command + single output, and collapsing restores rest view.
      const toggle = step?.querySelector<HTMLButtonElement>('button[aria-expanded]');
      expect(toggle?.getAttribute('aria-expanded')).toBe('false');
      expect(step?.querySelector('[data-live-output]')?.textContent).toBe(
        'waiting line 1\nwaiting line 2'
      );
      act(() => toggle?.click());
      expect(toggle?.getAttribute('aria-expanded')).toBe('true');
      expect(step?.querySelector('[data-live-step-command]')?.textContent).toBe('sleep 10');
      expect(step?.querySelectorAll('[data-live-output]')).toHaveLength(1);
      expect(step?.querySelector('[data-live-output]')?.textContent).toBe(
        'waiting line 1\nwaiting line 2'
      );
      act(() => toggle?.click());
      expect(toggle?.getAttribute('aria-expanded')).toBe('false');
      expect(step?.querySelector('[data-live-step-drawer]')).toBeNull();
      expect(step?.querySelector('[data-live-output]')?.textContent).toBe(
        'waiting line 1\nwaiting line 2'
      );

      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(container.querySelector('[data-live-step-elapsed]')).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('keeps an expanded shell row state stable when a parallel subagent starts and ends', () => {
    ingestRun('del-stable', { title: 'Side check', callerToolCallId: 'call_stable' }, [
      { type: 'tool_call_started', tool_name: 'grep', args_preview: 'pattern=foo' },
    ]);

    const shell = toolItem({
      index: 2,
      toolName: 'bash',
      argsPreview: 'command=npm test',
      progress: 'running tests...',
    });
    const subagent = subagentItem('call_stable');

    render([shell]);
    const shellToggle = () =>
      container.querySelector<HTMLButtonElement>('[data-live-shell="2"] button[aria-expanded]');
    expect(shellToggle()?.getAttribute('aria-expanded')).toBe('false');
    act(() => shellToggle()?.click());
    expect(shellToggle()?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-live-shell="2"] [data-live-step-drawer]')).not.toBeNull();

    // Parallel subagent starts: shell row must not remount or collapse.
    render([subagent, shell]);
    expect(container.querySelector('[data-live-subagent="del-stable"]')).not.toBeNull();
    expect(shellToggle()?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-live-shell="2"] [data-live-step-drawer]')).not.toBeNull();

    // Parallel subagent finishes: shell row still stays expanded.
    render([shell]);
    expect(container.querySelector('[data-live-subagent="del-stable"]')).toBeNull();
    expect(shellToggle()?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-live-shell="2"] [data-live-step-drawer]')).not.toBeNull();
  });

  it('starts a new subagent step collapsed while keeping the previous expanded step open in a capped 20-tool window', () => {
    const completed = (n: number, result?: string) => ({
      type: 'tool_call_completed' as const,
      tool_name: 'bash',
      args_preview: `command=cmd-${n}`,
      started_at: NOW - 100 + n,
      ended_at: NOW - 99 + n,
      ...(result ? { result_preview: result } : {}),
    });
    const firstWindow = [
      ...Array.from({ length: 19 }, (_, idx) => completed(idx + 1)),
      {
        type: 'tool_call_started' as const,
        tool_name: 'bash',
        args_preview: 'command=cmd-20',
        started_at: NOW - 80,
        progress: 'output from cmd-20',
      },
    ];
    ingestRun('del-cap', { title: 'Rolling run', callerToolCallId: 'call_cap' }, firstWindow);
    render([subagentItem('call_cap')]);

    const stepToggles = () => [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[data-live-subagent="del-cap"] button[aria-expanded]'
      ),
    ];
    expect(stepToggles().at(-1)?.getAttribute('aria-expanded')).toBe('false');
    act(() => stepToggles().at(-1)?.click());
    expect(stepToggles().at(-1)?.getAttribute('aria-expanded')).toBe('true');

    // Command 20 finishes and command 21 shifts into index 19 as index 0 drops off the 20-row cap.
    const nextWindow = [
      ...Array.from({ length: 18 }, (_, idx) => completed(idx + 2)),
      completed(20, 'cmd-20 ok'),
      {
        type: 'tool_call_started' as const,
        tool_name: 'bash',
        args_preview: 'command=cmd-21',
        started_at: NOW - 1,
        progress: 'output from cmd-21',
      },
    ];
    ingestRun('del-cap', { title: 'Rolling run', callerToolCallId: 'call_cap' }, nextWindow, 1);

    const nextSteps = [
      ...container.querySelectorAll<HTMLElement>('[data-live-subagent="del-cap"] [data-live-step]'),
    ];
    expect(nextSteps[2]?.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe(
      'true'
    );
    expect(nextSteps[2]?.querySelector('[data-live-step-result]')?.textContent).toBe('cmd-20 ok');
    expect(nextSteps[3]?.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe(
      'false'
    );
    expect(nextSteps[3]?.querySelector('[data-live-output]')?.textContent).toBe(
      'output from cmd-21'
    );
  });

  it('scopes linked subagent cards and panel jumps to the reply sender when two agents share a call ID', () => {
    const otherSender = '@mindroom_other:example.org';
    ingestRun(
      'run-agent-a',
      { title: 'Agent A check', callerToolCallId: 'call_shared', startedAt: NOW - 10 },
      [{ type: 'tool_call_started', tool_name: 'bash', progress: 'stdout from A' }],
      0,
      SENDER
    );
    ingestRun(
      'run-agent-b',
      { title: 'Agent B check', callerToolCallId: 'call_shared', startedAt: NOW - 2 },
      [{ type: 'tool_call_started', tool_name: 'bash', progress: 'stdout from B' }],
      0,
      otherSender
    );

    render([subagentItem('call_shared', { progress: 'fallback progress' })], { sender: SENDER });
    expect(container.querySelector('[data-live-subagent="run-agent-a"]')).not.toBeNull();
    expect(container.querySelector('[data-live-subagent="run-agent-b"]')).toBeNull();
    expect(container.textContent).toContain('Agent A check');
    expect(container.textContent).toContain('stdout from A');
    expect(container.textContent).not.toContain('stdout from B');

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-live-subagent-open]')?.click();
    });
    expect(jotaiStore.get(subagentsPanelAtom)).toEqual({
      roomId: ROOM_ID,
      threadId: THREAD_ID,
      run: 'run-agent-a',
    });

    // Without a known sender, keep the progress fallback instead of guessing a run.
    render([subagentItem('call_shared', { progress: 'fallback progress' })], { sender: undefined });
    expect(container.querySelector('[data-live-subagent]')).toBeNull();
    expect(container.textContent).toContain('fallback progress');
  });
});
