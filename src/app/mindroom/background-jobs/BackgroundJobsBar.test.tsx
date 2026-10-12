// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import type { BackgroundJob } from './backgroundJobsContract';
import { BackgroundJobsBar } from './BackgroundJobsBar';

const state = vi.hoisted(() => ({ jobs: [] as BackgroundJob[], send: vi.fn() }));
vi.mock('./useRoomBackgroundJobs', () => ({ useRoomBackgroundJobs: () => state.jobs }));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ sendEvent: state.send, makeTxnId: () => 'txn' }),
}));
vi.mock('./backgroundJobsBar.css', () => ({
  Bar: 'Bar',
  Status: 'Status',
  Items: 'Items',
  Item: 'Item',
  Label: 'Label',
  Chip: 'Chip',
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      `${key}${values ? JSON.stringify(values) : ''}`,
  }),
}));

const job = (jobId: string, overrides: Partial<BackgroundJob> = {}): BackgroundJob => ({
  jobId,
  threadId: '$thread',
  kind: 'tool',
  tool: `tool_${jobId}`,
  status: 'running',
  startedAt: '2026-10-11T00:00:00+00:00',
  ...overrides,
});

const room = { roomId: '!room:example.org', getEventForTxnId: () => undefined } as unknown as Room;
let container: HTMLDivElement;
let root: Root;

const render = (threadId: string | null = '$thread', canCancel = true) =>
  act(() => {
    root.render(<BackgroundJobsBar room={room} threadId={threadId} canCancel={canCancel} />);
  });
const cancelA = 'mindroomUi.backgroundJobs.cancel{"tool":"tool_a"}';
const cancelB = 'mindroomUi.backgroundJobs.cancel{"tool":"tool_b"}';
const click = (label: string) =>
  act(async () => {
    button(label)?.click();
  });
const button = (label: string) =>
  [...container.querySelectorAll('button')].find(
    (item) => item.getAttribute('aria-label') === label || item.textContent === label
  );

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.jobs = [];
  state.send = vi.fn().mockResolvedValue({ event_id: '$sent' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('renders nothing without jobs', () => {
  render();
  expect(container.innerHTML).toBe('');
});

it('shows Stopping until the job leaves the state', async () => {
  state.jobs = [job('a')];
  render();
  await click(cancelA);
  state.jobs = [job('a')];
  render();
  expect(container.textContent).toContain('mindroomUi.backgroundJobs.stopping');
  expect(button(cancelA)).toBeUndefined();
  state.jobs = [];
  render();
  expect(container.innerHTML).toBe('');
});

it('keeps a sent cancel stopping when a later Stop all fails', async () => {
  state.jobs = [job('a'), job('b')];
  render();
  await click(cancelA);
  state.send = vi.fn().mockRejectedValue(new Error('offline'));
  render();
  await click('mindroomUi.backgroundJobs.stopAll');
  expect(button(cancelA)).toBeUndefined();
  expect(button(cancelB)).toBeDefined();
});

it('keeps a job stopping when Stop all reached it, though its own earlier cancel then fails', async () => {
  state.jobs = [job('a'), job('b')];
  let failSingle: (error: Error) => void = () => undefined;
  state.send = vi.fn().mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        failSingle = reject;
      })
  );
  render();
  await click(cancelA);
  state.send.mockResolvedValue({ event_id: '$all' });
  render();
  await click('mindroomUi.backgroundJobs.stopAll');
  await act(async () => failSingle(new Error('offline')));
  expect(button(cancelA)).toBeUndefined();
  expect(button(cancelB)).toBeUndefined();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('lists jobs without cancel controls for a viewer who may not cancel', () => {
  state.jobs = [job('a'), job('b')];
  render('$thread', false);
  expect(container.textContent).toContain('tool_a');
  expect(container.querySelectorAll('button')).toHaveLength(0);
});

it('keeps a cancel stopping across a switch to another thread and back', async () => {
  state.jobs = [job('a'), job('b', { threadId: '$other' })];
  render('$thread');
  await click(cancelA);
  render('$other');
  render('$thread');
  expect(container.textContent).toContain('mindroomUi.backgroundJobs.stopping');
  expect(button(cancelA)).toBeUndefined();
});

it('drops the error of a failed cancel once the job is cancelled from elsewhere', async () => {
  state.jobs = [job('a')];
  state.send = vi.fn().mockRejectedValue(new Error('offline'));
  render();
  await click(cancelA);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  state.jobs = [job('a', { status: 'cancel_requested' })];
  render();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('keeps the error of a job still listed when a cancel of a job that ended fails later', async () => {
  state.jobs = [job('a'), job('b')];
  const fails: Array<(error: Error) => void> = [];
  state.send = vi.fn(
    () =>
      new Promise((_resolve, reject) => {
        fails.push(reject);
      })
  );
  render();
  await click(cancelA);
  await click(cancelB);
  await act(async () => fails[1](new Error('offline')));
  state.jobs = [job('b')];
  render();
  await act(async () => fails[0](new Error('offline')));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('"tool":"tool_b"');
});

it('shows a failed cancel only while its job is listed', async () => {
  state.jobs = [job('a')];
  state.send = vi.fn().mockRejectedValue(new Error('offline'));
  render();
  await click(cancelA);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  state.jobs = [job('b')];
  render();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('shows Stopping without a cancel button for a job cancelled elsewhere', () => {
  state.jobs = [job('a', { status: 'cancel_requested' }), job('b', { status: 'cancel_requested' })];
  render();
  expect(container.textContent).toContain('mindroomUi.backgroundJobs.stopping');
  expect(container.querySelectorAll('button')).toHaveLength(0);
});

it('restores the button and shows an error when the send fails', async () => {
  state.jobs = [job('a')];
  state.send = vi.fn().mockRejectedValue(new Error('offline'));
  render();
  await act(async () => {
    button('mindroomUi.backgroundJobs.cancel{"tool":"tool_a"}')?.click();
  });
  expect(container.textContent).not.toContain('mindroomUi.backgroundJobs.stopping');
  expect(button('mindroomUi.backgroundJobs.cancel{"tool":"tool_a"}')).toBeDefined();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('cancelFailed');
});

it('says the jobs could not be stopped when Stop all fails', async () => {
  state.jobs = [job('a'), job('b')];
  state.send = vi.fn().mockRejectedValue(new Error('offline'));
  render();
  await click('mindroomUi.backgroundJobs.stopAll');
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    'mindroomUi.backgroundJobs.stopAllFailed'
  );
});

it('stop all sends one event for the view and marks every job stopping', async () => {
  state.jobs = [job('a'), job('b')];
  render();
  await act(async () => {
    button('mindroomUi.backgroundJobs.stopAll')?.click();
  });
  expect(state.send).toHaveBeenCalledTimes(1);
  expect(
    container.querySelectorAll('button[aria-label^="mindroomUi.backgroundJobs.cancel"]')
  ).toHaveLength(0);
});
