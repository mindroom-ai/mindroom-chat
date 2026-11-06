// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BackgroundJob } from '../matrix/protocol/backgroundJobsContract';
import { JOBS_HOLD_MS, useJobsHeldBetweenCalls } from './useJobsHeldBetweenCalls';

const job = (jobId: string): BackgroundJob => ({
  jobId,
  threadId: '$thread',
  kind: 'tool',
  tool: 'run_shell_command',
  status: 'running',
  startedAt: '2026-11-05T00:00:00+00:00',
});
const NONE: BackgroundJob[] = [];

let shown: string[] = [];
let renderer: ReactTestRenderer | undefined;

function Probe({ jobs, view }: { jobs: BackgroundJob[]; view: string | null }) {
  shown = useJobsHeldBetweenCalls(jobs, view, (jobId) => jobId === 'sent').map(
    (held) => held.jobId
  );
  return null;
}

const show = (jobs: BackgroundJob[], view: string | null = '$thread') =>
  act(() => {
    if (renderer) renderer.update(<Probe jobs={jobs} view={view} />);
    else renderer = create(<Probe jobs={jobs} view={view} />);
  });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
});

it('keeps the last call between two calls and shows the next one at once', () => {
  show([job('first')]);
  show(NONE);
  expect(shown).toEqual(['first']);
  act(() => {
    vi.advanceTimersByTime(JOBS_HOLD_MS - 1);
  });
  expect(shown).toEqual(['first']);
  show([job('second')]);
  expect(shown).toEqual(['second']);
});

it('lets the bar go once no call follows within the hold', () => {
  show([job('first')]);
  show(NONE);
  act(() => {
    vi.advanceTimersByTime(JOBS_HOLD_MS);
  });
  expect(shown).toEqual([]);
});

it('does not extend the hold when other views change the room jobs', () => {
  show([job('first')]);
  show(NONE);
  act(() => {
    vi.advanceTimersByTime(JOBS_HOLD_MS - 500);
  });
  // A job elsewhere in the room gives this view a new empty list.
  show([]);
  act(() => {
    vi.advanceTimersByTime(500);
  });
  expect(shown).toEqual([]);
});

it('never shows a held job in another view', () => {
  show([job('first')]);
  show(NONE, '$other');
  expect(shown).toEqual([]);
});

it('lets stopped jobs go at once', () => {
  show([job('sent')]);
  show(NONE);
  expect(shown).toEqual([]);
  show([{ ...job('first'), status: 'cancel_requested' }]);
  show(NONE);
  expect(shown).toEqual([]);
});

it('shows nothing when a view starts without jobs', () => {
  show(NONE);
  expect(shown).toEqual([]);
});
