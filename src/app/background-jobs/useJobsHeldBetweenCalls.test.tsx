// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BackgroundJob } from '../matrix/protocol/backgroundJobsContract';
import { JOBS_HOLD_MS, useJobsHeldBetweenCalls } from './useJobsHeldBetweenCalls';

// Whether the agent's reply in the jobs' thread streams.
let streaming = false;
vi.mock('../event-store/threads/useThreadStreamingState', () => ({
  useThreadStreamingState: () => streaming,
  getThreadStreamingState: () => streaming,
}));

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
let statuses: string[] = [];
let renderer: ReactTestRenderer | undefined;

function Probe({ jobs, view }: { jobs: BackgroundJob[]; view: string | null }) {
  const held = useJobsHeldBetweenCalls(jobs, view, (jobId) => jobId === 'sent', {} as Room);
  shown = held.map((item) => item.jobId);
  statuses = held.map((item) => item.status);
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
  streaming = false;
  vi.useRealTimers();
});

it('holds the bar while the reply streams, however long the model thinks between calls', () => {
  streaming = true;
  show([job('first')]);
  show(NONE);
  act(() => {
    vi.advanceTimersByTime(JOBS_HOLD_MS * 5);
  });
  expect(shown).toEqual(['first']);
  show([job('second')]);
  expect(shown).toEqual(['second']);
});

it('lets the bar go 2 s after the reply that ran the jobs ends, not before', () => {
  streaming = true;
  show([job('first')]);
  show(NONE);
  act(() => {
    vi.advanceTimersByTime(JOBS_HOLD_MS * 3);
  });
  // The reply's final edit arrives; its thread no longer streams.
  streaming = false;
  show(NONE);
  act(() => {
    vi.advanceTimersByTime(JOBS_HOLD_MS - 1);
  });
  expect(shown).toEqual(['first']);
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(shown).toEqual([]);
});

it('shows the jobs it holds as finished', () => {
  show([job('first'), { ...job('second'), status: 'awaiting_approval' }]);
  expect(statuses).toEqual(['running', 'awaiting_approval']);
  show(NONE);
  expect(shown).toEqual(['first', 'second']);
  expect(statuses).toEqual(['finished', 'finished']);
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
