// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as css from './LiveToolPreview.css';
import { extractPrimaryArg, extractStepDetail, LiveStepRow } from './LiveStepRow';

const copyMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn<(text: string, container?: Element | null) => Promise<boolean>>(),
}));

vi.mock('../../lib/dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/dom')>();
  return { ...actual, copyToClipboard: copyMocks.copyToClipboard };
});

const DETAIL_CASES: readonly [string, string, string, string][] = [
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
  ['single-key JSON shell command', 'bash', '{"command": "echo \'a=1, b=2\'"}', "echo 'a=1, b=2'"],
  [
    'POSIX bracket test shell command',
    'bash',
    'command=[ -f package.json ] && npm test',
    '[ -f package.json ] && npm test',
  ],
  ['POSIX brace-group shell command', 'run_shell_command', 'command={ echo ok; }', '{ echo ok; }'],
  [
    'single structured JSON array shell args',
    'bash',
    'args=["git", "status"]',
    'args=["git", "status"]',
  ],
  [
    'non-shell multiline arg with indentation',
    'send_message',
    'text=first line\n  second line',
    'text=first line\n  second line',
  ],
];

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

describe('extractStepDetail', () => {
  it.each(DETAIL_CASES)(
    'returns trimmed drawer/clipboard text for %s',
    (_label, toolName, argsPreview, expectedDetail) => {
      expect(extractStepDetail(toolName, argsPreview)).toBe(expectedDetail);
    }
  );

  it('returns undefined for empty input and reveals directional control characters', () => {
    expect(extractStepDetail('bash', undefined)).toBeUndefined();
    expect(extractStepDetail('bash', '   ')).toBeUndefined();
    expect(extractStepDetail('bash', 'command=echo \u202ehi')).toBe('echo <U+202E>hi');
  });
});

describe('LiveStepRow', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    copyMocks.copyToClipboard.mockReset().mockResolvedValue(true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const render = (node: ReactNode) => {
    act(() => {
      root.render(node);
    });
  };

  it('keeps bare steps without args, output, or result non-interactive while previewing args at rest', () => {
    render(
      <>
        <LiveStepRow state="done" toolName="pwd" />
        <LiveStepRow state="failed" toolName="lint" />
        <LiveStepRow state="running" toolName="bash" />
        <LiveStepRow
          state="done"
          toolName="read_file"
          arg="src/index.ts"
          detailText="path=src/index.ts"
        />
      </>
    );

    const steps = [...container.querySelectorAll<HTMLElement>('[data-live-step]')];
    expect(steps).toHaveLength(4);
    for (const bare of steps.slice(0, 3)) {
      expect(bare.querySelector('button[aria-expanded]')).toBeNull();
      expect(bare.querySelector(`.${css.StepChevron}`)).toBeNull();
    }

    const withArg = steps[3]!;
    const toggle = withArg.querySelector<HTMLButtonElement>('button[aria-expanded]');
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle?.getAttribute('aria-controls')).toBeNull();
    const argText = toggle!.querySelector(`:scope > .${css.StepArg}`);
    expect(argText?.getAttribute('dir')).toBe('auto');
    expect(argText?.textContent).toBe('src/index.ts');
    const trail = toggle!.querySelector(`:scope > .${css.StepTrail}`);
    expect(trail).not.toBeNull();
    expect(toggle!.querySelector(`.${css.StepTrail} .${css.StepChevron}`)).not.toBeNull();
  });

  it('expands completed and failed steps with full command/multi-field args, results, and Copy feedback', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const grepArgs = 'pattern=LiveToolPreview, path=src/app/messages';
    const bashArgs = 'command=set -e\npytest -q';
    render(
      <>
        <LiveStepRow
          state="done"
          toolName="grep"
          arg={extractPrimaryArg(grepArgs)}
          detailText={extractStepDetail('grep', grepArgs)}
          result={'3 matches\nLiveToolPreview.tsx'}
        />
        <LiveStepRow
          state="failed"
          toolName="bash"
          arg={extractPrimaryArg(bashArgs)}
          detailText={extractStepDetail('bash', bashArgs)}
          result="AssertionError: boom"
        />
      </>
    );

    const steps = [...container.querySelectorAll<HTMLElement>('[data-live-step]')];
    expect(steps).toHaveLength(2);
    const [doneStep, failedStep] = steps;

    // Collapsed non-shell step shows primary arg only; expanding hides StepArg and reveals full args + done result.
    expect(doneStep!.querySelector(`.${css.StepArg}`)?.textContent).toBe('src/app/messages');
    const doneToggle = doneStep!.querySelector<HTMLButtonElement>('button[aria-expanded]');
    expect(doneToggle).not.toBeNull();
    expect(doneToggle!.getAttribute('aria-controls')).toBeNull();
    act(() => doneToggle!.click());
    expect(doneToggle!.getAttribute('aria-expanded')).toBe('true');
    expect(doneStep!.querySelector(`.${css.StepArg}`)).toBeNull();
    const doneDrawer = doneStep!.querySelector('[data-live-step-drawer]');
    expect(doneDrawer).not.toBeNull();
    expect(doneDrawer!.id).toBe(doneToggle!.getAttribute('aria-controls'));
    expect(doneDrawer!.textContent).toContain('Arguments');
    expect(doneDrawer!.querySelector('[data-live-step-command]')?.textContent).toBe(grepArgs);
    const doneResult = doneDrawer!.querySelector('[data-live-step-result]');
    expect(doneResult?.className).toBe(css.DrawerResult.done);
    expect(doneResult?.textContent).toBe('3 matches\nLiveToolPreview.tsx');

    // Copy button sits outside the toggle button, copies full args, flips to Copied for 1500ms, then resets.
    const doneCopy = doneDrawer!.querySelector<HTMLButtonElement>('[data-live-step-copy]');
    expect(doneCopy).not.toBeNull();
    expect(doneToggle!.contains(doneCopy)).toBe(false);
    expect(doneCopy?.textContent).toBe('Copy');
    await act(async () => {
      doneCopy?.click();
      await Promise.resolve();
    });
    expect(copyMocks.copyToClipboard).toHaveBeenCalledWith(grepArgs, doneCopy);
    expect(doneCopy?.textContent).toBe('Copied');
    act(() => {
      vi.advanceTimersByTime(1_499);
    });
    expect(doneCopy?.textContent).toBe('Copied');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(doneCopy?.textContent).toBe('Copy');

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

    expect(vi.getTimerCount()).toBe(0);
    copyMocks.copyToClipboard.mockResolvedValueOnce(false);
    const failedCopy = failedDrawer?.querySelector<HTMLButtonElement>('[data-live-step-copy]');
    await act(async () => {
      failedCopy?.click();
      await Promise.resolve();
    });
    expect(copyMocks.copyToClipboard).toHaveBeenLastCalledWith('set -e\npytest -q', failedCopy);
    expect(failedCopy?.textContent).toBe('Copy failed');
    expect(vi.getTimerCount()).toBe(1);

    // Unmounting clears pending copy feedback timeout cleanly.
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(container);
  });

  it.each(DETAIL_CASES)(
    'renders exact drawer text and copies full payload for %s',
    async (_label, toolName, argsPreview, expectedDetail) => {
      render(
        <LiveStepRow
          state="done"
          toolName={toolName}
          arg={extractPrimaryArg(argsPreview)}
          detailText={extractStepDetail(toolName, argsPreview)}
        />
      );

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
      const renderRunning = (output: string) =>
        render(
          <LiveStepRow
            state="running"
            toolName="run_shell_command"
            arg="npm test"
            detailText="npm test"
            output={output}
            outputLines="shell"
          />
        );

      renderRunning('line 1\nline 2');

      // Opens scrolled to the bottom immediately.
      const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]');
      act(() => toggle?.click());
      const pre = container.querySelector<HTMLPreElement>('[data-live-output]');
      expect(pre).not.toBeNull();
      expect(pre?.scrollTop).toBe(400);

      // Follows new live output while pinned at bottom.
      mockScrollHeight = 520;
      renderRunning('line 1\nline 2\nline 3');
      expect(pre?.scrollTop).toBe(520);

      // User scrolls up (> 4px from bottom): stops auto-scrolling on subsequent updates.
      act(() => {
        if (pre) {
          pre.scrollTop = 100;
          pre.dispatchEvent(new Event('scroll'));
        }
      });
      mockScrollHeight = 640;
      renderRunning('line 1\nline 2\nline 3\nline 4');
      expect(pre?.scrollTop).toBe(100);

      // User scrolls back within 4px of bottom (640 - 438 - 200 = 2 <= 4): resumes auto-scrolling.
      act(() => {
        if (pre) {
          pre.scrollTop = 438;
          pre.dispatchEvent(new Event('scroll'));
        }
      });
      mockScrollHeight = 760;
      renderRunning('line 1\nline 2\nline 3\nline 4\nline 5');
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
});
